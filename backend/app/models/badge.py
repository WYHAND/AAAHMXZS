"""badges / user_badges：奖章与用户奖章（手册 5.3、11.12）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from app.models.types import json_column
from app.models.user import utcnow


class Badge(SQLModel, table=True):
    """奖章。condition 存触发条件 JSONB。

    例：``{"event": "task_first_completed", "threshold": 1}``
    """

    __tablename__ = "badges"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(max_length=100, unique=True, description="奖章名，如“起步行动家”")

    condition: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=json_column(),
        description="触发条件 JSONB",
    )

    created_at: datetime = Field(default_factory=utcnow)


class UserBadge(SQLModel, table=True):
    """用户获得的奖章。"""

    __tablename__ = "user_badges"
    # 同一用户同一枚奖章只能有一条发放记录（award_badge 声称幂等，但查-插不是原子的）。
    __table_args__ = (
        UniqueConstraint("user_id", "badge_id", name="uq_user_badges_user_badge"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    badge_id: UUID = Field(foreign_key="badges.id", index=True)

    obtained_at: datetime = Field(default_factory=utcnow)
