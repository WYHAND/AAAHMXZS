"""conversations / messages：对话记录与消息（手册 5.3 + 2 处补列）。

⚠️ 对手册 5.3 的偏离（已获明确授权，见 backend/README.md 第 6 节的 [已决策] 条目）：

1. ``Message.client_msg_id``
   5.3 的 ``messages`` 表没有这个字段，但前端乐观更新与「重试不重复落库」都需要它。
   补列 + ``(conversation_id, client_msg_id)`` 唯一索引，比把幂等标记内联进
   ``content`` 干净得多（内联会污染 ``MessageResponse.content``、历史消息、搜索与长度统计）。

2. ``Conversation.followup_direction`` / ``Conversation.followup_round``
   追问计数本质是**会话级状态**，不属于单条消息（5.3 的 ``messages`` 只有
   ``role/content/created_at``），所以放在 ``conversations`` 上实现 7.7 的「同方向追问 ≤3 轮」。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.types import json_column
from app.models.user import utcnow


class Conversation(SQLModel, table=True):
    """对话。``conclusion`` 存 11.11 的结论卡片（结构化 JSON）。

    ``followup_direction`` / ``followup_round`` 是 7.7 的追问计数器状态：
    - ``followup_direction``：当前正在挖掘的维度（附录A：兴趣/能力/技能/痛点/焦虑/认知）
    - ``followup_round``：该方向已经被追问的轮数（1 起；0 表示还没开始计数）
    """

    __tablename__ = "conversations"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    title: str = Field(default="新的对话", max_length=200, description="对话主题")

    conclusion: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=json_column(),
        description="结论卡片 JSONB",
    )

    # --- 7.7 追问计数器（手册 5.3 缺，本次授权补列）---
    followup_direction: Optional[str] = Field(
        default=None,
        max_length=50,
        description="当前挖掘维度（兴趣/能力/技能/痛点/焦虑/认知），空表示尚未开始计数",
    )
    followup_round: int = Field(
        default=0,
        description="同方向已追问轮数，1 起；达到 3 后下一轮 Prompt 会要求换维度",
    )

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Message(SQLModel, table=True):
    """单条消息。role: user / assistant / system（5.3）。

    ``client_msg_id`` 是前端传的幂等 id（设计文档 4.3）：
    - 只对用户消息有值，assistant/system 消息为 NULL；
    - 与 ``conversation_id`` 组成唯一约束，重复提交在数据库层面就插不进重复行；
    - **不内联进 content**，``content`` 永远是纯原话。
    """

    __tablename__ = "messages"
    __table_args__ = (
        # 同一会话内 client_msg_id 唯一。PostgreSQL 里 NULL 不参与唯一性判断，
        # 所以 assistant 消息（client_msg_id 为 NULL）不会互相冲突。
        UniqueConstraint(
            "conversation_id", "client_msg_id", name="uq_messages_conversation_client_msg"
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    conversation_id: UUID = Field(foreign_key="conversations.id", index=True)

    role: str = Field(max_length=20, index=True, description="user/assistant/system")
    content: str = Field(description="消息内容 TEXT（用户消息存纯原话，不含任何标记）")

    client_msg_id: Optional[str] = Field(
        default=None,
        max_length=64,
        index=True,
        description="前端幂等 id（设计文档 4.3），仅用户消息有值",
    )

    created_at: datetime = Field(default_factory=utcnow)
