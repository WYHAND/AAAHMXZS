"""Chat 路由（10.2 Chat：conversations CRUD + messages + stream）。

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


@router.delete(
    "/conversations/{conversation_id}",
    response_model=ApiResponse[None],
    summary="删除对话（连同其全部消息）",
)
async def delete_conversation(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[None]:
    """删除一个对话及其全部消息。

    - 不存在**或不属于当前用户** -> 404 + ``code 2001``（不区分，避免枚举 oracle，见 README §8.1）；
    - **不会触碰 ``profiles`` / ``profile_tags``**：画像按 ``user_id`` 独立存储，
      删聊天记录不影响画像（这是产品决策，见 README §8 与 §4.14）；
    - 重复删除同一个 id 第二次返回 2001（已不存在），符合预期。

    响应固定 ``{code:0, message:"success", data:null}``。
    """
    chat_service.delete_conversation(db, current_user, conversation_id)
    return ApiResponse.ok(None)


@router.post(
    "/conversations/{conversation_id}/opening",
    response_model=ApiResponse[MessageResponse],
    summary="获取/生成 AI 开场白（让 AI 先开口）",
)
async def ensure_opening(
    conversation_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[MessageResponse]:
    """新建会话后调用：确保会话里有一句 AI 开场白，并返回那条消息。

    为什么由后端生成、并且**落库成一条真正的 assistant 消息**：
    前端自己拼一句"你好，我是你的就业助手"会带来三个问题 ——
    它不在数据库里（刷新/换设备就没了）、不进 LLM 上下文（模型不知道自己说过这句）、
    也不算进 ``message_count``（列表里显示 0 条）。落库后这些都自然成立。

    行为约定（三种情况）：

    1. **已有开场白** -> 回放同一条（幂等）。前端"进入会话就调一次"的写法
       会反复命中这里，永远不会产生第二条开场白。
    2. **会话没有任何消息** -> 生成开场白：由模型自由发挥（纯文本 + 思考），
       不设话题池、不设字数上限。Prompt 只要求温和、有吸引力、不编造关于他的事实。
       模型不可用时**直接返回 AI_ERROR**，由前端明确提示"服务暂时不可用"，不再假装说话。
    3. **会话已有消息但没有开场白**（用户先说了话，例如前端没调本接口）
       -> 返回 ``{code:0, message:"会话已有消息，未生成开场白", data:null}``。
       这时补一句开场白会插在用户消息**之后**，变成 AI 在自言自语，所以不做。

    生成的这条消息 ``role`` 是 ``assistant``，``client_msg_id`` 是系统保留值
    ``sys:opening``（详见 ``chat_service.OPENING_CLIENT_MSG_ID`` 的说明）；
    它不会写任何画像标签 —— 没有任何用户输入，就没有可回流的信息（"声称 ≠ 证据"）。
    """
    message = await chat_service.ensure_opening_message(db, current_user, conversation_id)
    if message is None:
        return ApiResponse.ok(None, "会话已有消息，未生成开场白")
    return ApiResponse.ok(message)


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
    'start:   {"code":0,"message":"success","data":{"type":"start","conversation_id":"..."}}\n'
    'delta:   {"code":0,"message":"success","data":{"type":"delta","content":"增量文本",'
    '"conversation_id":"..."}}\n'
    'tag:     {"code":0,"message":"success","data":{"type":"tag","data":{"tags":[...]}}}\n'
    'pending: {"code":0,"message":"正在生成","data":{"type":"pending","user_message_id":"..."}}\n'
    'done:    {"code":0,"message":"success","data":{"type":"done","message_id":"...",'
    '"conversation_id":"..."}}\n'
    'error:   {"code":3001,"message":"AI调用失败","data":null}\n'
    "流末尾固定补一个 ``event: end`` + ``data: [DONE]``。\n\n"
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
        completed = False
        try:
            async for event in chat_service.stream_reply(
                session,
                user_id,
                prep.conversation_id,
                prep.llm_messages,
                prep.brief,
            ):
                payload = _to_sse_payload(event)
                yield f"event: {event.get('type', 'message')}\ndata: {_sse_data(payload)}\n\n"
            completed = True
            yield "event: end\ndata: [DONE]\n\n"
        except Exception as exc:  # noqa: BLE001 - 流已开始，只能以 error 事件收尾
            # 用 exception() 而不是 error()：流内异常此前只留一行 err 文本、没有 traceback，
            # 排查 "Object of type UUID is not JSON serializable" 时几乎无从下手。
            logger.exception("SSE 生成器异常 conversation_id=%s err=%s", prep.conversation_id, sanitize(exc))
            error_payload = _sse_data({"code": 5000, "message": "服务器内部错误", "data": None})
            yield f"event: error\ndata: {error_payload}\n\n"
            yield "event: end\ndata: [DONE]\n\n"
        finally:
            if not completed:
                # 客户端断开 / 取消：助手回复没落库时清掉这条用户消息，
                # 否则同一 client_msg_id 的重试会永远命中 pending（死循环）。
                # 已落库的回复不会被删（函数内部会再查一次）。
                chat_service.discard_unanswered_user_message(
                    session,
                    prep.user_message.id if prep.user_message is not None else None,
                )
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
