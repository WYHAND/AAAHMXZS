"""AI 职业指导对话业务逻辑（手册 11.4、7.2、7.7、7.8、11.11）。

关键点：
- ``send_message``：非流式完整回复
- ``prepare_stream``：SSE 前的同步准备（存用户消息、取出 LLM 上下文），
  真正的流式生成在 ``stream_reply`` 里做
- ``stream_reply``：异步生成器，逐块产出文本；结束时把完整回复落库并回流画像
- 7.7 追问计数与输出截断、7.6 兜底都在这里落地
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional
from uuid import UUID

from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import (
    STRUCTURED_TEMPERATURE,
    fallback_reply,
    refusal_reply,
    stuck_reply,
)
from app.ai.parser import load_prompt
from app.ai.schemas import ConclusionCardResult, empty_conclusion
from app.core.errors import BusinessException, ErrorCode, not_found_unless_owner
from app.models.conversation import Conversation, Message
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
from app.utils.text import (
    MAX_ASSISTANT_CHARS,
    MAX_FOLLOWUP_ROUNDS,
    build_history_text,
    looks_like_refusal,
    looks_like_stuck,
    truncate,
)

logger = get_logger(__name__)

# 传给模型的历史消息条数上限（控制 token 成本）
HISTORY_LIMIT = 12

# 7.7：同一方向最多追问轮数；达到后 Prompt 会强制要求换维度。
# 这是 7.7 的核心业务规则，本模块是唯一权威定义处；
# utils/text.py 里保留了同名的历史别名（供过渡语/文本工具参考），改动请以本文件为准。
FOLLOWUP_ROUND_LIMIT = 3


@dataclass
class FollowupState:
    """7.7 追问计数器的快照（**会话级状态**，存在 ``conversations`` 表上）。

    - ``direction``：会话当前正在挖掘的维度（``None`` 表示还没开始计数）
    - ``round``：该方向已经追问的轮数（0 表示还没开始计数）
    - ``warning``：是否已达上限 -> 本轮 Prompt 需要注入「必须换维度」的指令
      （由 ``direction`` 与 ``round`` 派生）
    """

    direction: Optional[str] = None
    round: int = 0

    @property
    def warning(self) -> bool:
        return bool(self.direction) and self.round >= FOLLOWUP_ROUND_LIMIT

    @property
    def event_round(self) -> Optional[int]:
        """发给前端进度环的数值（``start`` / ``delta`` 用「这一轮开始前」的值）。

        0（还没开始计数）对外返回 ``None``，前端据此隐藏进度环。
        """
        return self.round or None


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
    # 这一轮开始前的追问状态（给 start/delta 事件用）
    followup: FollowupState = field(default_factory=FollowupState)
    # 幂等命中时填充：上一次的助手回复（可能为 None 表示还在生成中）
    replay_reply: Optional[MessageResponse] = None
    pending: Optional[PendingChatResponse] = None


# ---------------------------------------------------------------------------
# 对话 CRUD
# ---------------------------------------------------------------------------

def create_conversation(db: Session, user: User, payload: ConversationCreate) -> ConversationResponse:
    """POST /chat/conversations：创建对话。"""
    conversation = Conversation(user_id=user.id, title=payload.title or "新的职业对话")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return to_conversation_response(db, conversation)


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
    followup: Optional[FollowupState] = None,
) -> List[Dict[str, str]]:
    """组装发给 DeepSeek 的 messages（14.7：系统 Prompt 与用户输入分离）。

    7.7 第 3 步：如果同一方向已经聊满 ``FOLLOWUP_ROUND_LIMIT`` 轮，就在系统
    Prompt 后面注入一句**明确的换维度指令**（不靠模型自觉）。
    """
    system_prompt = load_prompt("chat_system")
    tags = profile_service.list_tags(db, user.id)
    stage = profile_service.get_stage(db, user.id)

    context_lines = [
        f"当前学生所处阶段：{stage}",
        f"已知画像标签：{profile_service.serialize_tags(tags) if tags else '暂无'}",
        "注意：以上是背景信息，不要直接念出来，用于决定你追问的方向。",
    ]

    state = followup or FollowupState()
    if state.direction:
        context_lines.append(
            f"当前挖掘维度：{state.direction}，已经在方向上聊了 {state.round} 轮。"
        )
    if state.warning:
        # 规则 3：连续追问满 3 轮，这一轮必须换维度（硬约束，写进 system Prompt）
        context_lines.append(
            f"【硬约束】你已经连续 {state.round} 轮围绕「{state.direction}」追问，"
            "本轮必须换到另一个维度（从：兴趣、能力、技能、痛点、焦虑、认知 中另选一个），"
            "不要再问这个方向的问题；先用一句话收束上一轮，再自然过渡到新方向。"
        )

    system_content = system_prompt + "\n\n【当前用户背景】\n" + "\n".join(context_lines)

    # content 里只存纯原话（幂等 id 在 Message.client_msg_id 列上），无需任何 strip
    llm_messages: List[Dict[str, str]] = [{"role": "system", "content": system_content}]
    for message in _recent_messages(db, conversation.id, HISTORY_LIMIT):
        if message.role in {"user", "assistant"}:
            llm_messages.append({"role": message.role, "content": message.content})
    return llm_messages


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
        )
    if existing_user is not None:
        # 上一轮还在生成中：不重复调 AI，也不重复插消息。
        # 这里刻意用不带 status_code 的 BusinessException -> HTTP 200 + code 1001，
        # 因为"稍后再试"是正常的业务状态，不是客户端错误。
        raise BusinessException(ErrorCode.PARAM_ERROR, "该消息正在生成回复，请勿重复提交")

    user_message = _persist_user_message(db, conversation, payload.content, payload.client_msg_id)

    # 7.7 这一步开始前的追问状态（用于给 Prompt 注入换维度指令）。
    # 用 db.get 重新取一次：conversation 实例可能已被前面的 commit() expire，
    # 重新取能保证一定拿到当前值（SQLAlchemy 也只会发一条 SELECT 或直接走 identity map）。
    state = read_followup_state(db.get(Conversation, conversation.id) or conversation)

    # 7.6 边界：拒绝回答 / 答不上来，走本地模板，不调用模型
    shortcut = _shortcut_reply(payload.content)
    if shortcut is not None:
        assistant_text = shortcut
    else:
        llm_messages = _build_llm_messages(db, conversation, user, state)
        assistant_text = await deepseek_client.chat_text(llm_messages)

    assistant_message = _save_assistant_message(db, conversation.id, assistant_text)

    # 7.8 画像回流：每轮结束后抽取标签
    extracted_tags = await _extract_round_tags(db, conversation.id, user.id)

    # 7.7 计数器：拿标签推主导维度并推进轮次（拿不到标签则保持原值）
    update_followup_state(db, conversation.id, extracted_tags)

    return ChatResponse(
        conversation_id=conversation.id,
        user_message=MessageResponse.model_validate(user_message),
        assistant_message=MessageResponse.model_validate(assistant_message),
        extracted_tags=extracted_tags,
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

    user_message = _persist_user_message(db, conversation, content, client_msg_id)
    # 7.7：读这一步开始前的追问状态（既用于 Prompt 换维度指令，也用于 start/delta 事件）。
    # 同样用 db.get 重新取，避免拿到被 commit() expire 的实例。
    state = read_followup_state(db.get(Conversation, conversation.id) or conversation)
    shortcut = _shortcut_reply(content)
    llm_messages = [] if shortcut else _build_llm_messages(db, conversation, user, state)

    return StreamPreparation(
        is_duplicate=False,
        conversation_id=conversation.id,
        user_message=MessageResponse.model_validate(user_message),
        llm_messages=llm_messages,
        shortcut=shortcut,
        followup=state,
    )


async def stream_reply(
    session: Session,
    user_id: UUID,
    conversation_id: UUID,
    llm_messages: Optional[List[Dict[str, str]]] = None,
    shortcut: Optional[str] = None,
    followup: Optional[FollowupState] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """SSE 用的异步生成器：产出 ``{"type": ..., ...}`` 事件字典（7.2 + 设计文档 5.4）。

    ⚠️ Session 生命周期（FIX 2）：``session`` 必须是**生成器自己开、自己关**的
    会话，例如 ``SessionLocal()``；**绝不能**传请求级 ``Depends(get_db)`` 的 Session
    —— 那个 Session 在响应开始返回时就被 FastAPI 清理了，而本生成器的 body 是之后
    才被消费的。同理 ``user`` 只以 ``user_id`` 形式传入：请求级 Session 上的 User
    实例此时已 detached，访问任何未加载属性都会 ``DetachedInstanceError``。

    流程：
    1. 先发 start 事件（带 conversation_id + 这一轮开始前的 followup_round / direction）
    2. 逐块 yield delta（命中 7.6 本地模板就一次性 yield）
    3. 累积完整文本 -> 截断到 300 字（7.7）-> 落库
    4. 7.8 回流画像标签 -> 发 tag 事件
    5. 7.7 推进追问计数器 -> 发 done 事件（带**更新后**的 followup_round / direction）
    """
    state = followup or FollowupState()
    start_round = state.event_round  # 这一轮开始前的值（前端进度环的起点）

    yield {
        "type": "start",
        "conversation_id": conversation_id,
        "followup_round": start_round,
        "followup_direction": state.direction,
    }

    buffer: List[str] = []
    try:
        if shortcut is not None:
            buffer.append(shortcut)
            yield {
                "type": "delta",
                "content": shortcut,
                "followup_round": start_round,
                "followup_direction": state.direction,
            }
        else:
            async for piece in deepseek_client.stream_chat(llm_messages or []):
                buffer.append(piece)
                yield {
                    "type": "delta",
                    "content": piece,
                    "followup_round": start_round,
                    "followup_direction": state.direction,
                }
    except Exception as exc:  # noqa: BLE001 - 7.6 兜底：流式失败也不能 500
        logger.error("SSE 流式生成异常 conversation_id=%s err=%s", conversation_id, sanitize(exc))
        if not buffer:
            fallback = fallback_reply()
            buffer.append(fallback)
            yield {
                "type": "delta",
                "content": fallback,
                "followup_round": start_round,
                "followup_direction": state.direction,
            }
        yield {"type": "error", "code": int(ErrorCode.AI_ERROR), "message": "AI 回复中断，已切换兜底话术"}

    full_text = truncate("".join(buffer), MAX_ASSISTANT_CHARS)
    message = _save_assistant_message(session, conversation_id, full_text)

    tags: List[Dict[str, Any]] = []
    try:
        tags = await _extract_round_tags(session, conversation_id, user_id)
        if tags:
            yield {"type": "tag", "data": {"tags": tags}}
    except Exception as exc:  # noqa: BLE001
        logger.warning("SSE 画像回流失败 conversation_id=%s err=%s", conversation_id, sanitize(exc))

    # 7.7：用本轮抽到的标签推进计数器（拿不到标签就保持原值，不清零）
    updated = update_followup_state(session, conversation_id, tags)

    yield {
        "type": "done",
        "message_id": message.id,
        "conversation_id": conversation_id,
        "followup_round": updated.event_round,          # 更新后的值
        "followup_direction": updated.direction,        # 更新后的维度
        "conclusion_ready": has_conclusion(session, conversation_id),
    }


def has_conclusion(db: Session, conversation_id: UUID) -> bool:
    """done 事件的 ``conclusion_ready``：该会话是否已有可拉取的结论卡片（11.11）。"""
    conversation = db.get(Conversation, conversation_id)
    return bool(conversation and conversation.conclusion)


# ---------------------------------------------------------------------------
# 7.7 追问计数器（会话级状态）
# ---------------------------------------------------------------------------

# 主导维度的裁决顺序（附录A 的维度清单，与 profile_extract Prompt 的枚举一致）
DIMENSION_PRIORITY: tuple[str, ...] = ("痛点", "技能", "能力", "兴趣", "焦虑", "认知")


def dominant_dimension(tags: Optional[List[Dict[str, Any]]]) -> Optional[str]:
    """从本轮抽取到的画像标签里取**主导维度**（7.7 第 1 步）。

    裁决规则（依次比较，写死在这里便于追溯）：
    1. 只考虑附录A 的正式维度（``其他`` 与空值忽略）；
    2. 先比「该维度下所有标签的权重之和」，大者胜（权重代表证据强度）；
    3. 权重和相同（例如各 1 条 0.8）时比「标签条数」，多者胜；
    4. 仍相同则按 ``DIMENSION_PRIORITY`` 的顺序取靠前者（保证结果确定，不随 dict 顺序漂移）。

    返回 ``None`` 表示本轮没有可用标签 -> 调用方应保持不变，不推进轮次。
    """
    if not tags:
        return None

    weight_sum: Dict[str, float] = {}
    count: Dict[str, int] = {}
    for tag in tags:
        if not isinstance(tag, dict):
            continue
        dimension = str(tag.get("dimension") or "").strip()
        if dimension not in DIMENSION_PRIORITY:
            continue
        try:
            weight = float(tag.get("weight") or 0.0)
        except (TypeError, ValueError):
            weight = 0.0
        weight_sum[dimension] = weight_sum.get(dimension, 0.0) + weight
        count[dimension] = count.get(dimension, 0) + 1

    if not weight_sum:
        return None

    def rank(dimension: str) -> tuple:
        # 排序键：权重和 -> 条数 -> 优先级位置（越小越优先）-> 名称（兜底确定性）
        return (
            -weight_sum[dimension],
            -count[dimension],
            DIMENSION_PRIORITY.index(dimension),
            dimension,
        )

    return sorted(weight_sum.keys(), key=rank)[0]


def read_followup_state(conversation: Conversation) -> FollowupState:
    """把 ``conversations`` 上的计数器读成快照（ORM 实例 -> 纯数据）。"""
    return FollowupState(
        direction=conversation.followup_direction or None,
        round=int(conversation.followup_round or 0),
    )


def update_followup_state(
    db: Session,
    conversation_id: UUID,
    tags: Optional[List[Dict[str, Any]]],
) -> FollowupState:
    """7.7 第 2 步：按本轮标签推进追问计数器，并返回更新后的快照。

    - 主导维度 == 当前方向 -> ``followup_round += 1``
    - 主导维度 != 当前方向或当前为空 -> ``followup_direction = 新维度``，``followup_round = 1``
    - 拿不到标签（AI 兜底 / 解析失败 / 无正式维度）-> **原值不变，不清零**
    """
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        logger.warning("追问计数：会话不存在 conversation_id=%s", conversation_id)
        return FollowupState()

    current = read_followup_state(conversation)
    dimension = dominant_dimension(tags)

    if dimension is None:
        # 第 5 条要求：拿不到标签时保持原值，不要清零
        logger.debug("追问计数：本轮无可用标签，保持 direction=%s round=%s",
                     current.direction, current.round)
        return current

    if current.direction and dimension == current.direction:
        new_round = current.round + 1
    else:
        new_round = 1

    conversation.followup_direction = dimension
    conversation.followup_round = new_round
    conversation.updated_at = utcnow()
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    if new_round == FOLLOWUP_ROUND_LIMIT:
        logger.info(
            "追问计数：方向「%s」已连续 %s 轮，下一轮将注入换维度指令 conversation_id=%s",
            dimension, new_round, conversation_id,
        )
    return read_followup_state(conversation)


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

    注：``content`` 现在只存纯原话（幂等 id 在独立列上），因此这里**不需要任何 strip**。
    """
    messages = _recent_messages(db, conversation_id, 8)
    history = build_history_text(messages)
    last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
    return await profile_service.extract_tags_from_text(
        db, user_id, f"{history}\n\n【最近一轮】\n{last_user}", source="chat"
    )

