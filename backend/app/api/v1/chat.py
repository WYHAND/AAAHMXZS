"""Chat 路由（10.2 Chat：conversations CRUD + messages + stream + conclusion）。

流式对话有两个端点，事件序列完全一致（共用 ``_event_generator``）：

- ``POST /chat/conversations/{id}/stream``：**前端正式使用**（fetch + ReadableStream，
  能带 Authorization 头与 JSON body，支持 client_msg_id 幂等）
- ``GET  /chat/conversations/{id}/stream?content=...``：**调试用**（curl / EventSource 兜底）

事件契约的完整说明见 backend/README.md「SSE 契约」，改动请同步两处。
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, AsyncGenerator, List
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.chat import (
    ChatConclusionCard,
    ChatRequest,
    ChatResponse,
    ConversationCreate,
    ConversationResponse,
    MessageResponse,
)
from app.services import chat_service
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat 职业指导对话"])

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # Nginx 下关闭缓冲，否则 SSE 会被攒着一起发
}


@router.post("/conversations", response_model=ApiResponse[ConversationResponse], summary="创建对话")
async def create_conversation(
    payload: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ConversationResponse]:
    return ApiResponse.ok(chat_service.create_conversation(db, current_user, payload))


@router.get("/conversations", response_model=ApiResponse[List[ConversationResponse]], summary="对话列表")
async def list_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[List[ConversationResponse]]:
    return ApiResponse.ok(chat_service.list_conversations(db, current_user))


@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=ApiResponse[List[MessageResponse]],
    summary="消息列表",
)
async def list_messages(
    conversation_id: UUID,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[List[MessageResponse]]:
    return ApiResponse.ok(chat_service.list_messages(db, current_user, conversation_id, limit))


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ApiResponse[ChatResponse],
    summary="发送消息（非流式）",
)
async def send_message(
    conversation_id: UUID,
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ChatResponse]:
    """非流式完整回复；前端流式请用下面的 /stream。"""
    return ApiResponse.ok(await chat_service.send_message(db, current_user, conversation_id, payload))


SSE_DESCRIPTION = (
    "SSE 事件流（事件契约的完整说明见 backend/README.md「SSE 契约」）。\n\n"
    "每个事件的 data 恒为 10.1 的信封，内部 data.type 与 ``event:`` 行一致：\n"
    'start:   {"code":0,"message":"success","data":{"type":"start","conversation_id":"...",'
    '"followup_round":2,"followup_direction":"兴趣"}}\n'
    'delta:   {"code":0,"message":"success","data":{"type":"delta","content":"增量文本",'
    '"conversation_id":"...","followup_round":2,"followup_direction":"兴趣"}}\n'
    'tag:     {"code":0,"message":"success","data":{"type":"tag","data":{"tags":[...]}}}\n'
    'pending: {"code":0,"message":"正在生成","data":{"type":"pending","user_message_id":"..."}}\n'
    'done:    {"code":0,"message":"success","data":{"type":"done","message_id":"...",'
    '"conversation_id":"...","conclusion_ready":false,"followup_round":3,"followup_direction":"兴趣"}}\n'
    'error:   {"code":3001,"message":"AI调用失败","data":null}\n'
    "流末尾固定补一个 ``event: end`` + ``data: [DONE]``。\n\n"
    "followup_round 语义：start/delta 是**这一轮开始前**的值，done 是**本轮更新后**的值；\n"
    "相邻两轮方向不同（followup_direction 变化）时数值会重置为 1；\n"
    "只有拿不到画像标签且会话尚未开始计数时才会是 null（前端此时隐藏进度环）。\n\n"
    "两个端点（POST 与 GET）共用同一个事件生成器，事件序列完全一致。"
)


def _json_default(value: Any) -> Any:
    """SSE 事件的 JSON 兜底序列化。

    ⚠️ 为什么必须有：service 层往事件字典里塞的是**ORM 原始值**，其中
    ``conversation_id`` / ``message_id`` / ``user_message_id`` 都是 ``uuid.UUID``，
    ``created_at`` 是 ``datetime``。Python 的 ``json.dumps`` 不认识它们，
    会抛 ``TypeError: Object of type UUID is not JSON serializable``。
    而这个异常发生在**生成器内部**（流已经开始），只能被吞成 ``event: error``，
    前端看到的是「服务器内部错误」——整条流式对话因此 100% 不可用，
    而日志里只有一行 err 信息、没有 traceback，极难定位（实际就踩过）。

    UUID / 日期统一转字符串（与 API JSON 的表示一致）；其它类型仍抛错，
    避免悄悄产出前端无法使用的字段。
    """
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError(f"SSE 事件包含不可序列化的类型: {type(value).__name__}")


def _sse_data(payload: dict) -> str:
    """把事件负载序列化成一行 ``data:`` 内容。"""
    return json.dumps(payload, ensure_ascii=False, default=_json_default)


async def _immediate_stream(prep: "chat_service.StreamPreparation") -> AsyncGenerator[str, None]:
    """幂等命中时的「一次性事件流」（FIX 1 / 4.3）。

    仍然用 ``text/event-stream`` 返回，但一个 chunk 就结束：
    - 上一轮已完成 -> 发 ``pending``（带 replay_message_id，前端据此拉消息列表）
    - 上一轮还在生成 -> 也发 ``pending``（没有 replay 就是「等上一轮」）
    """
    data = (
        {"type": "pending", "replay_message_id": str(prep.replay_reply.id)}
        if prep.replay_reply is not None
        else {"type": "pending", "pending": True}
    )
    payload = {"code": 0, "message": "该消息已提交过，未重复生成", "data": data}
    yield f"event: pending\ndata: {_sse_data(payload)}\n\n"
    yield "event: end\ndata: [DONE]\n\n"


@router.post(
    "/conversations/{conversation_id}/stream",
    summary="SSE 流式对话（前端使用，POST + JSON body）",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": SSE_DESCRIPTION}},
)
async def stream_post(
    conversation_id: UUID,
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """7.2 SSE 流式：**前端正式使用**的流式端点。

    为什么是 POST：``EventSource`` 既不能带 ``Authorization`` 头也不能带请求体，
    前端用 ``fetch`` + ``ReadableStream`` 消费本端点。

    幂等（设计文档 4.3）：``client_msg_id`` 重复提交时不会插第二条用户消息、
    也不会再调一次 AI，只回一个 ``pending`` 事件。

    ⚠️ Session 生命周期见 ``chat_service.prepare_stream`` 的长注释。
    """
    prep = chat_service.prepare_stream(
        db, current_user, conversation_id, payload.content, payload.client_msg_id
    )
    # ⚠️ 必须在生成器**外面**、请求级 Session 还活着的时候取 user_id（FIX 2）
    user_id = current_user.id
    generator = _immediate_stream(prep) if prep.is_duplicate else _event_generator(prep, user_id)
    return StreamingResponse(generator, media_type="text/event-stream", headers=SSE_HEADERS)


@router.get(
    "/conversations/{conversation_id}/stream",
    summary="SSE 流式对话（调试用，前端不调用）",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": SSE_DESCRIPTION}},
)
async def stream_get(
    conversation_id: UUID,
    content: str = Query(..., min_length=1, max_length=2000, description="用户这句话（EventSource 无法带 body）"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """**调试用** SSE 端点（curl / 手册 8.4 的 EventSource 兜底）。前端请用上面的 POST。

    - 走 query 参数传用户这句话，因此没有 ``Authorization`` 之外的额外能力，也无法带 body；
    - 不支持 ``client_msg_id``（EventSource 场景没有重试语义）；
    - 事件序列与 POST 完全一致（共用 ``_event_generator``）。
    """
    prep = chat_service.prepare_stream(db, current_user, conversation_id, content, None)
    user_id = current_user.id
    generator = _immediate_stream(prep) if prep.is_duplicate else _event_generator(prep, user_id)
    return StreamingResponse(generator, media_type="text/event-stream", headers=SSE_HEADERS)


def _event_generator(prep: "chat_service.StreamPreparation", user_id: UUID) -> AsyncGenerator[str, None]:
    """SSE 事件生成器（FIX 1：两个端点共用这一份逻辑；FIX 2：自开会话）。

    ⚠️ 为什么在这里 ``SessionLocal()`` 自开会话，而不用 ``Depends(get_db)`` 的：

    FastAPI 的依赖（含 ``get_db`` 的 ``finally: db.close()``）在**响应开始返回时**
    就会被清理，而 ``StreamingResponse`` 的 body 是之后才被逐块消费的。
    也就是说：如果沿用请求级 Session，生成器里 ``session.commit()``
    （保存 assistant 消息、写画像标签）极可能作用在一个**已关闭的 Session** 上，
    轻则报错、重则静默丢数据。

    同理，``current_user`` 是绑定在那个已关闭 Session 上的 ORM 实例：
    进生成器后访问任何未加载属性都会 ``DetachedInstanceError``。
    所以这里只传 ``user_id``（纯数据，在请求级 Session 还活着时取出），
    生成器内部需要用户对象时用新 Session 自己 ``get``。
    """

    async def generator() -> AsyncGenerator[str, None]:
        # FIX 2：生成器内部自开会话，生命周期与流完全对齐
        session = SessionLocal()
        try:
            async for event in chat_service.stream_reply(
                session,
                user_id,
                prep.conversation_id,
                prep.llm_messages,
                prep.shortcut,
                prep.followup,
            ):
                payload = _to_sse_payload(event)
                yield f"event: {event.get('type', 'message')}\ndata: {_sse_data(payload)}\n\n"
            yield "event: end\ndata: [DONE]\n\n"
        except Exception as exc:  # noqa: BLE001 - 流已开始，只能以 error 事件收尾
            # 用 exception() 而不是 error()：流内异常此前只留一行 err 文本、没有 traceback，
            # 排查 "Object of type UUID is not JSON serializable" 时几乎无从下手。
            logger.exception("SSE 生成器异常 conversation_id=%s err=%s", prep.conversation_id, sanitize(exc))
            error_payload = _sse_data({"code": 5000, "message": "服务器内部错误", "data": None})
            yield f"event: error\ndata: {error_payload}\n\n"
            yield "event: end\ndata: [DONE]\n\n"
        finally:
            session.close()

    return generator()


def _to_sse_payload(event: dict) -> dict:
    """把 service 事件字典转成 10.1 语义的 ``{code,message,data}``。

    恒为 ``{code,message,data}`` 三字段信封；``data`` 内保留 ``type`` 字段，
    与 SSE 的 ``event:`` 行一致，前端任选其一分派。
    """
    event_type = event.get("type", "delta")
    if event_type == "error":
        return {
            "code": int(event.get("code", 3001)),
            "message": str(event.get("message", "AI调用失败")),
            "data": None,
        }
    data = {k: v for k, v in event.items() if k != "type"}
    return {"code": 0, "message": "success", "data": {"type": event_type, **data}}


@router.get(
    "/conversations/{conversation_id}/conclusion",
    response_model=ApiResponse[ChatConclusionCard],
    summary="结论卡片",
)
async def conclusion(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ChatConclusionCard]:
    """11.11：结构化诊断卡；首次调用生成并缓存到 conversations.conclusion。"""
    return ApiResponse.ok(await chat_service.get_conclusion(db, current_user, conversation_id))
