"""conversations / messages：对话记录与消息（手册 5.3）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlmodel import Column, Field, SQLModel

from app.models.profile import JSONType
from app.models.user import utcnow


class Conversation(SQLModel, table=True):
    """对话。conclusion 存 11.11 的结论卡片（结构化 JSON）。"""

    __tablename__ = "conversations"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    title: str = Field(default="新的对话", max_length=200, description="对话主题")

    conclusion: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONType, nullable=True),
        description="结论卡片 JSONB",
    )

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Message(SQLModel, table=True):
    """单条消息。role: user / assistant / system（5.3）。"""

    __tablename__ = "messages"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    conversation_id: UUID = Field(foreign_key="conversations.id", index=True)

    role: str = Field(max_length=20, index=True, description="user/assistant/system")
    content: str = Field(description="消息内容 TEXT")

    created_at: datetime = Field(default_factory=utcnow)
