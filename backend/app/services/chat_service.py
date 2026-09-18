"""AI 职业指导对话业务逻辑（手册 11.4、7.2、7.7、7.8、11.11）。

关键点：
- ``send_message``：非流式完整回复
- ``prepare_stream``：SSE 前的同步准备（存用户消息、取出 LLM 上下文），
  真正的流式生成在 ``stream_reply`` 里做
- ``stream_reply``：异步生成器，逐块产出文本；结束时把完整回复落库并回流画像
- 7.7 追问计数与输出截断、7.6 兜底都在这里落地
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple
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
from app.core.errors import BusinessException, ErrorCode
from app.models.conversation import Conversation, Message
from app.models.user import User, utcnow
from app.schemas.chat import (
    ChatConclusionCard,
    ChatRequest,
    ChatResponse,
    ConversationCreate,
    ConversationResponse,
    MessageResponse,
)
from app.services import profile_service
from app.utils.logger import get_logger, sanitize
from app.utils.text import (
    MAX_ASSISTANT_CHARS,
    build_history_text,
    looks_like_refusal,
    looks_like_stuck,
    truncate,
)

logger = get_logger(__name__)

# 传给模型的历史消息条数上限（控制 token 成本）
HISTORY_LIMIT = 12

# 7.7 过渡语：本地维护 30 条，随机选择（见 app/utils/text.py: TRANSITION_PHRASES）
TRANSITION_COUNT = 30


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
    """取对话并做归属校验（14.5：用户只能访问自己的数据）。"""
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise BusinessException(ErrorCode.NOT_FOUND, "对话不存在")
    if conversation.user_id != user.id:
        raise BusinessException(ErrorCode.FORBIDDEN, "无权访问该对话")
    return conversation


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
    statement = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())  # type: ignore[union-attr]
        .limit(limit)
    )
    return list(db.exec(statement).all())


def _count_messages(db: Session, conversation_id: UUID) -> int:
    return len(db.exec(select(Message.id).where(Message.conversation_id == conversation_id)).all())


def _recent_messages(db: Session, conversation_id: UUID, limit: int = HISTORY_LIMIT) -> List[Message]:
    """取最近 limit 条（按时间正序返回，供拼 Prompt）。"""
    statement = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())  # type: ignore[union-attr]
        .limit(limit)
    )
    items = list(db.exec(statement).all())
    return list(reversed(items))


def _build_llm_messages(db: Session, conversation: Conversation, user: User) -> List[Dict[str, str]]:
    """组装发给 DeepSeek 的 messages（14.7：系统 Prompt 与用户输入分离）。"""
    system_prompt = load_prompt("chat_system")
    tags = profile_service.list_tags(db, user.id)
    stage = profile_service.get_stage(db, user.id)

    context_lines = [
        f"当前学生所处阶段：{stage}",
        f"已知画像标签：{profile_service.serialize_tags(tags) if tags else '暂无'}",
        "注意：以上是背景信息，不要直接念出来，用于决定你追问的方向。",
    ]
    system_content = system_prompt + "\n\n【当前用户背景】\n" + "\n".join(context_lines)

    llm_messages: List[Dict[str, str]] = [{"role": "system", "content": system_content}]
    for message in _recent_messages(db, conversation.id, HISTORY_LIMIT):
        if message.role in {"user", "assistant"}:
            llm_messages.append({"role": message.role, "content": message.content})
    return llm_messages


# ---------------------------------------------------------------------------
# 发送消息（非流式）
# ---------------------------------------------------------------------------

async def send_message(db: Session, user: User, conversation_id: UUID, payload: ChatRequest) -> ChatResponse:
    """POST /chat/conversations/{id}/messages：一次性返回完整回复。"""
    conversation = get_conversation(db, user, conversation_id)
    user_message = _save_user_message(db, conversation, payload.content)

    # 7.6 边界：拒绝回答 / 答不上来，走本地模板，不调用模型
    shortcut = _shortcut_reply(payload.content)
    if shortcut is not None:
        assistant_text = shortcut
    else:
        llm_messages = _build_llm_messages(db, conversation, user)
        assistant_text = await deepseek_client.chat_text(llm_messages)

    assistant_message = _save_assistant_message(db, conversation, assistant_text)

    # 7.8 画像回流：每轮结束后抽取标签
    extracted_tags = await _extract_round_tags(db, conversation, user)

    return ChatResponse(
        conversation_id=conversation.id,
        user_message=MessageResponse.model_validate(user_message),
        assistant_message=MessageResponse.model_validate(assistant_message),
        extracted_tags=extracted_tags,
    )


# ---------------------------------------------------------------------------
# 发送消息（SSE 流式，7.2）
# ---------------------------------------------------------------------------

def prepare_stream(db: Session, user: User, conversation_id: UUID, content: str) -> Tuple[Conversation, Message, List[Dict[str, str]], Optional[str]]:
    """SSE 端点在做流式响应前的同步准备。

    返回 ``(conversation, user_message, llm_messages, shortcut)``。
    - ``shortcut`` 非空表示命中 7.6 本地模板，直接吐这段文本，不用调模型；
    - 因为 ``StreamingResponse`` 已经开始后无法再依赖请求级依赖注入的 Session，
      所以这里必须**先把 DB 操作做完**，再交给异步生成器。
    """
    conversation = get_conversation(db, user, conversation_id)
    user_message = _save_user_message(db, conversation, content)
    shortcut = _shortcut_reply(content)
    llm_messages = [] if shortcut else _build_llm_messages(db, conversation, user)
    return conversation, user_message, llm_messages, shortcut


async def stream_reply(
    db: Session,
    user: User,
    conversation: Conversation,
    llm_messages: List[Dict[str, str]],
    shortcut: Optional[str] = None,
) -> AsyncGenerator[Dict[str, Any], None]:
    """SSE 用的异步生成器：产出 ``{"type": "delta", "content": ...}`` 等事件。

    流程：
    1. 先发 start 事件
    2. 逐块 yield delta（命中 shortcut 就一次性 yield）
    3. 累积完整文本 -> 截断到 300 字（7.7）-> 落库
    4. 7.8 回流画像标签 -> 发 tag 事件
    5. 发 done 事件（带 message_id）
    """
    conversation_id = conversation.id
    yield {"type": "start", "conversation_id": conversation_id}

    buffer: List[str] = []
    try:
        if shortcut is not None:
            buffer.append(shortcut)
            yield {"type": "delta", "content": shortcut}
        else:
            async for piece in deepseek_client.stream_chat(llm_messages):
                buffer.append(piece)
                yield {"type": "delta", "content": piece}
    except Exception as exc:  # noqa: BLE001 - 7.6 兜底：流式失败也不能 500
        logger.error("SSE 流式生成异常 conversation_id=%s err=%s", conversation_id, sanitize(exc))
        if not buffer:
            fallback = fallback_reply()
            buffer.append(fallback)
            yield {"type": "delta", "content": fallback}
        yield {"type": "error", "code": int(ErrorCode.AI_ERROR), "message": "AI 回复中断，已切换兜底话术"}

    full_text = truncate("".join(buffer), MAX_ASSISTANT_CHARS)

    message = _save_assistant_message(db, conversation, full_text)

    try:
        tags = await _extract_round_tags(db, conversation, user)
        if tags:
            yield {"type": "tag", "data": {"tags": tags}}
    except Exception as exc:  # noqa: BLE001
        logger.warning("SSE 画像回流失败 conversation_id=%s err=%s", conversation_id, sanitize(exc))

    yield {"type": "done", "message_id": message.id, "conversation_id": conversation_id}


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

def _save_user_message(db: Session, conversation: Conversation, content: str) -> Message:
    message = Message(conversation_id=conversation.id, role="user", content=content)
    db.add(message)
    conversation.updated_at = utcnow()
    db.add(conversation)
    db.commit()
    db.refresh(message)
    return message


def _save_assistant_message(db: Session, conversation: Conversation, content: str) -> Message:
    message = Message(conversation_id=conversation.id, role="assistant", content=content)
    db.add(message)
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


async def _extract_round_tags(db: Session, conversation: Conversation, user: User) -> List[Dict[str, Any]]:
    """7.8：每轮对话结束后抽取画像标签。失败返回空列表。"""
    messages = _recent_messages(db, conversation.id, 8)
    history = build_history_text(messages)
    last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
    return await profile_service.extract_tags_from_text(db, user.id, f"{history}\n\n【最近一轮】\n{last_user}", source="chat")
