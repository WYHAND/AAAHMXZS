"""chat 相关 schema（AI 职业指导对话，11.4）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ConversationCreate(BaseModel):
    """POST /chat/conversations 入参。"""

    title: Optional[str] = Field(default=None, max_length=200, description="为空则由服务端取名")


class ConversationUpdate(BaseModel):
    """内部：更新标题/结论卡片。"""

    title: Optional[str] = Field(default=None, max_length=200)
    conclusion: Optional[Dict[str, Any]] = None


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = Field(default=0, description="消息数，列表页展示用")
    conclusion: Optional[Dict[str, Any]] = Field(default=None, description="结论卡片（11.11）")


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    conversation_id: UUID
    role: Literal["user", "assistant", "system"] | str
    content: str
    created_at: datetime


class ChatRequest(BaseModel):
    """POST /chat/conversations/{id}/messages 入参。"""

    content: str = Field(min_length=1, max_length=2000, description="用户消息")


class ChatResponse(BaseModel):
    """非流式的完整回复（流式见 SSEEvent）。"""

    conversation_id: UUID
    user_message: MessageResponse
    assistant_message: MessageResponse
    # 7.8 画像回流：本轮抽取到的标签（已写库），前端可选展示“AI 对你的新认识”
    extracted_tags: list[Dict[str, Any]] = Field(default_factory=list)


class ChatConclusionCard(BaseModel):
    """11.11 结论卡片（结构化诊断卡）。"""

    conversation_id: UUID
    summary: str = Field(default="", description="一句话总结")
    pain_points: list[str] = Field(default_factory=list, description="识别出的痛点")
    suggestions: list[str] = Field(default_factory=list, description="建议动作")
    next_actions: list[str] = Field(default_factory=list, description="下一步可直接做的事")
    generated_at: Optional[datetime] = None


class SSEEvent(BaseModel):
    """SSE 事件负载（7.2）。

    线格式（每行一个事件，双换行结尾）::

        event: message
        data: {"type": "delta", "content": "你"}

        event: done
        data: {"type": "done", "message_id": "..."}

    即 data 是 SSEEvent 的 JSON。这样既满足 7.2 的 SSE 流式，
    又保持 10.1 的 ``{code,message,data}`` 语义（见 README「待确认」）。
    """

    type: Literal["start", "delta", "tag", "done", "error"] = "delta"
    content: Optional[str] = Field(default=None, description="增量文本（delta）")
    message_id: Optional[UUID] = Field(default=None, description="流结束时返回，便于前端对齐消息 id")
    conversation_id: Optional[UUID] = None
    code: int = Field(default=0, description="error 时按 6.5 错误码表给值")
    message: str = Field(default="success")
    data: Optional[Dict[str, Any]] = Field(default=None, description="扩展数据")
