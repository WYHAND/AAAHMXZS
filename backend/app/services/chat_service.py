"""AI 职业指导对话业务逻辑（手册 11.4、7.2、7.6、7.8、11.11）。

关键点：
- ``send_message``：非流式完整回复
- ``prepare_stream``：SSE 前的同步准备（存用户消息、取出 LLM 上下文），
  真正的流式生成在 ``stream_reply`` 里做
- ``stream_reply``：异步生成器，逐块产出文本；结束时把完整回复落库并回流画像
- 7.7 输出截断、7.6 兜底都在这里落地
- ⚠️ 7.7 里「同一方向追问满 3 轮强制换维度」那套计数器**已按用户要求整体移除**
  （含会话级状态列与 SSE 字段，见 README 第 6 节）。别再把它加回来：
  「追问 ≤3 轮」是聊天侧的旧规则，与 11.9 面试的「每题后追问 1-2 轮」
  （``interview_service.MAX_FOLLOWUP_PER_QUESTION``）是**两件不同的事**，后者保留。
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import fallback_reply
from app.ai.parser import load_prompt
from app.core.config import settings
from app.core.errors import BusinessException, ErrorCode, not_found_unless_owner
from app.models.conversation import Conversation, Message
from app.models.task import Task
from app.models.user import User, utcnow
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    ConversationCreate,
    ConversationResponse,
    MessageResponse,
    PendingChatResponse,
)
from app.services import chat_director, idempotency, memory_service, profile_service
from app.utils.logger import get_logger, sanitize
from app.utils.reference_match import looks_referenced
from app.utils.text import (
    MAX_ASSISTANT_CHARS,
    normalize_for_match,
    truncate,
)

logger = get_logger(__name__)

# 传给模型的历史消息条数上限（给模型更多上下文，不再卡在 12 条）
HISTORY_LIMIT = 20

# 「模型在思考」的心跳间隔（秒）。
# 用户原话：「不能光有一个动画在动，不然会以为是网卡了」。思考通常 3-10s，
# 这段时间里如果只有三个点在跳，用户会怀疑卡死；所以每 2 秒发一次 `status` 事件，
# 带上**真实已用毫秒**，前端显示成"正在想… 6s"。
STATUS_HEARTBEAT_SECONDS = 2.0


@dataclass
class StreamPreparation:
    """SSE 端点的准备结果（FIX 1/2：幂等、会话与用户对象均已降级为纯数据）。

    为什么所有字段都是"纯数据"或"已完成的 DB 结果"，而不是 ORM 对象：
    见 ``prepare_stream`` 与 ``stream_reply`` 的注释（Session 生命周期坑）。
    """

    is_duplicate: bool = False
    conversation_id: Optional[UUID] = None
    user_message: Optional[MessageResponse] = None
    llm_messages: List[Dict[str, str]] = field(default_factory=list)
    # 本轮的"料"（供料层算好的：走到哪一步 / 可用素材 / 目的地）——
    # 纯数据，可以安全地跨 Session 传给 SSE 生成器（见 ``stream_reply`` 的说明）。
    brief: Optional[chat_director.TurnBrief] = None
    # 幂等命中时填充：上一次的助手回复（可能为 None 表示还在生成中）
    replay_reply: Optional[MessageResponse] = None
    pending: Optional[PendingChatResponse] = None


class _DuplicateMessage(Exception):
    """并发重复提交：另一个请求在同一瞬间插入了相同的 ``client_msg_id``。

    ``resolve_duplicate`` 的"先查再插"不是原子的，唯一约束才是最终裁判。
    插入冲突时抛出本异常，调用方据此转成"回放/稍后再试"，而不是 500。
    """

    def __init__(self, message: Message) -> None:
        super().__init__("duplicate client_msg_id")
        self.message = message


# ---------------------------------------------------------------------------
# 对话 CRUD
# ---------------------------------------------------------------------------

# 默认标题前缀（需求 2a：新建会话未传 title 时用「新对话 N」）
DEFAULT_TITLE_PREFIX = "新对话"


def next_default_title(db: Session, user_id) -> str:
    """给新会话生成默认标题 ``新对话 N``（N 从 1 开始，同一用户下不重名）。

    ``N`` 以"该用户已有会话数 + 1"为起点；因为**用户可以删会话**，
    纯计数会撞名（例如有 1/2/3 后删掉 2，再建就会得到"新对话 3"），
    所以这里再往后找到一个没被占用的编号 —— 既满足"序号递增"的手感，
    又真正保证同一用户下不重名。

    ⚠️ **标题只在创建时写入这一处**（需求 2 的范围已收敛为"只做序号命名"）：
    曾经实现过"用首条消息内容自动命名会话"，**已按用户要求完整回退**。
    理由是标题行为要**可预测** —— 序号至少能确定"这是第几个会话"，
    而自动命名会在用户没预期的时候改变标题（说第一句话标题就变了）。
    因此 ``send_message`` / ``prepare_stream`` / ``stream_reply`` 里
    **没有任何修改 title 的代码**；改标题只能通过创建时的 ``title`` 入参。
    """
    existing = set(
        db.exec(select(Conversation.title).where(Conversation.user_id == user_id)).all()
    )
    index = len(existing) + 1
    candidate = f"{DEFAULT_TITLE_PREFIX} {index}"
    while candidate in existing:
        index += 1
        candidate = f"{DEFAULT_TITLE_PREFIX} {index}"
    return candidate


def create_conversation(db: Session, user: User, payload: ConversationCreate) -> ConversationResponse:
    """POST /chat/conversations：创建对话。

    未传 ``title`` 时用 ``新对话 N``（而不是所有会话都叫"新的职业对话"——
    那样列表里一堆同名，用户根本认不出来）。
    **标题不会被后续消息改写**（决策理由见 ``next_default_title`` 的说明）。
    """
    title = (payload.title or "").strip() or next_default_title(db, user.id)
    conversation = Conversation(user_id=user.id, title=title)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return to_conversation_response(db, conversation)


def delete_conversation(db: Session, user: User, conversation_id: UUID) -> None:
    """DELETE /chat/conversations/{id}：删除会话**及其全部消息**。

    实现要点（两条都是刻意的，不是随手写的）：

    1. **显式先删 messages，再删 conversation**，不依赖数据库级联。
       模型里 ``messages.conversation_id`` 是 ``foreign_key`` 但没有
       ``ondelete="CASCADE"``；而且 SQLite 的外键行为取决于 ``PRAGMA foreign_keys``
       （本项目已在 ``app/db/session.py`` 逐连接开启，但换个部署/迁移工具就可能没开）。
       显式删除在"开不开外键强制"的库上行为一致，也顺手兼容了 PostgreSQL 的 NO ACTION。
    2. ⚠️ **产品决策：只删对话与消息，绝不触碰 ``profiles`` / ``profile_tags``。**
       画像标签是按 ``user_id`` 独立存储的，它记录的是"对这个人已经了解到的信息"，
       和"哪次聊天说了这些"无关。用户在界面上清理聊天记录时，
       绝不能连带丢掉他辛苦积累的画像 —— 否则删一次记录就要重新测评，
       而画像又是所有推荐（任务、简历、面试）的输入。
       所以这里**一行 profiles / profile_tags 的代码都不写**；若以后有人想"顺手清理画像"，
       请先看 README §8 的这条决策。

    幂等性：重复删除同一个 id，第二次会因为会话已不存在而返回 2001（符合预期，
    与"不存在/不属于自己"同一语义，不做特殊处理）。
    """
    conversation = get_conversation(db, user, conversation_id)

    # ① 先删消息（显式，不依赖级联）
    db.execute(sa_delete(Message).where(Message.conversation_id == conversation.id))

    # ② 再删会话本身
    db.delete(conversation)

    # ③ 只提交这两类改动。**注意：全程没有碰 profiles / profile_tags**（见上方产品决策）
    db.commit()
    logger.info(
        "删除对话 user_id=%s conversation_id=%s（画像 profiles/profile_tags 未受影响）",
        user.id, conversation_id,
    )


def list_conversations(db: Session, user: User) -> List[ConversationResponse]:
    """GET /chat/conversations：按更新时间倒序。"""
    statement = (
        select(Conversation)
        .where(Conversation.user_id == user.id)
        .order_by(Conversation.updated_at.desc())  # type: ignore[union-attr]
    )
    return [to_conversation_response(db, c) for c in db.exec(statement).all()]


def get_conversation(db: Session, user: User, conversation_id: UUID) -> Conversation:
    """取当前用户自己的对话（14.5：用户只能访问自己的数据）。

    **「不存在」与「不属于自己」都返回 2001**（项目级编码规则，见 README §8 与
    ``app.core.errors.not_found_unless_owner``）。本函数是所有对话类端点的唯一入口：
    ``GET /chat/conversations/{id}/messages``、``POST .../messages``、
    ``GET .../stream``（POST 与 GET 两个形式）——
    因此 SSE 端点也会在**开流之前**就把越权请求挡成 404，不会出现"流已建立才发现越权"。
    """
    return not_found_unless_owner(db.get(Conversation, conversation_id), user.id, "对话不存在")


def list_messages(db: Session, user: User, conversation_id: UUID, limit: int = 100) -> List[MessageResponse]:
    """GET /chat/conversations/{id}/messages。"""
    conversation = get_conversation(db, user, conversation_id)
    messages = _fetch_messages(db, conversation.id, limit)
    return [MessageResponse.model_validate(m) for m in messages]


def to_conversation_response(db: Session, conversation: Conversation) -> ConversationResponse:
    response = ConversationResponse.model_validate(conversation)
    response.message_count = _count_messages(db, conversation.id)
    return response


def _fetch_messages(db: Session, conversation_id: UUID, limit: int = 100) -> List[Message]:
    """按时间正序取消息。

    排序键带 ``Message.id`` 次级键：``created_at`` 理论上由 ``utcnow()`` 保证严格单调
    （见 ``app.models.user.utcnow`` 的说明），但对**外部写入**的行仍可能并列，
    那时加上 id 至少让同一次查询结果稳定，不会把用户/助手的话说反。
    """
    statement = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc(), Message.id.asc())  # type: ignore[union-attr]
        .limit(limit)
    )
    return list(db.exec(statement).all())


def _count_messages(db: Session, conversation_id: UUID) -> int:
    return len(db.exec(select(Message.id).where(Message.conversation_id == conversation_id)).all())


def _recent_messages(db: Session, conversation_id: UUID, limit: int = HISTORY_LIMIT) -> List[Message]:
    """取最近 limit 条（按时间正序返回，供拼 Prompt）。

    先按 ``created_at DESC, id DESC`` 取最近 N 条再反转 —— 顺序直接决定送进模型的
    对话轮次，所以并列时也必须确定（理由同 ``_fetch_messages``）。
    """
    statement = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc(), Message.id.desc())  # type: ignore[union-attr]
        .limit(limit)
    )
    items = list(db.exec(statement).all())
    return list(reversed(items))


def _build_llm_messages(
    db: Session,
    conversation: Conversation,
    user: User,
) -> Tuple[List[Dict[str, str]], chat_director.TurnBrief]:
    """组装发给 DeepSeek 的 messages（14.7：系统 Prompt 与用户输入分离），并顺带算本轮的"料"。

    返回 ``(messages, brief)``：``brief`` 只是供料层算出来的"这一轮手边有什么素材"，
    怎么用、用不用由模型自己判断，服务端不再拿它做空转判定或强行塞话。
    """
    system_prompt = load_prompt("chat_system")
    tags = profile_service.list_tags(db, user.id)
    stage = profile_service.get_stage(db, user.id)

    context_lines = [
        f"当前学生所处阶段：{stage}",
        f"已知画像标签：{profile_service.serialize_tags(tags) if tags else '暂无'}",
        "注意：以上是背景信息，不要直接念出来，用于决定你追问的方向。",
    ]

    # ---------------------------------------------------------------------
    # L1：画像档案里**用户自己说过的话**（让他觉得"这个 AI 记得我"）
    # ---------------------------------------------------------------------
    # ⚠️ 这块与新会话「白纸重来」的决策**不冲突**，别搞混（这也是最容易误判的地方）：
    # - **禁止**的是「上一段对话的内容」：也就是下面 ``as_prompt_block`` 注入的那份
    #   禁止清单（其它会话里的开场白 + 用户原话），那部分一个字都不许提 —— 用户新建会话
    #   就是想换话题，"新对话继承了上一个对话"是他报过的 bug。
    # - **允许**的是「画像档案里已经沉淀下来的原话」（``profile_tags.extra.evidence``）：
    #   画像本来就跨会话存在（``delete_conversation`` 明确不删 profile_tags），
    #   它的语义是"对这个学生已经了解到的东西"，与"哪次聊天说过"无关。
    #   所以引用它是**记着这个人**，不是承接上一个话题。
    # 证据同样先过 ``evidence_for_tags`` 的机械过滤（只能是用户自己发过的字），
    # 并且**排除当前会话**（前面的历史里本来就有，重复给没有收益）。
    # ---------------------------------------------------------------------
    evidence_lines: List[str] = []
    if tags:
        quotes = profile_service.evidence_for_tags(
            db, user.id, tags, exclude_conversation_id=conversation.id
        )
        for tag in tags:
            quote = quotes.get(tag.id)
            if quote:
                evidence_lines.append(f'- {tag.label}（{tag.dimension}）他说过："{quote}"')
    if evidence_lines:
        context_lines.append(
            "他本人写过的原话（**只能原样引用，一个字都不许改、不许加细节**；"
            "引用时不要把它说成别的事）：\n" + "\n".join(evidence_lines)
        )
    else:
        context_lines.append("（暂时没有可以原样引用的用户原话。）")

    # 让 AI 能问"上次那件事做到哪了"（先确认事情到哪一步，再往细节里追）。
    # 不注入这个，模型根本不知道用户手里有什么任务，只能反复泛泛地问兴趣/性格——
    # 那正是用户反馈的"一直问相同的问题"。
    ongoing_tasks = db.exec(
        select(Task)
        .where(Task.user_id == user.id, Task.status == "进行中")  # type: ignore[arg-type]
        .order_by(Task.updated_at.desc())  # type: ignore[union-attr]
        .limit(3)
    ).all()
    if ongoing_tasks:
        titles = "、".join(f"「{t.title}」" for t in ongoing_tasks)
        context_lines.append(
            f"用户进行中的成长任务：{titles}。"
            "如果本轮合适，可以顺势问他这些任务做到哪一步了。"
        )
    else:
        context_lines.append("用户目前没有进行中的成长任务。")

    # ---------------------------------------------------------------------
    # 本轮的"料"（勘误 9.31/9.32）：可用素材 + 两条硬边界
    # ---------------------------------------------------------------------
    # ⚠️ 这里是**供料**，不是"指挥模型说哪句话"（指令式的 intent / angle / 频次硬闸
    # 已按用户要求整块删掉，别再加回来）。为了让供料认得准方向，除了画像标签与用户原话，
    # 还把「注册时填的专业」与「进行中任务标题」一起当线索给它 —— 他这轮可能一个方向词
    # 都没说，但档案里早就写着"计算机"（冒烟测试抓出来的真缺口：漏了 ``user.major``，
    # 结果一个计算机专业的学生拿到的全是通用素材）。
    recent_pairs = [
        (message.role, message.content)
        for message in _recent_messages(db, conversation.id, HISTORY_LIMIT * 2)
        if message.role in {"user", "assistant"}
    ]
    last_user_text = next((text for role, text in reversed(recent_pairs) if role == "user"), "")
    profile_hints = [
        user.major or "",
        *(tag.label for tag in tags),
        *(line.split('说过："', 1)[-1].rstrip('"') for line in evidence_lines),
        *(task.title for task in ongoing_tasks),
    ]
    brief = chat_director.brief_turn(
        last_user_text,
        recent_pairs,
        profile_text=" ".join(hint for hint in profile_hints if hint),
    )

    # 记忆（2026-11 重构）：新对话 ≠ 新用户。同一个账号，记忆连续；换的只是话题。
    # 这块是**背景，不是台词**：只用来避免重复问、把下一句问得更准，不许念出来。
    context_lines.append(
        "【你记得的（背景，不是台词；不要念出来，也不要重复问）】\n"
        + _memory_block(db, user, conversation.id)
    )

    system_content = (
        system_prompt
        + "\n\n【当前用户背景】\n"
        + "\n".join(context_lines)
        + "\n\n"
        + brief.as_prompt_block()
    )

    # content 里只存纯原话（幂等 id 在 Message.client_msg_id 列上），无需任何 strip
    llm_messages: List[Dict[str, str]] = [{"role": "system", "content": system_content}]
    for message in _recent_messages(db, conversation.id, HISTORY_LIMIT):
        if message.role in {"user", "assistant"}:
            llm_messages.append({"role": message.role, "content": message.content})
    return llm_messages, brief


# ---------------------------------------------------------------------------
# AI 开场白（让 AI 先开口，而不是让用户面对空输入框）
# ---------------------------------------------------------------------------
#
# 背景：原来的流程是「新建会话 -> 用户先说话 -> AI 才回复」。
# 体验问题是：用户点开一个新对话，看到的是空白的输入框，
# 不知道该说什么，于是要么随便打一句、要么直接退出。
# 尤其是「还没想清楚方向」的学生（正是本系统的主要用户），
# 面对空白输入框最容易卡住。
#
# 所以新会话创建后由**后端**生成第一句：
# - 存成一条真正的 assistant 消息（不是前端假气泡），因此它会进历史、
#   进 LLM 上下文、进 message_count，刷新页面也还在；
# - 内容由模型自由发挥：日常、未来、焦虑、动力、就业形势都可以，没有话题池、没有字数上限；
# - 唯一的硬约束是**不许编造关于他的事实**：不知道就说不知道，别演"我记得你"。
#   生成失败直接报错，不再用本地假开场糊弄用户。

# 保留的 client_msg_id：只用于标识「这条 assistant 消息是本会话的开场白」。
#
# 为什么复用它而不是加一列 / 加一张表：
# messages 表上已有 ``UniqueConstraint("conversation_id", "client_msg_id")``，
# 直接给开场白一个固定值就等于**让数据库来保证"一个会话最多一条开场白"**，
# 两个请求同时进来的竞态不需要任何额外锁（第二个 insert 会被唯一约束挡下，
# 我们捕获后回放已存在的那条）。加列需要迁移、加表需要联表，都不划算。
# 前缀 ``sys:`` 表明是系统保留值：前端发的 client_msg_id 是 UUID，
# 撞上的概率可以忽略；万一真的撞了也不会脏数据（见 ``_persist_opening`` 的处理）。
OPENING_CLIENT_MSG_ID = "sys:opening"

# 开场白不再有话题池、字数上限、话题种子，也不再强制 JSON。
# 生成方式：纯文本 + thinking=True，Prompt 见 ``app/ai/prompts/chat_opening.txt``。
# 生成失败**直接报错**（不再用本地假开场糊弄用户）。

# ---------------------------------------------------------------------------
# 跨会话信息：AI 必须知道"在别的会话里已经问过 / 用户已经答过什么"
# ---------------------------------------------------------------------------
# 用户报的 bug：「新的对话问的问题和旧的一样」——相隔 90 秒的两个新会话，
# 开场白问的是同一件事；而且用户已经答过"在"、又说了"突然不想搞了"，新会话照样问"还在搞吗"。
#
# 两个根因（一个都不许只靠"模型自觉"）：
# 1. 选材是确定性的：`tags[0]`（权重最高）和 `tasks[0]`（updated_at 最新）永远同一条；
# 2. "不重复提问"只看得见**当前会话**的历史 —— 模型压根不知道自己在别的会话里问过什么。
# 所以这里既要**把"已经聊过"列全**（最近的开场白 + 用户最近说过的话），
# 又要**服务端硬剔除**（被这些内容命中的候选直接不进候选集）。
#
# ⚠️ 第二版修正的 bug（「新对话 4 继承了新对话 3 的话题」）：上一版把
# **用户最近说过的话**当成"可以拿来发问的素材"喂给开场白 Prompt，模型于是顺着素材提问
# （用户说过『健身，刷视频，看短句』-> 新会话开场白"你平时健身都练点啥呀"），
# 用户看到的就是"新建的对话继承了上一个对话"。现在这套信息的语义**只有一个**：
# **已经聊过、禁止再提**。它绝不能再出现在"素材/候选"的位置上。
#
# ⚠️ 2026-11（第三次修正 + 9.46.1）：开场白路径**不再注入"禁止清单"**（那段注入块含
# **用户原话**，与"第一句不许回述旧内容"直接冲突），但会注入 ``_memory_block()`` 的
# **记忆背景**（已知 / 已问，只用来避免重复，不许念出来）。全新用户（没有历史开场白、
# 也没有用户原话）的第一个问题走"人生"入口；老用户可以带记忆开新话题，但不许 recap。
# 这里收集到的内容现在用于：1) 判断是否全新用户（``is_new``）；
# 2) 开场白的**生成后自检**（复述了别的会话 / 重复问基本事实）；
# 3) 对话路径的注入（``as_prompt_block``）。
CROSS_OPENINGS_LIMIT = 3          # 取其它会话里最近 N 条开场白
CROSS_OPENING_CHARS = 50          # 每条截断长度（Prompt 里只是提示"这事问过了"）
CROSS_USER_LINES_LIMIT = 6        # 取其它会话里最近 N 条用户消息
CROSS_USER_LINE_CHARS = 40        # 每条截断长度

# 候选给足：任务重复多（历次测试生成过好几条同名任务），所以先多取再按标题去重
# 开场白相关的旧常量（话题候选数）已随"自由开场白"一起删除。


@dataclass
class CrossSessionContext:
    """该用户在**其它会话**里留下、且**本轮一律不许再提**的内容（从新到旧）。

    ``openings`` / ``user_lines`` 两个字段的语义完全相同：**禁止清单**，
    不是候选素材。开场白路径用它判断"是不是全新用户"并做生成后自检；
    对话路径用 ``as_prompt_block`` 注入原句（见下面两个方法）。
    """

    openings: List[str] = field(default_factory=list)
    user_lines: List[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.openings and not self.user_lines

# ``_looks_referenced`` / ``_drop_already_asked`` 的**实现**已抽到
# ``app/utils/reference_match.py``：任务生成侧要用同一套判据把"已出现在
# 【进行中】任务标题里的标签"从主题素材里机械剔掉（见
# ``task_service._plan_theme_material``），两处口径必须完全一致。
# 这里保留原私有名做别名，本模块的调用点与**行为一个字都没变**。
_looks_referenced = looks_referenced


def _collect_cross_session(
    db: Session, user_id: UUID, exclude_conversation_id: Optional[UUID] = None
) -> CrossSessionContext:
    """收集该用户**其它会话**里的开场白与用户原话（从新到旧、已截断、已去重）。

    ``exclude_conversation_id``：当前会话要排除 —— 它自己的历史本来就在 Prompt 里，
    再放进来会重复占位（而且开场白只在空会话里生成，排除它不影响剔除逻辑）。
    """
    opening_stmt = (
        select(Message.content)
        .join(Conversation, Message.conversation_id == Conversation.id)  # type: ignore[arg-type]
        .where(
            Conversation.user_id == user_id,
            Message.client_msg_id == OPENING_CLIENT_MSG_ID,
        )
    )
    user_stmt = (
        select(Message.content)
        .join(Conversation, Message.conversation_id == Conversation.id)  # type: ignore[arg-type]
        .where(Conversation.user_id == user_id, Message.role == "user")
    )
    if exclude_conversation_id is not None:
        opening_stmt = opening_stmt.where(Message.conversation_id != exclude_conversation_id)
        user_stmt = user_stmt.where(Message.conversation_id != exclude_conversation_id)

    # 次级排序键带 id：同一批写入的 created_at 可能并列（见 utcnow 的说明）
    opening_stmt = opening_stmt.order_by(
        Message.created_at.desc(), Message.id.desc()  # type: ignore[union-attr]
    ).limit(CROSS_OPENINGS_LIMIT)
    user_stmt = user_stmt.order_by(
        Message.created_at.desc(), Message.id.desc()  # type: ignore[union-attr]
    ).limit(CROSS_USER_LINES_LIMIT * 2)  # 多取一点，去重后再截断

    openings: List[str] = []
    for content in db.exec(opening_stmt).all():
        text = truncate(content or "", CROSS_OPENING_CHARS)
        if text and text not in openings:
            openings.append(text)

    user_lines: List[str] = []
    for content in db.exec(user_stmt).all():
        text = truncate(content or "", CROSS_USER_LINE_CHARS)
        # 用户会把同一句话重复说（"在"、"不想就是不想"）：去重，别把 Prompt 塞满
        if text and text not in user_lines:
            user_lines.append(text)
        if len(user_lines) >= CROSS_USER_LINES_LIMIT:
            break

    return CrossSessionContext(openings=openings, user_lines=user_lines)


def _memory_block(
    db: Session, user: User, exclude_conversation_id: Optional[UUID] = None
) -> str:
    """给开场白/正文用的**记忆块**：已经知道的事，不是禁止清单。

    语义（2026-11 重构）：
    - 新对话 ≠ 新用户。同一个账号，记忆是连续的；换的只是这一段话题。
    - 这块东西只用来**避免重复问、把下一句问得更准**，不是拿来念的。
    - 所以措辞是"你已经知道的 / 你之前问过的"，不是"禁止提起"。

    只保留高信号、短的内容：基本信息、画像（少量）、最近任务、用户原话、开场白。
    真正的深度理解由模型自己做，这里只给它材料，不给结论。
    """
    cross = _collect_cross_session(db, user.id, exclude_conversation_id)
    lines: List[str] = []

    # 账号级长期记忆（动机地图）：想要的生活 / 怕什么 / 愿意付出什么。
    long_term = memory_service.format_block(db, user)
    if long_term:
        lines.append(long_term)

    basics = [item for item in (user.grade, user.major) if item]
    if basics:
        lines.append("- 基本信息：" + " / ".join(str(item) for item in basics))

    tags = profile_service.list_tags(db, user.id)[:8]
    if tags:
        lines.append(
            "- 他的画像："
            + "、".join(f"{tag.dimension}/{tag.label}" for tag in tags)
        )

    tasks = db.exec(
        select(Task)
        .where(Task.user_id == user.id)
        .order_by(Task.updated_at.desc())  # type: ignore[union-attr]
        .limit(3)
    ).all()
    if tasks:
        lines.append(
            "- 他最近的任务："
            + "、".join(f"「{task.title}」（{task.status}）" for task in tasks)
        )

    if cross.user_lines:
        lines.append("- 他告诉过你的：" + "；".join(f"「{item}」" for item in cross.user_lines))
    if cross.openings:
        lines.append("- 你之前问过的：" + "；".join(f"「{item}」" for item in cross.openings))

    if not lines:
        return "（暂无：这是新用户，或者之前没留下可用信息。）"
    return "\n".join(lines)


def _find_opening(db: Session, conversation_id: UUID) -> Optional[Message]:
    """取本会话已有的开场白（**必须是 assistant** 角色）。

    只按 client_msg_id 查会有一个坑：如果某个用户恰好拿 ``sys:opening``
    当自己的 client_msg_id，查出来的会是**他的**消息；那样我们就会把用户的话
    当成 AI 的开场白返回。所以这里多带一个 ``role == "assistant"`` 条件。
    """
    return db.exec(
        select(Message).where(
            Message.conversation_id == conversation_id,
            Message.client_msg_id == OPENING_CLIENT_MSG_ID,
            Message.role == "assistant",
        )
    ).first()


async def ensure_opening_message(
    db: Session, user: User, conversation_id: UUID
) -> Optional[MessageResponse]:
    """POST /chat/conversations/{id}/opening：确保会话里有一条 AI 开场白。

    返回 ``None`` 表示**本次不生成**：会话已经有消息了（用户自己先说了话），
    这时再插一句开场白会插在用户消息后面，逻辑上说不通。
    路由层把它翻成 ``{code:0, data:null}``。

    开场白由模型自由生成（纯文本 + thinking），不设话题池、不设字数上限。
    模型不可用时**直接抛 AI_ERROR**，由前端明确告诉用户"服务暂时不可用"，
    不再用本地假开场糊弄。
    """
    conversation = get_conversation(db, user, conversation_id)

    # ① 幂等：已经有开场白就回放。
    existing = _find_opening(db, conversation.id)
    if existing is not None:
        logger.info("开场白幂等命中 conversation_id=%s message_id=%s", conversation.id, existing.id)
        return MessageResponse.model_validate(existing)

    # ② 会话已有消息（用户先说了话）-> 不生成
    if _count_messages(db, conversation.id) > 0:
        logger.info("会话已有消息，跳过开场白 conversation_id=%s", conversation.id)
        return None

    # ③ 生成
    text = await _compose_opening(db, user, conversation.id)
    return _persist_opening(db, conversation, text)


# 新会话里出现这些词，说明模型在回述"并不存在的旧事"（第一次说话不可能有前情）。
_OPENING_RECAP_HINTS = (
    "你上次", "你上回", "你之前", "你以前说", "你说过", "你提过", "我们上次", "上次聊",
)


def _opening_recap_hit(text: str) -> Optional[str]:
    for hint in _OPENING_RECAP_HINTS:
        if hint in text:
            return hint
    return None


# “基本事实”问题：这些答案不会天天变，问过一次就不该再问。
# 只拦事实（大几/专业/学校/周末/在忙什么/新鲜事），
# 不拦“钱、家里、未来、怕什么”这些可以反复深聊的主题。
_BASIC_FACT_PATTERNS = {
    "grade": ("大几", "几年级"),
    "major": ("什么专业", "学什么专业", "哪个专业"),
    "school": ("哪个学校", "什么学校", "哪所学校"),
    "hometown": ("哪里人", "老家哪", "哪的人"),
    "weekend": ("周末"),
    "busy": ("在忙什么", "忙些什么", "最近忙", "最近在忙"),
    "news": ("新鲜事",),
}


def _basic_fact_keys(text: str) -> set:
    return {
        key
        for key, patterns in _BASIC_FACT_PATTERNS.items()
        if any(pattern in (text or "") for pattern in patterns)
    }


def _repeats_basic_fact(text: str, previous_openings: List[str]) -> Optional[str]:
    now = _basic_fact_keys(text)
    if not now:
        return None
    for previous in previous_openings:
        overlap = now & _basic_fact_keys(previous)
        if overlap:
            return sorted(overlap)[0]
    return None


# 全新用户的开场检查：第一个问题应该问“人生”，不是问“日常习惯/职业”。
# 只用于新用户；老用户可以从任何角度进。
_NEW_USER_DAILY_HINTS = (
    "屏幕", "手机", "作息", "课表", "食堂", "宿舍", "周末",
    "上课", "课程", "熬夜", "刷手机", "打游戏",
)
_NEW_USER_CAREER_HINTS = (
    "专业", "写代码", "代码", "编程", "计算机", "实习", "简历",
    "面试", "岗位", "行业", "就业", "程序员",
)
_NEW_USER_LIFE_HINTS = (
    "生活", "以后", "未来", "想要", "怕", "为什么", "意义",
    "日子", "人生", "奋斗", "努力", "成为",
)


def _new_user_opening_off_track(text: str) -> Optional[str]:
    # 只看开头 60 字：开场白通常第一句就点题，后半段可能是铺垫或举例。
    # 这是词表启发式，不做语义判断；否定式（“跟课程、简历都没关系”）仍可能被误判，
    # 但最坏结果只是多一次重试，不会阻断对话。
    head = (text or "")[:60]
    if any(hint in head for hint in _NEW_USER_DAILY_HINTS):
        return "日常习惯"
    career = [hint for hint in _NEW_USER_CAREER_HINTS if hint in head]
    if career and not any(hint in head for hint in _NEW_USER_LIFE_HINTS):
        return "职业话题"
    return None


async def _compose_opening(db: Session, user: User, conversation_id: UUID) -> str:
    """生成开场白：同一个 AI，带着记忆开一个新话题；失败如实报错。"""
    cross = _collect_cross_session(db, user.id, conversation_id)
    previous = cross.openings
    is_new = not previous and not cross.user_lines
    memory = _memory_block(db, user, conversation_id)
    if is_new:
        new_user_note = (
            "这是全新用户，还没聊过。第一个问题优先问“以后想过什么样的生活 / 最怕什么 / "
            "为什么而努力”这类人生问题；不要从日常习惯（作息、手机、课表、食堂、宿舍、周末）"
            "或专业、写代码、计算机、工作、行业、就业开始。"
        )
    else:
        new_user_note = (
            "这是老用户。可以从记忆里挑一个还没聊过的角度；不要 recap，"
            "也不要把上次的话题再问一遍。"
        )
    prompt = deepseek_client.render_prompt(
        load_prompt("chat_opening"),
        {"memory_block": memory, "new_user_note": new_user_note},
    )
    system = "你是一个记得这个人的 AI。只输出你要说的那段话本身。"

    async def _generate(extra: str = "") -> str:
        messages = [
            {"role": "system", "content": system + (("\n" + extra) if extra else "")},
            {"role": "user", "content": prompt},
        ]
        raw = await deepseek_client.chat_text(
            messages,
            max_tokens=settings.DEEPSEEK_CHAT_MAX_TOKENS,
            thinking=True,
            raise_on_error=True,
        )
        return _clean_opening(raw)

    text = await _generate()
    if not text:
        raise BusinessException(ErrorCode.AI_ERROR, "AI 服务暂时不可用，请稍后重试")

    recap = _opening_recap_hit(text)
    repeated = _repeats_basic_fact(text, previous)
    off_track = _new_user_opening_off_track(text) if is_new else None
    if recap or repeated or off_track:
        reason = (
            f"回述旧内容「{recap}」" if recap
            else f"重复问基本事实「{repeated}」" if repeated
            else f"新用户开场跑偏「{off_track}」"
        )
        logger.warning("开场白%s，重试一次：%r", reason, text)
        strict_new = (
            "这是全新用户。第一个问题必须是人生问题（以后想过什么样的生活 / 最怕什么 / "
            "为什么而努力），禁止出现日常习惯（屏幕/手机/作息/课表/食堂/宿舍/周末）"
            "和职业词（专业/代码/计算机/工作/行业/就业）。"
        )
        text = await _generate(
            "这是新的对话，不要回述旧内容（“你之前/你上次/你说过/我们上次”），"
            "也不要重复问已经问过的基本事实（大几、专业、学校、周末、在忙什么、新鲜事）。"
            + (("\n" + strict_new) if is_new else "")
            + "\n换一个新话题，只输出你要说的那段话本身。"
        )
        if not text:
            raise BusinessException(ErrorCode.AI_ERROR, "开场白没生成好，请重试")
        if _opening_recap_hit(text):
            raise BusinessException(ErrorCode.AI_ERROR, "开场白没生成好，请重试")
        repeated_again = _repeats_basic_fact(text, previous)
        if repeated_again:
            logger.warning("开场白再次重复基本事实「%s」，保留本次输出", repeated_again)
        if is_new:
            off_again = _new_user_opening_off_track(text)
            if off_again:
                logger.warning("开场白再次跑偏「%s」，保留本次输出", off_again)
    return text


# ---------------------------------------------------------------------------
# 反杜撰：开场白的"有没有偷偷加用户事实"校验（纯本地、不额外调 AI）
# ---------------------------------------------------------------------------

# 什么算"在陈述关于用户的具体事实"：句子里出现下面这些**用户事实引导语**，
# 就说明这句话在说"你（做过/说过/负责过）什么"，而不是在问一句纯日常的话。
#
# ⚠️⚠️ 本清单的取舍：**宁可误判成可疑，也不许放过杜撰**（假阳性偏保守）。
#    理由是两者的代价完全不对称：
#    - 假阳性（其实没杜撰，却被换成本地模板）-> 用户看到的是**另一句日常搭话**
#      （"你今天上什么课了呀？"），体验基本无损（⚠️ 这是本版比旧版更敢收的原因：
#      旧版模板会念任务标题/标签，误判的代价是"又说了一件他的事"，现在没有了）；
#    - 假阴性（真杜撰被放行）-> 用户看到"你上次说帮同学修电脑，那次是哪出问题？"，
#      而他从没说过出过问题 —— 这是**信任级事故**，用户的原话是
#      「没有的事情坚决不要杜撰，要严厉禁止这种事情」。
#    所以这里收紧到"只要像在回述用户的事就拦"，含"你上次/你之前/你说过/你提过/
#    你做过/你负责/你会/你想学/标签里/任务里/画像里/记录里"等引导语（**48 条**）。
#
# ⚠️ 2026-11（第三次修正）：这条启发式从"只在 ``used`` 为空时生效"改成
#    **无条件生效**（见 ``_compose_opening``）。旧版只在没申报依据时才查，
#    于是模型只要随手申报一个合法标签（``used=["看短句"]``）就能绕过它 ——
#    而这一版第一句话本来就不该涉及任何用户事实，没有"有依据的正常引用"需要放行。
#
#    已知的代价（写在这里免得后人以为没问题）：
#    · "你平时……"这类**纯习惯性问法**（"你平时都忙些什么呀？"）刻意**不入清单** ——
#      它在聊日常那一路太常见，拦掉会把聊天体验削得很难看；而它本身通常也不陈述
#      具体事实（说的是"平时"而不是某个事件）。
#    · **用户点名要的那三句日常（"你今年大几了""你今天上的什么课啊""你觉得自己
#      什么地方比别人好一点"）必须一条都不命中** —— 所以刻意**没有**收 "你大几"、
#      "你会不会"、"你们学校"、"你平时" 这些会把正常搭话打死的片段。
#      改这张表前请先拿 Prompt 里那 8 条风格例句跑一遍。
_USER_FACT_HINTS: Tuple[str, ...] = (
    # 回述类（"你说过什么"）—— 最典型的杜撰形式，也是用户截图里那种句子的开头
    "你上次", "你上回", "你之前", "你之前说", "你之前提", "你之前聊", "你以前", "你以前说",
    "你说过", "你说的是", "你提过", "你提到", "你提起", "你讲过", "你跟我提", "你跟我说过",
    "你告诉过我", "你聊过", "你谈到", "你曾",
    # 跨会话回述（"我们上次聊的"）—— 同样是"第一句不该有的旧内容"
    "我们上次", "我们之前", "上次聊", "之前聊", "上回聊",
    # 归属类（"你做过/负责什么"）—— 把素材加工成新事件时最常出现
    "你做过", "你负责", "你会", "你擅长", "你在弄", "你在做", "你参加了", "你想做",
    "你想学", "你正在做", "你正在弄", "你的兴趣", "你的专业", "你的经历",
    # 素材引用类（"标签里/任务里"）—— 引用画像里的东西，同样是一个刚认识的人不该知道的
    "你的标签", "标签里", "你的任务", "任务里", "画像里", "画像中", "记录里", "档案里",
    "你的档案",
)

# 判断"模型申报的依据 A 有没有在它自己的那句话 B 里真的用上"时的短词门槛。
# >= 该长度才允许走模糊匹配（项目里模型本来就爱改写措辞，见 _looks_referenced）。
_SHORT_MATERIAL_CHARS = 4


# ---------------------------------------------------------------------------
# 「这句话里关于用户的事实，有没有出处？」——开场白与正文共用的**事后检查**
# ---------------------------------------------------------------------------
# 背景（真实事故 A）：用户在「新对话 3」里刚说"我最近在看短句啊"，模型回
# **「哦对，你之前说过是短剧哈哈，我给记岔了」** —— "短剧"来自**另一个会话**
# （「新对话 4」里他说过"我说错了，我说的是看短剧"）。
# 事故 B：模型写「你之前说过想用C做个通讯录，那次是哪出问题？」—— "那次是哪出问题"
# 是它自己加的，用户从没说过出过问题。
#
# 正文是流式输出，没有开场白那套"先申报依据再核对"的机制，所以这里只做**成本可控**的
# 事后检查；开场白侧不再复用这套（开场白现在只做"回述旧会话"这一条窄检查）。
# 这里只罩住"申报了依据却夹带别的事实"的情况）。
#
# ⚠️ 明确的边界（不要把它当成"已经解决了"）：
# - 正文侧**只留痕，不改写、不重试、不打断流** —— 目的是"能统计泄漏频率 + 事后能翻到原文"。
#   开场白侧命中则换本地模板（那边本来就允许这种降级）。
# - 判据是**子串重叠**这种粗启发式，必然有漏报（模型换一套完全不同的措辞、或只改了
#   频率/程度副词如"每天"）和误报。命中**不等于**违规，只是"值得看一眼"。
_HINT_GLIMPSE_CHARS = 12      # 引导语往后取多少个字当作"他引用的那件事"
_HINT_MIN_OVERLAP = 2         # 与出处连续重叠 >= 该字数才算"找得到出处"


def _glimpse_after_hint(text: str, hint: str) -> str:
    """取引导语**之后**的一小段（模型说"你之前说过 X"时，X 就在紧后面）。"""
    index = text.find(hint)
    if index < 0:
        return ""
    return text[index + len(hint): index + len(hint) + _HINT_GLIMPSE_CHARS]


def _content_chars(text: str) -> set:
    """留下"有信息量的字符"：汉字 + 英数。

    刻意丢掉标点、空白、语气词 —— 否则"你之前说过是短剧哈哈"里的"哈哈"就能把
    重叠数凑够，检查直接失效。
    """
    return {ch for ch in normalize_for_match(text) if ch.isalnum()}


def _has_content_overlap(glimpse: str, allowed: Iterable[str], *, minimum: int = _HINT_MIN_OVERLAP) -> bool:
    """``glimpse`` 里有没有**连续 minimum 个字**在 ``allowed`` 的任意一条里出现过。

    为什么是"连续子串"而不是"统计共同字符个数"：素材/原话里的常用字重复率很高
    （"我""是""的"满地都是），统计字符集会把"改几个字就当成同一件事"放过去；
    而模型真要引用某件具体的事，至少会**完整抄住一个 2-3 字的词**（"通讯录""短句""健身"）。

    出处只认**本轮素材清单 + 通过过滤的用户原话**（= 画像档案）。**跨会话的内容
    不算出处** —— 那正是要抓的东西。
    """
    normalized = normalize_for_match(glimpse)
    if not normalized:
        return True  # 取不到片段（引导语在句末）时不下判断，避免误伤
    if len(normalized) < minimum:
        return True
    sources = [normalize_for_match(item) for item in allowed]
    sources = [item for item in sources if item]
    for start in range(len(normalized) - minimum + 1):
        chunk = normalized[start: start + minimum]
        if any(chunk in source for source in sources):
            return True
    return False


def check_reply_for_cross_session_leak(text: str, allowed_text: Iterable[str]) -> Optional[str]:
    """「这句话里关于用户的事实有没有出处」自检：命中就返回一句说明（调用方拿它记 warning）。

    ``allowed_text`` = **允许依据的文本**，两处调用各传各的：
    - 正文：**当前会话**里用户说过的话 + 画像档案（标签/任务/通过过滤的原话）；
    - 开场白：本轮 `materials`（= 真实的素材清单，新会话没有当前会话消息）。

    ⚠️ 两边都**不含**"其它会话"的内容 —— 那些是禁止清单，不是依据。

    返回 ``None`` = 没发现问题。**本函数不做任何网络调用、不改动任何数据。**
    """
    if not text:
        return None
    for hint in _USER_FACT_HINTS:
        if hint not in text:
            continue
        glimpse = _glimpse_after_hint(text, hint)
        if not glimpse:
            continue
        if not _has_content_overlap(glimpse, allowed_text):
            return (
                f"疑似引用了允许范围之外的用户事实：引导语「{hint}」后接 {glimpse!r}"
                "（在本轮素材/当前会话用户消息/画像档案里都找不到出处）"
            )
    return None


# 「这句话是不是在复述别的会话」的判定参数。
#
# 判据：从**别的会话的材料**里抽出"内容词"（连续 2-4 个实词的字窗，例如
# "说错了，我说的是看短剧" -> "短剧"、"我其实会java和C语言" -> "java"），
# 再看模型这句话里有没有出现这些内容词。出现 = 它在**复述别的会话里的具体内容**。
#
# 真实事故：模型写「哦对，你之前说过**是短剧**哈哈」—— 内容词"短剧"来自
# 「新对话 4」里那句"我说错了，我说的是看短剧" -> 命中，换本地模板。
#
# ⚠️ 走过的两条弯路（别再退回去）：
# 1. **"整个 cross_session_items 提到就判"**：里面混着**历史开场白原句**，
#    而历史开场白里全是通用措辞（"这块是怎么来的呀"）。模型写出类似的问法就被判泄漏，
#    实测 4 次采样 4 次退化成模板 —— 把开场白整体打死，比泄漏本身还糟。
# 2. **"重合度比例"**：真实事故那句话 13 个不同字里只有 2 个字跟目标材料重合，
#    比例低到任何阈值都拦不住。
# 3. **"任意 3-4 字滑窗 + 出处重叠"**：滑窗里全是"是怎么""来的呀"这种通用片段，
#    一样造成大量误杀。必须先把**通用措辞排除掉**，只比"内容词"。
#
# 判据只认"别的会话材料里的内容词"出现在模型输出里，**不认通用措辞**，
# 所以正常开场白（引用素材/画像原话）不会被误杀。
_CROSS_KEYWORD_MIN = 2
_CROSS_KEYWORD_MAX = 4

# 内容词抽取时排除的字。判据是「字符级」的：一个片段只要**含有**表里的字就不算内容词。
# ⚠️ 这份表要**只放虚词/通用字**，不要放"内容字"：
#   · 放了虚词 -> 排除"这块""怎么""来的"这类通用片段（这是目的）；
#   · 误放内容字 -> 会把"短剧"这种正是要抓的词一起排掉（踩过：加了"短"之后事故反而拦不住）。
# 通用**话题词**（"健身""刷视频"这类）不在这里排，而是靠"某个字属于常见字"过滤（见
# ``_COMMON_CONTENT_CHARS``）—— 那才是"内容但没辨识度"的正确处理方式。
_FUNCTION_WORDS = frozenset(
    "我的你他她它们了着过是吗呢吧啊呀哦嗯就在有和跟把被这那还也都很太真可说想问聊提做去来下上"
    "个么什怎为以会让给到得地子一二三四五六七八九十不没别要不如果然后而且但"
)

# 常见内容字：构成"健身""标签""短句"这类**话题词**的字。
# 判据：内容词里如果**所有**字都是常见内容字，且长度 <= 3，就不算"具体内容"（跳过）。
# 这样"短剧"（剧不常见）能留下，"健身""标签""刷视频"会被跳过。
# 这份表偏长是刻意的：多列一个字只是让判据更保守（少拦），不会造成误杀。
# 注意"短"刻意**不在**表里：它跟"剧/信/片/文"组合出的都是有辨识度的词。
_COMMON_CONTENT_CHARS = frozenset(
    "健身标签刷视频看听读写吃喝玩乐学习工作课业考试项目代码程序技术方向兴趣性格专业简历面试"
    "实习工资公司行业岗位算法数据设计产品运营沟通表达逻辑执行坚持习惯日常周末时间朋友同学"
    "老师家里人生活状态心情焦虑迷茫痛点能力技能认知经验分享想法计划目标行动打卡任务步骤"
)


def _content_keywords(text: str) -> List[str]:
    """从一段文本里抽"内容词"（见 ``_CROSS_KEYWORD_MIN`` 上方的判据说明）。

    做法：归一化 -> 按非实词切段 -> 在每个连续段里取所有 2~4 字的窗口，
    丢掉**含虚词**的、以及**全由常见内容字组成的短词**（"健身""标签"这类没辨识度的话题词）。
    返回去重后的列表（保序）。
    """
    normalized = normalize_for_match(text)
    if not normalized:
        return []
    keywords: List[str] = []
    seen: set = set()
    for run in re.split(r"[^\w\u4e00-\u9fff]+", normalized):
        if not run:
            continue
        for size in range(_CROSS_KEYWORD_MIN, _CROSS_KEYWORD_MAX + 1):
            for start in range(max(0, len(run) - size + 1)):
                chunk = run[start: start + size]
                if any(ch in _FUNCTION_WORDS for ch in chunk):
                    continue
                if size <= 3 and all(ch in _COMMON_CONTENT_CHARS for ch in chunk):
                    continue  # 全是常见字的话题词，辨识度太低
                if chunk not in seen:
                    seen.add(chunk)
                    keywords.append(chunk)
    return keywords


def _restated_cross_session_item(
    text: str, cross_items: Iterable[str], allowed_items: Iterable[str]
) -> Optional[str]:
    """``text`` 里有没有**复述别的会话里的具体内容**？有就返回那条别的会话材料。

    判据见 ``_CROSS_KEYWORD_MIN`` 上方的说明。两道过滤：

    1. ``allowed_items``（本轮**允许依据** = ``context.materials``）：已经被这次喂进
       Prompt 的内容不算"复述"，跳过 —— 否则"引用画像原话/标签"的合法输出会被误杀
       （这正是 L1 要的效果）。
    2. **具体性门槛**：命中 1 个 4 字词、或 2 个 3 字词、或 3 个任意内容词，才算复述。
       只命中 1 个 2 字词（"健身""标签"）不算 —— 那种量级的偶然重合在真实输出里很常见，
       拿它拦会大面积误杀（实测：4 次采样 4 次退化成模板）。

    ⚠️ 与自检②（``forbidden_items`` 的"提到就判"）的分工：
    - 自检② 管"这一轮被剔除的候选"（标签/任务，模型碰一下就换模板）；
    - 本函数管"别的会话里的**残余内容**"（没被沉淀成任何画像素材的那些）——
      这类内容既不在 materials 里，也不在 forbidden_items 里，只能这样识别。
    """
    normalized_text = normalize_for_match(text)
    if not normalized_text:
        return None
    allowed_normalized = [normalize_for_match(item) for item in allowed_items]
    for item in cross_items:
        if not item:
            continue
        matched: List[str] = []
        for keyword in _content_keywords(item):
            if keyword not in normalized_text:
                continue
            # 「有没有出处」：关键词**整段**出现在某条允许依据里，就认为它是在引用素材
            # （允许多一层截断：模型把"我最近在看短句啊"引成"看短句"，而那正是这轮的标签）。
            if any(
                (keyword in allowed) or (len(keyword) <= 3 and allowed in keyword)
                for allowed in allowed_normalized
            ):
                continue
            matched.append(keyword)
        if _is_specific_restatement(matched):
            return item
    return None


def _is_specific_restatement(matched: List[str]) -> bool:
    """命中的内容词够不够"具体"（见 ``_restated_cross_session_item`` 的第 2 道过滤）。

    门槛：至少一个 **>=4 字**的内容词。
    - 只命中 2-3 字词（"健身""标签""看短剧"）不算 —— 那种量级的重合在真实中文里太常见，
      拿它拦会大面积误杀（实测：4 次采样 4 次退化成模板，比泄漏本身还糟）。
    - 4 字词（"这块是怎么""最近在看短"）几乎不可能是巧合；真实事故里
      "你之前说过**是短剧哈哈**"也能凑出 4 字重合 -> 拦得住。
    """
    return any(len(word) >= 4 for word in matched)


def _leak_check_scope(db: Session, conversation_id: UUID, user_id: UUID) -> str:
    """拼出**正文**允许依据的文本：**当前会话用户消息 + 画像档案**。

    ⚠️ 与 ``_collect_cross_session`` 正好相反：那份是**禁止清单**（别的会话里的东西），
    这份是**允许范围**，所以只取当前会话的 user 消息。
    """
    parts = [
        message.content
        for message in _recent_messages(db, conversation_id, HISTORY_LIMIT)
        if message.role == "user"
    ]
    tags = profile_service.list_tags(db, user_id)
    for tag in tags:
        parts.append(tag.label)
        evidence = str((tag.extra or {}).get("evidence") or "")
        if evidence:
            parts.append(evidence)
    tasks = db.exec(select(Task.title).where(Task.user_id == user_id)).all()
    parts.extend(title for title in tasks if title)
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# 「档案播报」自检：正文里有没有把后台口径说出来（2026-11 追加，**只留痕**）
# ---------------------------------------------------------------------------
# 用户点名（原话）：画像只能当"理解与选题"的输入，**不能当"发言内容"**。
# 反例：用户回「我大三了，在学 Java」，AI 第二句变成
# 「你的标签里有'缺项目'，要不要聊聊这个？」—— 用户要的是
# 「大三学 Java，是打算走开发方向吗？」（以他刚说的话为锚点往前推一步）。
#
# ⚠️ 为什么这条**不能**复用 ``check_reply_for_cross_session_leak``（那套用户事实引导语）：
# 那套判据是"引导语后面引用的事在允许范围里找不到出处才算可疑"，而正文路径的
# **允许范围本来就包含画像档案**（``_leak_check_scope`` = 当前会话用户消息 + 画像标签 + 任务标题）。
# 于是「你标签里有『缺项目』」里的"缺项目"**找得到出处**，那一套会放它过去 ——
# 而它恰恰是这一条要抓的"档案播报"。
#
# 所以这里用一份**独立的句式表**，并且**只留痕、不改写、不打断流**
# （正文是逐字流式输出的，看到时话已经在用户眼前了；改内容没有意义，统计+回查才有意义）。
# 开场白那一侧不需要这条：它已经有更严的校验器（第一句不许出现任何用户事实）。
_PROFILE_NARRATION_HINTS: Tuple[str, ...] = (
    "你的标签", "标签里", "你的画像", "画像里", "根据你的画像", "按你的画像",
    "系统记录", "系统里显示", "系统显示", "后台记录", "记录里显示",
    "档案里", "你的档案", "我看了你的资料", "我看了你的档案", "你的资料",
    "资料里显示", "根据你的测评", "测评结果", "测评里", "数据显示",
    "你的任务里", "任务记录",
)


def _profile_narration_hit(text: str) -> Optional[str]:
    """返回正文里命中的"档案播报"句式（没命中返回 ``None``）。**纯字符串扫描。**

    ⚠️ 判据刻意只认**点名式的后台口径**（"你的标签""档案里""根据你的测评"…），
    不认"任务/方向/项目"这类正常词 —— 模型正常讨论成长任务时会出现那些词，
    一刀切会把整段对话判成可疑（同 ``_restated_cross_session_item`` 注释里踩过的弯路）。
    """
    for hint in _PROFILE_NARRATION_HINTS:
        if hint in text:
            return hint
    return None


def audit_reply_for_leak(
    db: Session, conversation_id: UUID, user_id: UUID, text: str
) -> Optional[str]:
    """跑一次正文自检并记 warning 留痕；返回命中的说明（没命中返回 ``None``）。

    两类检查（都不改内容）：

    1. **跨会话泄漏**（既有）：引导语后引用的事在当前会话/画像里找不到出处；
    2. **档案播报**（2026-11 追加）：出现"你的标签/档案里/根据你的测评"这类后台口径
       —— 画像只能用来决定"往哪问"，不许念出来（见 ``_PROFILE_NARRATION_HINTS``）。

    调用点在 ``send_message`` / ``stream_reply`` 落库之后 —— **绝不抛异常**，
    也绝不因为命中而改动回复内容（正文是流式的，用户可能已经看到了）。
    返回第一个命中的说明（跨会话优先），只为兼容既有调用点与手工排查；
    **命中不等于违规**（是粗启发式），它的用途是"统计频率 + 事后能翻到原文"。
    """
    try:
        allowed = _leak_check_scope(db, conversation_id, user_id)
        finding = check_reply_for_cross_session_leak(text, allowed.splitlines() or [allowed])
        narration = _profile_narration_hit(text)
    except Exception as exc:  # noqa: BLE001 - 自检失败绝不能影响已经生成的回复
        logger.warning("正文泄漏自检异常（已忽略）conversation_id=%s err=%s", conversation_id, sanitize(exc))
        return None
    if finding:
        logger.warning(
            "正文疑似跨会话泄漏 conversation_id=%s：%s ｜ 回复原文=%r",
            conversation_id, finding, text,
        )
    if narration:
        logger.warning(
            "正文疑似档案播报（画像只能用于选题、不许说成后台口径）conversation_id=%s："
            "命中句式「%s」｜ 回复原文=%r",
            conversation_id, narration, text,
        )
    return finding or (f"档案播报句式「{narration}」" if narration else None)


def _clean_opening(raw: str) -> str:
    """清洗模型输出：去空白、去代码块围栏、去整段包裹的引号。"""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[A-Za-z0-9_]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    if len(text) >= 2 and text[0] in "\"“「'" and text[-1] in "\"”」'":
        text = text[1:-1].strip()
    return text


def _persist_opening(
    db: Session, conversation: Conversation, content: str
) -> Optional[MessageResponse]:
    """落库开场白，并用唯一约束挡住并发重复插入。

    竞态场景：前端在页面挂载和「重试」按钮上都会调这个接口，
    两个请求可能同时通过上面的 ``_find_opening`` 检查（都是空），
    然后各生成一句话。这时第二次 ``commit`` 会因为
    ``uq_messages_conversation_client_msg`` 抛 ``IntegrityError``。
    我们不报错，而是**回滚后回放先落库的那条** —— 用户看到的永远是同一句开场白。

    代价：并发时有一次 AI 调用被浪费。开场白只在新建会话时发生一次，
    这个代价远小于"给每个会话加锁"的复杂度。
    """
    message = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=content,
        client_msg_id=OPENING_CLIENT_MSG_ID,
    )
    db.add(message)
    conversation.updated_at = utcnow()
    db.add(conversation)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _find_opening(db, conversation.id)
        if existing is None:
            # 唯一约束挡住的是**用户消息**（用户自己用了 sys:opening 这个 id）：
            # 按"会话已有消息"处理，不生成开场白，也不 500。
            logger.warning("开场白插入冲突且无已有开场白，按已有消息处理 conversation_id=%s",
                           conversation.id)
            return None
        logger.info("开场白并发插入冲突，回放已存在的一条 conversation_id=%s", conversation.id)
        return MessageResponse.model_validate(existing)

    db.refresh(message)
    logger.info("开场白已写入 conversation_id=%s message_id=%s 字数=%s",
                conversation.id, message.id, len(content))
    return MessageResponse.model_validate(message)


# ---------------------------------------------------------------------------
# 发送消息（非流式）
# ---------------------------------------------------------------------------

def _replay_chat_response(
    conversation_id: UUID,
    existing_user: Message,
    existing_reply: Message,
) -> ChatResponse:
    """幂等命中时按第一次请求的完整结果回放（不再调模型、不再落消息）。"""
    return ChatResponse(
        conversation_id=conversation_id,
        user_message=MessageResponse.model_validate(existing_user),
        assistant_message=MessageResponse.model_validate(existing_reply),
        extracted_tags=[],
    )


async def send_message(db: Session, user: User, conversation_id: UUID, payload: ChatRequest) -> ChatResponse:
    """POST /chat/conversations/{id}/messages：一次性返回完整回复。

    与 SSE 端点共用同一套落库/幂等逻辑（``_persist_user_message``）。
    """
    conversation = get_conversation(db, user, conversation_id)

    # 设计文档 4.3 幂等：同一 client_msg_id 重复提交
    existing_user, existing_reply = idempotency.resolve_duplicate(db, conversation.id, payload.client_msg_id)
    if existing_user is not None:
        if existing_reply is not None:
            logger.info("幂等命中，回放上一次回复 conversation_id=%s", conversation.id)
            return _replay_chat_response(conversation.id, existing_user, existing_reply)
        # 上一轮还在生成中：不重复调 AI，也不重复插消息。
        # 这里刻意用不带 status_code 的 BusinessException -> HTTP 200 + code 1001，
        # 因为"稍后再试"是正常的业务状态，不是客户端错误。
        raise BusinessException(ErrorCode.PARAM_ERROR, "该消息正在生成回复，请勿重复提交")

    try:
        user_message = _persist_user_message(db, conversation, payload.content, payload.client_msg_id)
    except _DuplicateMessage as dup:
        # 两个请求同时通过了上面的预检查：唯一约束只放行一个。
        # 输的那一方按"已存在"处理，绝不能继续往下再调一次模型。
        reply = idempotency.find_assistant_reply(db, conversation.id, dup.message)
        if reply is not None:
            logger.info("并发重复提交，回放先落库的回复 conversation_id=%s", conversation.id)
            return _replay_chat_response(conversation.id, dup.message, reply)
        raise BusinessException(ErrorCode.PARAM_ERROR, "该消息正在生成回复，请勿重复提交") from None

    # ⚠️ 这里**不修改会话标题**：需求 2 的范围已收敛为"仅创建时按序号命名"，
    #    "用首条消息自动命名"的方案已按用户要求完整回退（理由见 next_default_title 的说明）。

    # 对话正文一律交回模型（勘误 9.31/9.32）：
    # 旧的 "7.6 拒绝回答 / 答不上来 -> 本地模板，不调模型" 短路**已删除**——
    # 它用一句写死的话替模型提问，用户截图里出现过两次一字不差的重复，
    # 而手册规则 11 要的恰恰是"答不上来时给 2-3 个具体台阶"（那是模型该干的活）。
    try:
        llm_messages, brief = _build_llm_messages(db, conversation, user)
        assistant_text = await _generate_guarded(llm_messages, brief)
        if not (assistant_text or "").strip():
            # 与流式路径一致：绝不把空 assistant 消息写进历史
            assistant_text = fallback_reply()

        assistant_message = _save_assistant_message(db, conversation.id, assistant_text)

        # 正文侧跨会话泄漏自检（追加要求 2）：**只留痕，不改写、不打断**
        audit_reply_for_leak(db, conversation.id, user.id, assistant_text)

        # 7.8 画像回流：每轮结束后抽取标签。
        # 标签是附加收益：抽取失败不能让"回复已经生成并落库"变成 500
        # （流式路径同样把它包在 try/except 里）。
        try:
            extracted_tags = await _extract_round_tags(db, conversation.id, user.id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "非流式画像回流失败（已忽略）conversation_id=%s err=%s",
                conversation.id,
                sanitize(exc),
            )
            db.rollback()
            extracted_tags = []

        # 账号级长期记忆：后台提炼，不阻塞本次回复。
        memory_service.schedule_extraction(user.id, conversation.id)
    except (Exception, asyncio.CancelledError):
        # 助手回复没落库 -> 清掉这条"永远等不到回复"的用户消息，
        # 否则同一个 client_msg_id 重试会一直命中 pending（见 discard_... 说明）。
        # CancelledError 也要兜住：客户端断开时 Starlette 会取消请求任务，
        # 它继承 BaseException，不写在这里就会留下孤儿用户消息。
        db.rollback()
        discard_unanswered_user_message(db, user_message.id)
        raise

    return ChatResponse(
        conversation_id=conversation.id,
        user_message=MessageResponse.model_validate(user_message),
        assistant_message=MessageResponse.model_validate(assistant_message),
        extracted_tags=extracted_tags,
    )


# ---------------------------------------------------------------------------
# 发送消息（SSE 流式，7.2）
# ---------------------------------------------------------------------------

def _duplicate_stream_preparation(
    conversation_id: UUID,
    existing_user: Message,
    existing_reply: Optional[Message],
    client_msg_id: Optional[str],
) -> StreamPreparation:
    """把"该 client_msg_id 已存在"统一翻译成 SSE 的准备结果。

    三条进入路径共用：开流前的预检查、插入时的唯一冲突、以及未来任何
    "发现重复"的分支 —— 保证它们给出完全一致的事件语义。
    """
    if existing_reply is not None:
        logger.info("SSE 幂等命中，回放上一次回复 conversation_id=%s", conversation_id)
        return StreamPreparation(
            is_duplicate=True,
            conversation_id=conversation_id,
            replay_reply=MessageResponse.model_validate(existing_reply),
        )
    logger.info("SSE 幂等命中但上一轮未完成 conversation_id=%s", conversation_id)
    return StreamPreparation(
        is_duplicate=True,
        conversation_id=conversation_id,
        pending=PendingChatResponse(
            conversation_id=conversation_id,
            client_msg_id=str(client_msg_id or ""),
            user_message_id=existing_user.id,
        ),
    )


def prepare_stream(
    db: Session,
    user: User,
    conversation_id: UUID,
    content: str,
    client_msg_id: Optional[str] = None,
) -> StreamPreparation:
    """SSE 端点在**开流之前**完成的同步准备（FIX 1 / FIX 2）。

    做的事（全部在请求级 Session 还活着的时候做完）：
    1. 校验会话归属；
    2. 幂等检查（设计文档 4.3）——命中则不再插消息、不再调 AI；
    3. 把用户消息**先落库**（两个 SSE 端点共用这一条路径）；
    4. 把 LLM 上下文、7.6 本地模板命中等结果算好。

    ⚠️ 为什么这里不返回 ORM 对象（``Conversation`` / ``User`` / ``Message``）：
    请求级 Session 是 ``Depends(get_db)`` 提供的，FastAPI 在**响应开始返回时**
    就会执行依赖的清理逻辑，而 ``StreamingResponse`` 的 body 是之后才被消费的。
    等生成器真正跑起来时，这个 Session 很可能已经被 ``close()``：
    - 任何 ``session.add/commit`` 都会炸；
    - 任何绑定在上面的 ORM 实例访问未加载属性会 ``DetachedInstanceError``。

    所以这里返回的 :class:`StreamPreparation` 里只有 **UUID / 已序列化的
    Pydantic 数据 / 纯 dict 列表**，生成器再拿一个**自己开的** Session 干活。
    """
    conversation = get_conversation(db, user, conversation_id)

    # 幂等：同一 client_msg_id 重复提交
    existing_user, existing_reply = idempotency.resolve_duplicate(db, conversation.id, client_msg_id)
    if existing_user is not None:
        return _duplicate_stream_preparation(
            conversation.id, existing_user, existing_reply, client_msg_id
        )

    # ⚠️ 这里**不修改会话标题**（与 send_message 一致）：首条消息自动命名已回退，
    #    标题只在 create_conversation 里写一次（见 next_default_title 的说明）。
    try:
        user_message = _persist_user_message(db, conversation, content, client_msg_id)
    except _DuplicateMessage as dup:
        # 与 send_message 相同：并发重复提交时唯一约束只放行一个。
        # 输的一方按"已存在"回 pending/回放，绝不进入生成阶段。
        reply = idempotency.find_assistant_reply(db, conversation.id, dup.message)
        logger.info("SSE 并发重复提交，按幂等命中处理 conversation_id=%s", conversation.id)
        return _duplicate_stream_preparation(
            conversation.id, dup.message, reply, client_msg_id
        )

    # 本轮上下文 + 供料（勘误 9.31/9.32）：**不再有本地模板短路**，
    # 一律把 messages 和"料"一起交给生成器（它自己开 Session 去发模型）。
    try:
        llm_messages, brief = _build_llm_messages(db, conversation, user)
    except Exception:
        # 流还没建立就失败：这条用户消息永远等不到回复，清掉让重试能重新插入。
        discard_unanswered_user_message(db, user_message.id)
        raise

    return StreamPreparation(
        is_duplicate=False,
        conversation_id=conversation.id,
        user_message=MessageResponse.model_validate(user_message),
        llm_messages=llm_messages,
        brief=brief,
    )


async def stream_reply(
    session: Session,
    user_id: UUID,
    conversation_id: UUID,
    llm_messages: Optional[List[Dict[str, str]]] = None,
    brief: Optional[chat_director.TurnBrief] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """SSE 异步生成器：产出 ``{"type": ..., ...}`` 事件字典。

    只做四件事：报告"在想"、把模型吐的字原样流出去、落库、回流画像。
    不做空转重试、不压问句、不替模型决定节奏 —— 那些都会让人看出是机器。

    ⚠️ Session 生命周期：``session`` 必须是生成器自己开的（例如 ``SessionLocal()``），
    不能传请求级 ``Depends(get_db)`` 的 Session。
    """
    yield {"type": "start", "conversation_id": conversation_id}
    yield {
        "type": "status",
        "stage": "thinking",
        "text": "正在想…",
        "elapsed_ms": 0,
    }

    text = ""
    started = time.monotonic()
    writing_started = False
    queue: "asyncio.Queue[tuple]" = asyncio.Queue()

    async def _pump() -> None:
        try:
            async for piece in deepseek_client.stream_chat(
                llm_messages or [],
                max_tokens=settings.DEEPSEEK_CHAT_MAX_TOKENS,
                thinking=True,
            ):
                await queue.put(("chunk", piece))
        except Exception as exc:  # noqa: BLE001 - 交给主循环统一处理
            await queue.put(("error", exc))
        finally:
            await queue.put(("done", None))

    task = asyncio.create_task(_pump())
    try:
        while True:
            try:
                kind, payload = await asyncio.wait_for(
                    queue.get(), timeout=STATUS_HEARTBEAT_SECONDS
                )
            except asyncio.TimeoutError:
                yield {
                    "type": "status",
                    "stage": "thinking",
                    "text": "正在想…",
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }
                continue

            if kind == "done":
                break
            if kind == "error":
                raise payload

            piece = str(payload)
            if not piece:
                continue
            if not writing_started:
                writing_started = True
                yield {
                    "type": "status",
                    "stage": "writing",
                    "text": "正在写…",
                    "elapsed_ms": int((time.monotonic() - started) * 1000),
                }
            text += piece
            yield {"type": "delta", "content": piece}
    except Exception as exc:  # noqa: BLE001 - SSE 已开始，只能如实说明
        logger.error("SSE 流式生成异常 conversation_id=%s err=%s", conversation_id, sanitize(exc))
        if not text:
            text = fallback_reply()
            yield {"type": "delta", "content": text}
        yield {
            "type": "error",
            "code": int(ErrorCode.AI_ERROR),
            "message": "AI 服务中断了，这条没说完。你重发一次，我接着聊。",
        }
    finally:
        if not task.done():
            task.cancel()

    if not text.strip():
        # 模型返回空串：落一条如实说明，绝不写空 assistant 消息。
        text = fallback_reply()

    full_text = truncate(text, MAX_ASSISTANT_CHARS)
    message = _save_assistant_message(session, conversation_id, full_text)

    # 正文侧跨会话泄漏自检：只留痕，不改写、不打断流。
    audit_reply_for_leak(session, conversation_id, user_id, full_text)

    tags: List[Dict[str, Any]] = []
    try:
        tags = await _extract_round_tags(session, conversation_id, user_id)
        if tags:
            yield {"type": "tag", "data": {"tags": tags}}
    except Exception as exc:  # noqa: BLE001
        logger.warning("SSE 画像回流失败 conversation_id=%s err=%s", conversation_id, sanitize(exc))

    # 账号级长期记忆：后台提炼，不阻塞本轮结束。
    memory_service.schedule_extraction(user_id, conversation_id)

    yield {
        "type": "done",
        "message_id": message.id,
        "conversation_id": conversation_id,
    }


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

def _persist_user_message(
    db: Session,
    conversation: Conversation,
    content: str,
    client_msg_id: Optional[str] = None,
) -> Message:
    """先把用户消息落库（FIX 1：两个 SSE 端点与 /messages 共用这一条路径）。

    - ``content`` 存**纯原话**，不含任何幂等标记；
    - ``client_msg_id`` 写进独立列（``messages.client_msg_id``），
      配合 ``(conversation_id, client_msg_id)`` 唯一索引在数据库层面防重复。
    """
    # 空串必须归一成 NULL：唯一约束是 (conversation_id, client_msg_id)，
    # 多个 NULL 互不冲突，但多个 "" 会被判成同一个 id —— 用户第二句话就 500。
    normalized_id = (client_msg_id or "").strip() or None
    message = Message(
        conversation_id=conversation.id,
        role="user",
        content=content,
        client_msg_id=normalized_id,
    )
    db.add(message)
    conversation.updated_at = utcnow()
    db.add(conversation)
    try:
        db.commit()
    except IntegrityError:
        # 查-插不是原子的：并发重复提交时唯一约束只放行一个。
        db.rollback()
        existing = (
            idempotency.find_client_message(db, conversation.id, normalized_id)
            if normalized_id
            else None
        )
        if existing is None:
            raise
        raise _DuplicateMessage(existing) from None
    db.refresh(message)
    return message


def discard_unanswered_user_message(db: Session, user_message_id: Optional[UUID]) -> bool:
    """清理"助手回复没落库"的用户消息，避免同一 client_msg_id 永久 pending。

    触发场景：SSE 流在保存助手回复之前被客户端断开/取消。此时库里只有用户消息，
    ``resolve_duplicate`` 每次都会返回 ``(用户消息, None)`` —— 前端重试永远得到
    "正在生成回复"，而实际生成早就不存在了。

    安全边界：**只在确认这条用户消息之后没有任何 assistant 回复时才删**；
    已经落库的回复一条都不动。任何异常都吞掉并记 warning —— 清理失败不能
    掩盖/替换掉原始的流错误。
    """
    if not user_message_id:
        return False
    try:
        # 生成失败时会话可能停在失败事务里，先清掉再查询
        db.rollback()
        message = db.get(Message, user_message_id)
        if message is None or message.role != "user":
            return False
        if idempotency.find_assistant_reply(db, message.conversation_id, message) is not None:
            return False
        db.delete(message)
        db.commit()
        logger.info("已清理未完成回复的用户消息 message_id=%s", user_message_id)
        return True
    except Exception as exc:  # noqa: BLE001 - 清理是兜底，绝不能盖住原始异常
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
        logger.warning(
            "清理未完成回复的用户消息失败（已忽略）message_id=%s err=%s",
            user_message_id,
            sanitize(exc),
        )
        return False


def _save_assistant_message(db: Session, conversation_id: UUID, content: str) -> Message:
    """保存助手回复。

    ⚠️ 这里只收 ``conversation_id``（不接受 ``Conversation`` 实例）：
    本函数会在 SSE 生成器里被调用，那时传入的会话对象可能已经 detached，
    直接用它会被 ``DetachedInstanceError`` 打脸。用 id 在新 Session 里自己取。
    """
    message = Message(conversation_id=conversation_id, role="assistant", content=content)
    db.add(message)

    conversation = db.get(Conversation, conversation_id)
    if conversation is not None:
        conversation.updated_at = utcnow()
        db.add(conversation)

    db.commit()
    db.refresh(message)
    return message


async def _generate_guarded(
    llm_messages: List[Dict[str, str]],
    brief: chat_director.TurnBrief,
) -> str:
    """非流式路径：交给模型自由生成，不做空转重试、也不硬塞素材。"""
    return await deepseek_client.chat_text(
        llm_messages,
        max_tokens=settings.DEEPSEEK_CHAT_MAX_TOKENS,
        thinking=True,
    )


async def _extract_round_tags(db: Session, conversation_id: UUID, user_id: UUID) -> List[Dict[str, Any]]:
    """7.8：每轮对话结束后抽取画像标签。失败返回空列表。

    只收 ``conversation_id`` / ``user_id``（FIX 2）：本函数在 SSE 生成器里执行时，
    请求级的 Conversation/User ORM 实例可能已经 detached。

    ⚠️⚠️ **``text`` 里只允许出现用户自己写的话**（本期修的坑，别再改回去）：

    这里曾经传的是 ``build_history_text(最近 8 条消息)`` —— 也就是**整段 transcript**
    （"学生：…" 和 "AI：…" 拼在一起）。后果是 ``profile_tags.extra.evidence`` 里混进了
    **AI 自己说的话**（真实脏数据：``会Java和C，说明你编程底子不算白纸`` /
    ``AI：你之前提过对技术/产品有点兴趣`` / ``有没有做过完整的小项目？`` /
    ``比空焦虑强多了``）。这些"原话"一旦被喂回 Prompt，模型就会说
    「你上次说'有没有做过完整的小项目？'」—— 把 AI 的话安到用户头上。

    现在 ``text`` 只作"这轮有东西可抽"的短路条件与历史兜底；
    ``extract_tags_from_text`` 对 ``source="chat"`` 会**自己从库里取 ``role='user'``
    的消息**来喂 Prompt（见 ``profile_service._user_side_text``），所以 AI 回复不会进抽取输入。
    """
    messages = _recent_messages(db, conversation_id, 8)
    last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
    if not last_user:
        # 这一轮没有用户消息（例如只有开场白）：没有可归因给用户的原话，不抽。
        return []
    return await profile_service.extract_tags_from_text(db, user_id, last_user, source="chat")

