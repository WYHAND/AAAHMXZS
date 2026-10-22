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

import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import (
    STRUCTURED_TEMPERATURE,
    fallback_reply,
    opening_fallback,
    refusal_reply,
    stuck_reply,
)
from app.ai.parser import load_prompt
from app.ai.schemas import ConclusionCardResult, OpeningResult, empty_conclusion
from app.core.errors import BusinessException, ErrorCode, not_found_unless_owner
from app.models.conversation import Conversation, Message
from app.models.task import Task
from app.models.user import User, utcnow
from app.schemas.chat import (
    ChatConclusionCard,
    ChatRequest,
    ChatResponse,
    ConversationCreate,
    ConversationResponse,
    MessageResponse,
    PendingChatResponse,
)
from app.services import idempotency, profile_service
from app.utils.logger import get_logger, sanitize
from app.utils.reference_match import drop_referenced, looks_referenced
from app.utils.text import (
    MAX_ASSISTANT_CHARS,
    build_history_text,
    looks_like_refusal,
    looks_like_stuck,
    normalize_for_match,
    truncate,
)

logger = get_logger(__name__)

# 传给模型的历史消息条数上限（控制 token 成本）
HISTORY_LIMIT = 12


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
    shortcut: Optional[str] = None
    # 幂等命中时填充：上一次的助手回复（可能为 None 表示还在生成中）
    replay_reply: Optional[MessageResponse] = None
    pending: Optional[PendingChatResponse] = None


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
    ``GET .../stream``（POST 与 GET 两个形式）、``GET .../conclusion`` ——
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
) -> List[Dict[str, str]]:
    """组装发给 DeepSeek 的 messages（14.7：系统 Prompt 与用户输入分离）。"""
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
            "如果本轮合适，可以顺势问他这些任务做到哪一步了（一轮只问一个，不要连问）。"
        )
    else:
        context_lines.append("用户目前没有进行中的成长任务。")

    # 跨会话信息（"不重复提问"要扩到别的会话）：
    # 不注入这块，模型只知道**当前会话**里问过什么，于是在新会话里会把
    # 用户已经答过的事（"还在弄吗" -> "不想搞了"）重新问一遍。
    # ⚠️ 这块的语义是**禁止清单**（已经聊过、不要再提），不是"可以拿来问的素材"。
    # 注意这是 append 到既有 context_lines 后面，不会顶掉上面的 stage/tags/任务。
    context_lines.append(
        _collect_cross_session(db, user.id, conversation.id).as_prompt_block()
    )

    system_content = system_prompt + "\n\n【当前用户背景】\n" + "\n".join(context_lines)

    # content 里只存纯原话（幂等 id 在 Message.client_msg_id 列上），无需任何 strip
    llm_messages: List[Dict[str, str]] = [{"role": "system", "content": system_content}]
    for message in _recent_messages(db, conversation.id, HISTORY_LIMIT):
        if message.role in {"user", "assistant"}:
            llm_messages.append({"role": message.role, "content": message.content})
    return llm_messages


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
# - ⚠️ 内容**只聊日常**（年级、今天上什么课、最近在忙什么……），
#   **一个字都不许提**画像标签 / 进行中任务 / 用户原话 / stage。
#   用户原话（第三次报同一个问题）：
#   「可以问，但是坚决不可以直接在第一句话的时候问」「第一个问题可以随便聊聊天，
#   比如你今年大几了，比如你今天上的什么课啊」「要重视新对话这个问题」。
#   他截图的现场是「新对话｜你之前说想学ai，这块是怎么来的？」—— 就是这一版要消灭的东西。
#   画像素材**最早从第 2 轮**才可以用（见 chat_system.txt「你手里的背景信息怎么用」），
#   而且开场白这一轮不喂任何素材：见 ``OpeningContext`` / ``_opening_context``。

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

# 开场白长度上限（Prompt 里同样要求 60 字，这里是服务端的硬闸）。
# 原来是 120，被用户否掉了："人刚见面不会一口气说 60 字以上"。
# 长开场白读起来像一段产品文案，短一句才像随口搭话；
# 顺带也把"只能问一件事"从长度上锁住（60 字塞不下两三个问题）。
OPENING_MAX_CHARS = 60

# ★ 开场白的"话题种子"（唯一进 Prompt 的变量）。
#
# 为什么需要它（实测，不是拍脑袋）：把开场白改成纯日常之后，模型会**把示范例句当模板**——
# 连着 5 个新会话里 4 个都是「你今年大几啦？」，用户一眼就看出来这是模板
# （他这次要的就是"换一个新的 AI 和用户聊天"的感觉）。给一颗随机话题种子后，
# 每次的问法会分散到不同的小事上。
#
# ⚠️ 它**不是**用户信息：这份池子对所有用户完全一样，与画像/任务/原话无关，
# 也不参与任何校验（``OpeningContext.materials`` 仍是空列表，``used`` 仍必须为空）。
OPENING_TOPIC_SEEDS = (
    "年级（大几了）",
    "今天的课 / 这周的课",
    "最近在忙些什么、手头在弄什么",
    "周末一般怎么过",
    "学校生活（食堂、宿舍、社团）",
    "他自己觉得哪方面比别人强一点",
    "这两天过得咋样",
    "最近有没有什么新鲜事",
)

# 开场白温度：**保持 0.8 不变**。
# 理由：这轮的"活人感"来自 Prompt 里的禁止项（不许给选项、不许问卷腔、只能问一件事）
# 和上面那个 60 字硬闸，不来自温度；而且**纯日常**开场白的多样性主要靠
# ``OPENING_TOPIC_SEEDS``（随机话题种子）而不是温度 —— 实测 0.8 下模型会把示范例句
# 当模板反复吐同一句，加话题种子后才分散（见 README §5.1.1 最新一轮）。
# 再往上调温度，模型更容易在"只问一件事 / 不超 60 字"这些硬约束上漂，收益不抵风险。
OPENING_TEMPERATURE = 0.8

# ---------------------------------------------------------------------------
# 跨会话信息：AI 必须知道"在别的会话里已经问过 / 用户已经答过什么"（**只作禁止清单**）
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
# ⚠️ 2026-11（第三次修正）：开场白路径**连"禁止清单"都不再注入 Prompt**了 ——
# 第一句话只聊日常（"你今年大几啦？"），它不需要知道前情；而且那段注入块里含
# **用户原话**，与"第一句不许出现任何旧内容"直接冲突。这里收集到的内容现在只用于
# 开场白的**生成后自检**（"复述了别的会话"）与对话路径的注入（``as_prompt_block``）。
CROSS_OPENINGS_LIMIT = 3          # 取其它会话里最近 N 条开场白
CROSS_OPENING_CHARS = 50          # 每条截断长度（Prompt 里只是提示"这事问过了"）
CROSS_USER_LINES_LIMIT = 6        # 取其它会话里最近 N 条用户消息
CROSS_USER_LINE_CHARS = 40        # 每条截断长度

# 候选给足：任务重复多（历次测试生成过好几条同名任务），所以先多取再按标题去重
OPENING_TASK_CANDIDATES = 5
OPENING_TASK_FETCH = 15
OPENING_TAG_CANDIDATES = 8


@dataclass
class CrossSessionContext:
    """该用户在**其它会话**里留下、且**本轮一律不许再提**的内容（从新到旧）。

    ``openings`` / ``user_lines`` 两个字段的语义完全相同：**禁止清单**，
    不是候选素材。开场白路径与对话路径的差别只在于"给不给原句"（见下面两个方法）。
    """

    openings: List[str] = field(default_factory=list)
    user_lines: List[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.openings and not self.user_lines

    def as_prompt_block(self, forbidden: Optional[List[str]] = None) -> str:
        """**对话**路径用的注入块：开场白原句 + 用户原话 + （可选）点名清单。

        原句在这里是有用的（AI 得知道自己上几轮聊到哪了），而且对话中途不存在
        "开场白又问一遍"的问题，所以照用户要求原样给。

        ⚠️⚠️ 但**语义只有一个：这是"别再碰"的禁止清单，不是素材**。
        措辞必须写死"一个字都不许提起、不许当铺垫、不许说成'你之前说过'"，理由是一起真实事故：

        用户在「新对话 3」里刚说"我最近在看短句啊"，模型回了一句
        **「哦对，你之前说过是短剧哈哈，我给记岔了」** —— "短剧"是他在**另一个会话**
        （「新对话 4」）里说的。模型是把这段注入块当成了"可以拿来提的往事"，
        而且同一句话里既说"你之前说过"又说"我给记岔了"，自相矛盾，用户当场投诉。
        旧措辞只强调了"别再重复确认状态"，力度不够（"已经聊过"读起来仍像"可以接着聊"），
        所以语义统一为"**不是素材、不许引用、不许回述**"。

        ⚠️ **2026-10 精修**：措辞从原来那段"❌ 不许…（用户看不到这段）…"的高密度禁令，
        压成下面这几行 —— 语义一个字没变（还是"别再碰"的清单），但**负向密度降下来了**。
        背景：chat_system.txt 那次重构发现，成段堆"不许/禁止"会让模型把预算全花在避雷上，
        输出变得畏缩、没活人味（见该 Prompt 顶部说明）。禁令只留必要的那几句，其余靠正向描述。

        ⚠️ **2026-11：这个注入块只用于「对话」路径了**。开场白路径曾经有一个
        ``as_opening_block()``（同样内容的"只给点名清单、不给原句"版本），
        **已随"第一句只聊日常"一起删掉**：那段文字里含**用户原话**，与
        "第一句不许出现任何旧内容"直接冲突（真实事故里的"短剧"正是从这类注入块漏出去的）。
        开场白先生成的是一句"你今年大几啦？"，它不需要、也不该知道前情。
        """
        if self.empty:
            return (
                "【你在其它会话里已经问过 / 已经知道的事】\n"
                "（暂无：这是该用户的第一个会话，或其它会话里还没留下可参考的内容。）"
            )
        lines = [
            "【你在其它会话里已经问过 / 已经知道的事（用户看不到这段）】",
            "下面这些**已经聊过**了 —— 这一轮别再问、别换个说法再问、也别当铺垫提起来，"
            "就当不知道前情（别说成「你之前说过 / 你上次提到 / 我记得你」）：",
        ]
        if self.openings:
            lines.append("· 你已经问过的：" + "；".join(self.openings))
        if forbidden:
            lines.append("· 这些具体内容也别再提：" + "、".join(forbidden))
        if self.user_lines:
            lines.append("· 他已经在别的会话里说过 / 答过的：" + "；".join(self.user_lines))
        lines.append(
            "（上面全是**已经发生过**的事，换个说法再问也算重复，拿来当铺垫也不行。"
            "能用的只有：**这段对话里他自己说的话** + 【当前用户背景】里的画像。）"
        )
        return "\n".join(lines)


# ``_looks_referenced`` / ``_drop_already_asked`` 的**实现**已抽到
# ``app/utils/reference_match.py``：任务生成侧要用同一套判据把"已出现在
# 【进行中】任务标题里的标签"从主题素材里机械剔掉（见
# ``task_service._plan_theme_material``），两处口径必须完全一致。
# 这里保留原私有名做别名，本模块的调用点与**行为一个字都没变**。
_looks_referenced = looks_referenced
_drop_already_asked = drop_referenced


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


def _ongoing_task_candidates(db: Session, user_id: UUID, limit: int) -> List[Task]:
    """进行中任务候选：按 ``updated_at`` 从新到旧，**按标题去重**后取前 ``limit`` 条。

    为什么去重：实测库里同一个用户有 3 条"技术方向小实验"、3 条"Java 或 C 命令行小工具"
    （历次测试生成），标题一模一样。不去重的话候选里一半是同名任务，
    模型挑来挑去还是那件事。
    """
    rows = db.exec(
        select(Task)
        .where(Task.user_id == user_id, Task.status == "进行中")  # type: ignore[arg-type]
        .order_by(Task.updated_at.desc())  # type: ignore[union-attr]
        .limit(OPENING_TASK_FETCH)
    ).all()
    seen: set = set()
    candidates: List[Task] = []
    for task in rows:
        title = (task.title or "").strip()
        if not title or title in seen:
            continue
        seen.add(title)
        candidates.append(task)
        if len(candidates) >= limit:
            break
    return candidates


@dataclass
class OpeningContext:
    """开场白的**自检**上下文（开场白已经不再使用任何画像素材）。

    ⚠️ 本版的核心改动（用户第三次报同一个问题后拍板）：新会话的第一句话
    **只聊日常、只为了认识这个人**，所以标签 / 进行中任务 / 用户原话 / stage
    **一律不进 Prompt** —— 见 ``as_prompt_variables()``（它返回空字典）。
    他截图的现场是「新对话｜你之前说想学ai，这块是怎么来的？」。

    这个类因此只承载"生成后自检"要用的三份清单，**都只作拦截、不作素材**：

    - ``forbidden_items``：被"跨会话已经问过"命中的候选（标签 label / 任务标题）——
      模型一旦提到就换模板（自检②）；它是**禁止清单**，同样不进 Prompt；
    - ``cross_session_items`` / ``cross_user_lines``：**别的会话**里的开场白原句与用户原话
      —— 复述它同样换模板（自检③；只用后者，理由见 ``_restated_cross_session_item``）；
    - ``materials``：**恒为空列表**。它是"本轮真的喂进 Prompt 的素材"的唯一真相，
      ``_validate_opening`` 拿它判"模型申报的依据存不存在"：素材为空 ->
      模型任何非空的 ``used`` 都对不上 -> 判违规。所以这个字段不是"暂时是空的"，
      而是"开场白不该有素材"这件事的可断言载体（回归里直接断言 ``materials == []``）。
    """

    forbidden_items: List[str] = field(default_factory=list)
    cross_session_items: List[str] = field(default_factory=list)
    cross_user_lines: List[str] = field(default_factory=list)
    # 恒为空：开场白不提供任何画像素材（理由见类 docstring）。
    materials: List[str] = field(default_factory=list)

    def as_prompt_variables(self) -> Dict[str, str]:
        """转为 ``chat_opening.txt`` 的占位符 —— **只有一颗"话题种子"**。

        ``chat_opening.txt`` 是一份**静态** Prompt：第一句该说什么、不许说什么，
        与这位学生的画像无关（他的档案再丰富，第一句也只能是"你今年大几啦？"这种搭话）。
        所以这里**不给**任何画像素材：标签 / 任务 / 用户原话 / stage 一个都没有。
        ⚠️ 连"这是该用户的第几个会话"都不给：那会让模型倾向于说"又见面了"，
        而新会话的产品语义是「换一个新的 AI 和用户聊天」。

        唯一的变量 ``topic_seed`` 是**与用户无关**的：它是从一份固定的日常话题池里
        随机抽的一条（对每个用户都是同一个池子），只用来解决实测出来的一个问题 ——
        连着几次新会话，模型会反复吐同一句「你今年大几啦？」（把示范当模板）。
        它**不是**用户信息，也不参与任何校验（``materials`` 仍是空列表）。
        """
        return {"topic_seed": random.choice(OPENING_TOPIC_SEEDS)}


def _opening_context(
    db: Session, user: User, conversation_id: Optional[UUID] = None
) -> OpeningContext:
    """收集开场白的**自检**上下文（不再收集任何画像素材）。

    ⚠️ 这一版把"素材"整块拿掉了，只留两件事：

    1. ``_collect_cross_session()``：该用户**其它会话**的开场白原句与用户原话 ——
       只用于"有没有复述别的会话"这条自检（自检③）。它**不进 Prompt**：
       旧版把它渲染成"禁止清单"注入开场白，那段文字里含**用户原话**，
       与"第一句不许出现任何旧内容"直接冲突（真实事故里的"短剧"就是这么被带进去的）。
    2. ``forbidden_items``：把"已经聊过"的标签/任务候选算出来当下点名的禁止清单，
       模型一旦又把它们拎出来就换模板（自检②）—— 这是**拦截**，不是素材。

    Prompt 侧从此**不给任何用户相关的信息**（``materials=[]``；``as_prompt_variables()``
    只返回一颗与用户无关的随机「话题种子」，见 ``OPENING_TOPIC_SEEDS``）：
    开场白就是一个刚认识的人随口搭话，不需要知道这位学生的任何事。
    """
    cross = _collect_cross_session(db, user.id, conversation_id)
    asked = cross.openings + cross.user_lines

    # 候选 → 剔除（仍复用既有的 ``_drop_already_asked``；本轮只看被剔掉的那部分，
    # 保留下来的标签/任务**不再**当素材给模型，所以直接丢弃）。
    all_tags = profile_service.list_tags(db, user.id)
    tag_labels = [tag.label for tag in all_tags][:OPENING_TAG_CANDIDATES]
    _, dropped_labels = _drop_already_asked(tag_labels, asked)

    task_candidates = _ongoing_task_candidates(db, user.id, OPENING_TASK_CANDIDATES)
    _, dropped_titles = _drop_already_asked([task.title for task in task_candidates], asked)

    # 点名禁止清单 = 这次剔掉的候选（去重、保序）
    forbidden: List[str] = []
    for item in dropped_titles + dropped_labels:
        if item and item not in forbidden:
            forbidden.append(item)

    if forbidden:
        # 剔除必须留痕：以后"为什么这次没提那个任务"能直接从日志看出来
        logger.info(
            "开场白禁止清单（只作拦截、不进 Prompt）：user_id=%s 标签剔除=%s 任务剔除=%s"
            "（依据最近 %s 条开场白 + %s 条用户原话）",
            user.id, dropped_labels, dropped_titles,
            len(cross.openings), len(cross.user_lines),
        )

    return OpeningContext(
        forbidden_items=forbidden,
        cross_session_items=list(cross.openings) + list(cross.user_lines),
        cross_user_lines=list(cross.user_lines),
        materials=[],  # ★ 恒为空：开场白不提供任何画像素材
    )


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
    这时再插一句"你好呀"式的开场白会插在用户消息后面，逻辑上说不通
    （AI 变成在回答自己）。路由层把它翻成 ``{code:0, data:null}``。

    三种情况：
    1. 已有开场白 -> 直接回放（幂等，重复调用不产生第二条）；
    2. 没有任何消息 -> 生成并落库；
    3. 有消息但没有开场白（用户先说话了）-> 返回 ``None``。
    """
    conversation = get_conversation(db, user, conversation_id)

    # ① 幂等：已经有开场白就回放。前端「进入会话就调一次」的写法会重复命中这里，
    #    必须保证第二次不重复落库、也不重复扣 AI 额度。
    existing = _find_opening(db, conversation.id)
    if existing is not None:
        logger.info("开场白幂等命中 conversation_id=%s message_id=%s", conversation.id, existing.id)
        return MessageResponse.model_validate(existing)

    # ③ 会话已有消息（用户先说了话；或用户用了保留 id）-> 不生成
    if _count_messages(db, conversation.id) > 0:
        logger.info("会话已有消息，跳过开场白 conversation_id=%s", conversation.id)
        return None

    # ② 生成
    context = _opening_context(db, user, conversation.id)
    text = await _compose_opening(context)

    return _persist_opening(db, conversation, text)


async def _compose_opening(context: OpeningContext) -> str:
    """生成开场白文本：优先调模型，失败/异常走开场专用的日常模板（7.6）。

    契约（不许破坏）：**绝不抛异常、绝不 500、永远返回一句可用的话**；
    返回前一定做过"有没有偷偷加用户事实"的机械校验（用户原话：
    「没有的事情坚决不要杜撰，要严厉禁止这种事情」——
    本版更严：第一句话**连真事都不许提**，见 ``_validate_opening``）。

    流程：
    ① 调模型拿 **JSON**（``text`` + ``used``），失败走 ``default=OpeningResult()`` 兜底；
       ⚠️ Prompt 变量**只有一颗与用户无关的随机话题种子**（``as_prompt_variables()``）：
       开场白不接收任何画像素材；
    ② 清洗 ``text``（去围栏/引号）；
    ③ **本地**校验（``_validate_opening``，不额外调 AI）：出现任何用户事实引导语、
       或申报了任何依据（素材清单恒为空，必然对不上）-> 一律换模板；
    ④ 再用既有的"复述别的会话 / 命中禁止清单"两条自检兜一遍；
    ⑤ ``truncate(text, 60)`` 兜住长度的硬闸。
    """
    # 结构化输出的兜底值：空 text 会让下面立刻落到本地模板。
    # ``default`` 保证 chat_json 在任何解析失败（模型返回非 JSON、被截断、
    # 干脆返回一句人话）时都**不抛异常**，只交出这个空结果。
    try:
        result = await deepseek_client.chat_prompt_json(
            prompt_name="chat_opening",
            variables=context.as_prompt_variables(),
            schema=OpeningResult,
            default=OpeningResult(),
            # ⚠️ 温度**保持 0.8 不变**（原 ``chat_prompt_text`` 路径就是这个值）。
            #    比结构化输出惯例的 0.2 高，会让 JSON 格式偶发不听话，
            #    但那一路有 default 兜底成模板；而"活人感"是这一版开场白的核心诉求，
            #    降温度会把句子重新变成产品文案（见 OPENING_TEMPERATURE 的说明）。
            temperature=OPENING_TEMPERATURE,
        )
    except Exception as exc:  # noqa: BLE001 - 开场白绝不能因为 AI 挂了就失败
        logger.warning("开场白生成异常，走本地模板: %s", sanitize(exc))
        result = OpeningResult()

    text = _clean_opening(result.text or "")
    used = [item.strip() for item in (result.used or []) if item and item.strip()]

    # 模型**原始申报**（``used``）在这里落一条日志：
    # 用户明确要求"要能看出模型申报了什么依据"，而 ``used`` 只存在于这一次调用里
    # （最终落库的是 ``text``），不记下来事后就只能靠猜。级别用 INFO：
    # 开场白一个会话只生成一次，不刷屏。
    logger.info(
        "开场白模型输出：text=%r used=%r 本轮素材清单=%r",
        text, used, context.materials,
    )

    if not text:
        # 模型没给出可用文本（AI 挂 / 空串 / JSON 解析失败兜底成 default）——
        # ⚠️ 老路径走 ``chat_text`` 时这里还要判一次 ``FALLBACK_CHAT_REPLY``（"我这边刚刚
        #    卡了一下…"是中途断线话术，放会话第一句很突兀）。现在改成 ``chat_json`` 之后，
        #    失败路径给的是 ``default=OpeningResult()`` 的**空串**，那句断线话术根本不会再
        #    出现，所以那个判断已无对象；这里改为在下面用"疑似陈述用户事实"的启发式兜住
        #    模型万一真的把类似整句抄进 text 的情况。
        return _opening_fallback_for(context, "AI 不可用或无有效输出")

    # ---- 输出自检①（核心，本版改为"无条件"）：话里有没有关于用户的具体事实 ----
    # 纯本地计算，不额外调 AI，所以不加延迟和成本。
    # ⚠️ 本版传的素材清单**恒为空**（开场白不给任何画像素材），所以
    # ``used`` 只要非空就必然对不上 -> 判违规；而引导语那一条**无条件**跑
    # （旧版只在 ``used`` 为空时才跑，模型随手申报一个标签就能绕过）。
    violation = _validate_opening(text, used, context.materials)
    if violation is not None:
        reason, evidence_note = violation
        return _opening_fallback_for(context, reason, raw=evidence_note)

    # ---- 输出自检③：有没有承接**其它会话**的内容 ----
    # 放在自检②**前面**、且**无论模型有没有申报依据都跑** —— 这一点很关键：
    # 上面那条（①）虽然已经无条件扫引导语，但真实事故里泄漏的"短剧"来自**另一个会话**，
    # 而模型那句话很可能换个措辞、不带任何引导语（"哦对，短剧哈哈"），
    # 也没被 ``forbidden_items`` 点名 —— 单靠 ① ② 拦不住。
    #
    # 这里用**跨会话原话**（``_collect_cross_session`` 的 user_lines）查一次：
    # 判据是"命中了具体内容词就判"（宁可误判成可疑，与 ``_looks_referenced`` 同一套信号）。
    # 例：用户在「新对话 4」说过"我说错了，我说的是看短剧" -> 本轮的
    # cross_user_lines 里有这句 -> 模型写「你之前说过是短剧」-> 判不合格换模板。
    #
    # ⚠️ 与本版的关系：第一句话本来就不该提任何旧内容，所以这条**更该拦得住**；
    # 它现在也是"允许依据为空"的：``allowed_items`` 只有 ``context.materials``（恒为空），
    # 于是任何>=4字的内容词都不算"有出处"。放行逻辑保留着，是为了万一以后
    # 又给开场白接上素材时不会立刻失效（见 ``_restated_cross_session_item``）。
    leak = _restated_cross_session_item(
        text,
        context.cross_user_lines,
        list(context.materials),
    )
    if leak:
        return _opening_fallback_for(context, f"复述了其它会话的内容 {leak!r}", raw=text)

    # ---- 输出自检②（既有）：有没有又把"已经聊过的事"拿出来问 ----
    # 用户报的 bug 是"新会话又问同一件事"：模型实测会把旧事改个说法再用一遍
    # （"想起来你上次说想用C做个通讯录" -> "之前你说想用C写个通讯录"）。
    # 这条规则不能只写在 Prompt 里赌它听话，所以这里再验一次：
    # 只要新开场白又碰到了被剔除的候选（标签/任务），就换成模板（模板现在是纯日常，
    # 天然不会重复）。这不是常规路径，是兜底 —— 触发时会打 warning 留痕。
    hit = [item for item in context.forbidden_items if _looks_referenced(item, text)]
    if hit:
        return _opening_fallback_for(context, f"提到了已问过的素材 {hit}", raw=text)

    # ---- 输出自检④（既有兜底）：话里关于用户的事实有没有出处 ----
    # 前面的 ①~③ 都是**结构性**检查（申报对不对得上、有没有碰禁止清单、有没有搬别会话）。
    # 这一条是**内容性**的兜底：扫"用户事实引导语"，看引导语后面引用的那件事能不能在
    # 本轮素材（= 真的喂进 Prompt 的字）里找到出处。真实事故：
    # 模型写「你之前说过想用C做个通讯录，那次是哪出问题？」—— 素材里只有"通讯录"，
    # "那次是哪出问题"没有任何出处（用户从没说过出过问题）-> 判不合格换模板。
    # 与正文侧复用同一个函数（``check_reply_for_cross_session_leak``），口径一致。
    # ⚠️ 本版素材恒为空，所以这条基本被 ① 全面覆盖（① 更早、更严），留着是第四道网。
    finding = check_reply_for_cross_session_leak(text, context.materials)
    if finding:
        return _opening_fallback_for(context, finding, raw=text)

    # 长度硬闸放在**最后**：前面任何一条判杜撰/判重复的分支都直接换成模板，
    # 不截断模型原话（截断会把句子切在半路，还可能切掉它自己申报的依据片段）。
    if len(text) > OPENING_MAX_CHARS:
        # 模板自身不超过 60 字（见 fallbacks.py 注释），万一超了也不能靠截断硬切
        logger.warning(
            "开场白超过 %s 字（实际 %s 字），改用本地模板（模型输出=%r）",
            OPENING_MAX_CHARS, len(text), text,
        )
        return _opening_fallback_for(context, "超出长度上限", raw=text)

    return text


def _opening_fallback_for(context: OpeningContext, reason: str, raw: str = "") -> str:
    """判杜撰 / 判重复 / 超长 / AI 不可用 时统一走这里：留痕 + 换成本地模板。

    ⚠️ 本版模板是**纯日常搭话**（"嗨，今天过得咋样？"），不再引用任何素材 ——
    所以"模板不会杜撰、也不会重复提问"从"引用保留素材"变成了**结构性成立**：
    模板里根本没有关于这位学生的任何字。这正是"宁可误判成可疑而换成模板"
    这个取舍在本版更安全的原因（换了也不会有画像泄漏）。

    ``raw`` 一定要把**模型原文**带上：用户要求"要能看出是哪一项对不上、模型原文是什么"，
    排障时如果日志里只有一句原因，就还得回去翻模型返回，等于没留痕。
    """
    fallback = opening_fallback()
    logger.warning(
        "开场白判定不合格（%s），改用本地模板兜底：素材清单=%s 模型输出=%r 模板=%r",
        reason, context.materials, raw, fallback,
    )
    return truncate(fallback, OPENING_MAX_CHARS)


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
#    **无条件生效**（见 ``_validate_opening``）。旧版只在没申报依据时才查，
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
# 事后检查；开场白侧也复用同一个函数当兜底（它已经有 ``_validate_opening`` 那一层，
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


def _user_fact_hint(text: str) -> Optional[str]:
    """返回命中的用户事实引导语（没命中返回 ``None``），用于 warning 留痕。"""
    for hint in _USER_FACT_HINTS:
        if hint in text:
            return hint
    return None


def _match_material(declared: str, materials: List[str]) -> Optional[str]:
    """把模型申报的依据对到**本轮真实素材清单**里的某一条上。

    两轮匹配（都是"服务端说了算"，不看模型脸色）：
    1. **原样包含**：素材是模型申报串的子串（模型把标签写成"标签『看短句』"也算）；
    2. **模糊匹配**（只对 >=4 字的素材）：模型把任务标题改了措辞时兜一下，
       直接复用既有的 ``_looks_referenced``（宁可多剔不可漏剔的那套信号）。
       短素材（"看短句""剪辑"）**不允许**走这条 —— 像『焦虑』这种短标签跟任意一句话
       都容易撞出"覆盖率 >= 0.5"，那会把"编一个短标签"放过去。

    匹配不到返回 ``None`` -> 调用方判杜撰。
    """
    declared_key = normalize_for_match(declared)
    if not declared_key:
        return None
    for material in materials:
        key = normalize_for_match(material)
        if not key:
            continue
        if key in declared_key:
            return material
    for material in materials:
        if len(normalize_for_match(material)) >= _SHORT_MATERIAL_CHARS and _looks_referenced(
            material, declared
        ):
            return material
    return None


def _quoted_user_evidence(evidence_values: Iterable[str], text: str) -> Optional[str]:
    """判断模型这句话有没有**原样引用**某条通过过滤的用户原话。

    方向是"原话 ⊃ 模型输出里的片段"（与 ``_match_material`` 正好相反），
    因为模型经常只摘半句：原话是"健身，刷视频，看短句"，它写成
    「你标签里有『看短句』这一条」；原话是"帮同学修电脑"，它写成
    「你提过帮同学修电脑 —— 愿意多讲讲吗？」（引用时还要补"你提过"这种引导语）。

    ⚠️ 这条宽松是**必要的**：用户原话与标签是"同一件事的两种粒度引用"，
    用严格包含会把所有"引用原话"的合法输出打成杜撰、整句换成本地模板
    —— 那正是本轮要修的体验问题（用户要"有和人在对话的感觉"，模板做不到）。
    安全性由"原话已经过证据归属过滤"保证：能被引用的字**本来就都是用户自己说过的**，
    模型引用它不可能构成杜撰；而"给原话加细节"（"那次是哪出问题"）里的细节不会出现在
    任何一条原话里，所以那句话仍然过不了 ``_match_material`` / 素材依据这条线。
    """
    normalized_text = normalize_for_match(text)
    if not normalized_text:
        return None
    for quote in sorted(evidence_values, key=len, reverse=True):  # 优先报告更具体的原话
        key = normalize_for_match(quote)
        if not key:
            continue
        if key in normalized_text:
            return quote
        if len(key) >= _SHORT_MATERIAL_CHARS and normalized_text in key:
            return quote
    return None


def _validate_opening(
    text: str,
    used: List[str],
    materials: List[str],
    evidence: Optional[Iterable[str]] = None,
) -> Optional[Tuple[str, str]]:
    """校验开场白里有没有"关于用户的具体事实"（本版：**一个都不许有**）。

    返回 ``None`` = 通过；否则返回 ``(违规说明, 留痕用的模型原文)`` ——
    第二项会进 ``logger.warning``，方便直接看出"是哪一项对不上、模型原文是什么"。

    本版语义（用户第三次报同一个问题后拍板）：**第一句话只聊日常**，
    所以"关于用户的具体事实"（年级、专业、经历、喜好、任务、标签）**出现即违规**。
    检查（顺序即优先级）：

    ① **无条件**扫用户事实引导语（``_USER_FACT_HINTS``）：命中即违规。
       ⚠️ 与旧版最关键的差别：旧版这条**只在 ``used`` 为空时**才跑，
       于是模型随手申报一个合法标签就绕过了它（真实事故里的"短剧"就是这么漏的）；
       现在无论 ``used`` 是什么都要过这一条，引导语表也从 26 条扩到 48 条
       （补了"你上回/你说的是/你之前提/我们上次/你想学/你的专业/档案里"等）。
       旧的"``used=[]`` + 引导语 = 杜撰"因此被**保留并加强** —— 它现在是这条的子集。
    ② ``used`` **必须为空数组**（开场白不提供任何素材，``materials`` 恒为空）：
       任何申报都对不上素材清单 -> 判违规。理由：素材清单为空时，
       "申报了依据"本身就是"它在引用画像里的东西"的自证；而且没有素材清单，
       服务端无法核实它申报的字是不是真的，宁可换模板。
    ③ 万一以后又给开场白接上素材（``materials`` 非空），旧的两条仍然生效：
       申报必须能在素材里原样找到；申报了就得在话里提到（含"引用通过过滤的用户原话"
       的并列分支 ``_quoted_user_evidence``）—— 保留它是为了那种情况不回退。

    :param evidence: 本轮通过证据归属过滤的用户原话。本版恒为 ``None``
        （开场白不再有原话素材）；保留这个参数是为了让"将来若恢复素材"不走样，
        也避免老调用点/回归脚本因为签名变化直接报错。

    ⚠️ 本函数**不做任何网络调用**，纯本地计算 —— 校验不能给开场白再加一次 AI 往返。
    """
    # ① 无条件：任何"关于用户的事实"都不许出现在第一句里
    hint = _user_fact_hint(text)
    if hint is not None:
        return (
            f"开场白出现了关于用户的具体事实（命中引导语「{hint}」）",
            f"text={text!r} used={used!r}",
        )

    # ② used 必须为空：开场白没有任何素材可申报
    if not used:
        return None

    unmapped: List[str] = []
    for declared in used:
        if _match_material(declared, materials) is None:
            unmapped.append(declared)
    if unmapped or not materials:
        return (
            f"开场白不该申报任何依据（本轮素材清单={materials!r}）: {unmapped or used}",
            f"text={text!r} used={used!r}",
        )

    # ③ 兼容分支：素材非空时，申报了就要在话里真的提到（或原样引用某条用户原话）
    if not any(_looks_referenced(material, text) for material in used):
        if _quoted_user_evidence(list(evidence or []), text) is None:
            return (
                f"申报了依据但话里没提到: {used}",
                f"text={text!r}",
            )

    return None


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

async def send_message(db: Session, user: User, conversation_id: UUID, payload: ChatRequest) -> ChatResponse:
    """POST /chat/conversations/{id}/messages：一次性返回完整回复。

    与 SSE 端点共用同一套落库/幂等逻辑（``_persist_user_message``）。
    """
    conversation = get_conversation(db, user, conversation_id)

    # 设计文档 4.3 幂等：同一 client_msg_id 重复提交
    existing_user, existing_reply = idempotency.resolve_duplicate(db, conversation.id, payload.client_msg_id)
    if existing_user is not None and existing_reply is not None:
        logger.info("幂等命中，回放上一次回复 conversation_id=%s", conversation.id)
        return ChatResponse(
            conversation_id=conversation.id,
            user_message=MessageResponse.model_validate(existing_user),
            assistant_message=MessageResponse.model_validate(existing_reply),
            extracted_tags=[],
            conclusion_ready=has_conclusion(db, conversation.id),
        )
    if existing_user is not None:
        # 上一轮还在生成中：不重复调 AI，也不重复插消息。
        # 这里刻意用不带 status_code 的 BusinessException -> HTTP 200 + code 1001，
        # 因为"稍后再试"是正常的业务状态，不是客户端错误。
        raise BusinessException(ErrorCode.PARAM_ERROR, "该消息正在生成回复，请勿重复提交")

    user_message = _persist_user_message(db, conversation, payload.content, payload.client_msg_id)

    # ⚠️ 这里**不修改会话标题**：需求 2 的范围已收敛为"仅创建时按序号命名"，
    #    "用首条消息自动命名"的方案已按用户要求完整回退（理由见 next_default_title 的说明）。

    # 7.6 边界：拒绝回答 / 答不上来，走本地模板，不调用模型
    shortcut = _shortcut_reply(payload.content)
    if shortcut is not None:
        assistant_text = shortcut
    else:
        llm_messages = _build_llm_messages(db, conversation, user)
        assistant_text = await deepseek_client.chat_text(llm_messages)

    assistant_message = _save_assistant_message(db, conversation.id, assistant_text)

    # 正文侧跨会话泄漏自检（追加要求 2）：**只留痕，不改写、不打断**
    audit_reply_for_leak(db, conversation.id, user.id, assistant_text)

    # 7.8 画像回流：每轮结束后抽取标签
    extracted_tags = await _extract_round_tags(db, conversation.id, user.id)

    return ChatResponse(
        conversation_id=conversation.id,
        user_message=MessageResponse.model_validate(user_message),
        assistant_message=MessageResponse.model_validate(assistant_message),
        extracted_tags=extracted_tags,
        conclusion_ready=has_conclusion(db, conversation.id),
    )


# ---------------------------------------------------------------------------
# 发送消息（SSE 流式，7.2）
# ---------------------------------------------------------------------------

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
        if existing_reply is not None:
            logger.info("SSE 幂等命中，回放上一次回复 conversation_id=%s", conversation.id)
            return StreamPreparation(
                is_duplicate=True,
                conversation_id=conversation.id,
                replay_reply=MessageResponse.model_validate(existing_reply),
            )
        logger.info("SSE 幂等命中但上一轮未完成 conversation_id=%s", conversation.id)
        return StreamPreparation(
            is_duplicate=True,
            conversation_id=conversation.id,
            pending=PendingChatResponse(
                conversation_id=conversation.id,
                client_msg_id=str(client_msg_id),
                user_message_id=existing_user.id,
            ),
        )

    # ⚠️ 这里**不修改会话标题**（与 send_message 一致）：首条消息自动命名已回退，
    #    标题只在 create_conversation 里写一次（见 next_default_title 的说明）。
    user_message = _persist_user_message(db, conversation, content, client_msg_id)

    shortcut = _shortcut_reply(content)
    llm_messages = [] if shortcut else _build_llm_messages(db, conversation, user)

    return StreamPreparation(
        is_duplicate=False,
        conversation_id=conversation.id,
        user_message=MessageResponse.model_validate(user_message),
        llm_messages=llm_messages,
        shortcut=shortcut,
    )


async def stream_reply(
    session: Session,
    user_id: UUID,
    conversation_id: UUID,
    llm_messages: Optional[List[Dict[str, str]]] = None,
    shortcut: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """SSE 用的异步生成器：产出 ``{"type": ..., ...}`` 事件字典（7.2 + 设计文档 5.4）。

    ⚠️ Session 生命周期（FIX 2）：``session`` 必须是**生成器自己开、自己关**的
    会话，例如 ``SessionLocal()``；**绝不能**传请求级 ``Depends(get_db)`` 的 Session
    —— 那个 Session 在响应开始返回时就被 FastAPI 清理了，而本生成器的 body 是之后
    才被消费的。同理 ``user`` 只以 ``user_id`` 形式传入：请求级 Session 上的 User
    实例此时已 detached，访问任何未加载属性都会 ``DetachedInstanceError``。

    流程：
    1. 先发 start 事件（带 conversation_id）
    2. 逐块 yield delta（命中 7.6 本地模板就一次性 yield）
    3. 累积完整文本 -> 截断到 300 字（7.7）-> 落库
    4. 7.8 回流画像标签 -> 发 tag 事件
    5. 发 done 事件
    """
    yield {
        "type": "start",
        "conversation_id": conversation_id,
    }

    buffer: List[str] = []
    try:
        if shortcut is not None:
            buffer.append(shortcut)
            yield {
                "type": "delta",
                "content": shortcut,
            }
        else:
            async for piece in deepseek_client.stream_chat(llm_messages or []):
                buffer.append(piece)
                yield {
                    "type": "delta",
                    "content": piece,
                }
    except Exception as exc:  # noqa: BLE001 - 7.6 兜底：流式失败也不能 500
        logger.error("SSE 流式生成异常 conversation_id=%s err=%s", conversation_id, sanitize(exc))
        if not buffer:
            fallback = fallback_reply()
            buffer.append(fallback)
            yield {
                "type": "delta",
                "content": fallback,
            }
        yield {"type": "error", "code": int(ErrorCode.AI_ERROR), "message": "AI 回复中断，已切换兜底话术"}

    full_text = truncate("".join(buffer), MAX_ASSISTANT_CHARS)
    message = _save_assistant_message(session, conversation_id, full_text)

    # 正文侧跨会话泄漏自检（追加要求 2）：**只留痕，不改写、不打断流**
    # （用户可能已经看到这段文字了，所以这里绝不能改内容；目的是统计泄漏频率）
    audit_reply_for_leak(session, conversation_id, user_id, full_text)

    tags: List[Dict[str, Any]] = []
    try:
        tags = await _extract_round_tags(session, conversation_id, user_id)
        if tags:
            yield {"type": "tag", "data": {"tags": tags}}
    except Exception as exc:  # noqa: BLE001
        logger.warning("SSE 画像回流失败 conversation_id=%s err=%s", conversation_id, sanitize(exc))

    yield {
        "type": "done",
        "message_id": message.id,
        "conversation_id": conversation_id,
        "conclusion_ready": has_conclusion(session, conversation_id),
    }


def has_conclusion(db: Session, conversation_id: UUID) -> bool:
    """done 事件的 ``conclusion_ready``：该会话是否已有可拉取的结论卡片（11.11）。"""
    conversation = db.get(Conversation, conversation_id)
    return bool(conversation and conversation.conclusion)


# ---------------------------------------------------------------------------
# 结论卡片（11.11）
# ---------------------------------------------------------------------------

async def get_conclusion(db: Session, user: User, conversation_id: UUID) -> ChatConclusionCard:
    """GET /chat/conversations/{id}/conclusion：结论卡片。

    已有缓存直接返回；没有则调用 ``chat_conclusion`` Prompt 生成并写回
    ``conversations.conclusion``。生成失败走 7.6 兜底模板。
    """
    conversation = get_conversation(db, user, conversation_id)

    if conversation.conclusion:
        card = ChatConclusionCard(conversation_id=conversation.id, **conversation.conclusion)
        if card.generated_at is None:
            card.generated_at = conversation.updated_at
        return card

    messages = _fetch_messages(db, conversation.id, 50)
    history_text = build_history_text(messages, limit=30)
    tags = profile_service.serialize_tags(profile_service.list_tags(db, user.id))
    stage = profile_service.get_stage(db, user.id)

    result: ConclusionCardResult = await deepseek_client.chat_prompt_json(
        prompt_name="chat_conclusion",
        variables={"history": history_text, "profile_tags": tags, "stage": stage},
        schema=ConclusionCardResult,
        default=empty_conclusion(),
        temperature=STRUCTURED_TEMPERATURE,
    )

    generated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    payload = {
        "summary": result.summary,
        "pain_points": result.pain_points,
        "suggestions": result.suggestions,
        "next_actions": result.next_actions,
        "generated_at": generated_at.isoformat(),
    }

    conversation.conclusion = payload
    conversation.updated_at = generated_at
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    # 11.11：结论卡片保存到报告（reports.type = "conclusion"）
    _save_conclusion_report(db, user.id, conversation.id, payload)

    return ChatConclusionCard(
        conversation_id=conversation.id,
        summary=result.summary,
        pain_points=result.pain_points,
        suggestions=result.suggestions,
        next_actions=result.next_actions,
        generated_at=generated_at,
    )


def _save_conclusion_report(db: Session, user_id, conversation_id: UUID, payload: Dict[str, Any]) -> None:
    """把结论卡片落一份到 reports（11.11）。"""
    from app.models.report import Report

    report = Report(
        user_id=user_id,
        type="conclusion",
        content={"conversation_id": str(conversation_id), **payload},
    )
    db.add(report)
    db.commit()


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
    message = Message(
        conversation_id=conversation.id,
        role="user",
        content=content,
        client_msg_id=client_msg_id,
    )
    db.add(message)
    conversation.updated_at = utcnow()
    db.add(conversation)
    db.commit()
    db.refresh(message)
    return message


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


def _shortcut_reply(content: str) -> Optional[str]:
    """7.6：拒绝回答 / 答不上来时不调模型，直接用本地模板 + 过渡语。"""
    if looks_like_refusal(content):
        return refusal_reply()
    if looks_like_stuck(content):
        return stuck_reply()
    return None


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

