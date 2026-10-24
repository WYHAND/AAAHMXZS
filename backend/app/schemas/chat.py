"""chat 相关 schema（AI 职业指导对话，11.4）。

SSE 事件契约的权威说明在 ``backend/README.md`` 的「SSE 契约」一节；
本文件里的 ``SSEEvent`` / ``SSEEventType`` 是它的代码化表达，改动请同步两处。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

# SSE 事件类型（前端可按 SSE 的 ``event:`` 行或 data 里的 type 字段分派）
SSEEventType = Literal["start", "delta", "tag", "done", "error", "pending"]


class ConversationCreate(BaseModel):
    """POST /chat/conversations 入参。"""

    title: Optional[str] = Field(default=None, max_length=200, description="为空则由服务端取名")


class ConversationUpdate(BaseModel):
    """内部：更新标题。"""

    title: Optional[str] = Field(default=None, max_length=200)


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = Field(default=0, description="消息数，列表页展示用")


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    role: Literal["user", "assistant", "system"] | str
    content: str = Field(description="纯原话内容，不含任何幂等标记")
    client_msg_id: Optional[str] = Field(
        default=None,
        description="前端幂等 id（仅用户消息有值）：前端用它把自己的临时消息与后端落库消息对上",
    )
    created_at: datetime


class ChatRequest(BaseModel):
    """发送消息入参（``POST .../messages`` 与 ``POST .../stream`` 共用同一 schema）。

    ``client_msg_id`` 用于幂等去重（设计文档 4.3）：同一条消息重试提交时，
    后端不会产生第二条用户消息，也不会再调一次 AI。
    建议前端为每次「发送动作」生成一个 UUID，重试时复用同一个值。
    """

    content: str = Field(min_length=1, max_length=2000, description="用户消息")
    client_msg_id: Optional[str] = Field(
        default=None,
        max_length=64,
        description="客户端消息幂等 id，建议 UUID；重试时复用同一个值",
    )

    @field_validator("client_msg_id")
    @classmethod
    def _blank_client_msg_id_to_none(cls, value: Optional[str]) -> Optional[str]:
        """空串/纯空白归一成 None。

        唯一约束是 ``(conversation_id, client_msg_id)``：SQL 里多个 NULL 互不冲突，
        但多个 ``""`` 会被判成同一个 id —— 用户发第二句话就会撞唯一约束。
        前端偶尔会传空串，这里从入口堵住。
        """
        if value is None:
            return None
        value = value.strip()
        if value.startswith("sys:"):
            # 系统保留前缀（开场白用 sys:opening）：用户消息绝不能占用，
            # 否则 find_client_message 会把开场白当成"用户已发过这条消息"。
            raise ValueError("client_msg_id 不能使用系统保留前缀 sys:")
        return value or None


class ChatResponse(BaseModel):
    """非流式的完整回复（流式见 SSEEvent）。"""

    conversation_id: UUID
    user_message: MessageResponse
    assistant_message: MessageResponse
    # 7.8 画像回流：本轮抽取到的标签（已写库），前端可选展示“AI 对你的新认识”
    extracted_tags: list[Dict[str, Any]] = Field(default_factory=list)


class PendingChatResponse(BaseModel):
    """幂等命中「重复提交且上一轮尚未生成完」时的 data 结构。

    这不是错误：前端应忽略本次响应，等待上一轮的 SSE 结果（或轮询消息列表）。
    """

    conversation_id: UUID
    client_msg_id: str
    user_message_id: UUID
    pending: bool = True
    message: str = "该消息正在生成回复，已忽略本次重复提交"


class SSEEvent(BaseModel):
    """SSE 事件的 ``data`` 负载（7.2 + 设计文档 5.4）。

    线格式（每组事件以空行结尾）::

        event: delta
        data: {"code":0,"message":"success","data":{"type":"delta","content":"你","conversation_id":"..."}}

    外层恒为 10.1 的 ``{code,message,data}``；``event:`` 行与 ``data.data.type`` 一致，
    前端任选其一分派即可。
    """

    type: SSEEventType = Field(default="delta", description="start/delta/tag/done/error/pending")
    content: Optional[str] = Field(default=None, description="增量文本，仅 delta 有值")
    conversation_id: Optional[UUID] = Field(
        default=None, description="start/delta/done/pending 都会带，便于前端校验"
    )
    message_id: Optional[UUID] = Field(
        default=None, description="本轮 assistant 消息 id，仅 done 有值"
    )
    data: Optional[Dict[str, Any]] = Field(default=None, description="扩展数据，如 tag 事件的 tags")
    code: int = Field(default=0, description="error 时按 6.5 错误码表给值")
    message: str = Field(default="success")
