"""账号级长期记忆（动机地图）。

为什么单独一张表：
- ``profile_tags`` 是给推荐系统看的标签（兴趣/能力/技能/痛点…）；
- 这张表记的是"这个人想要什么样的生活、怕什么、愿意付出什么"——用他自己的原话，
  跨对话保留，不随新对话清空。

一个用户一行；内容是一个 JSON（避免为了加一个字段就迁移）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.types import json_column
from app.models.user import utcnow


class UserMemory(SQLModel, table=True):
    """账号级长期记忆。``content`` 结构见 ``memory_service.empty_content()``。"""

    __tablename__ = "user_memories"
    __table_args__ = (UniqueConstraint("user_id", name="uq_user_memories_user_id"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    content: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=json_column(),
        description="动机地图 JSON（想过的生活 / 怕什么 / 愿意付出什么 / 原话证据）",
    )
    updated_at: datetime = Field(default_factory=utcnow)
