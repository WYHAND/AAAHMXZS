"""reports：成长报告（手册 5.3）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel

from app.models.types import json_column
from app.models.user import utcnow


class Report(SQLModel, table=True):
    """成长报告（11.10：聚合画像变化、完成任务数）。

    type 约定：``growth``（成长报告）/ ``resume``（简历报告）
    """

    __tablename__ = "reports"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    type: str = Field(default="growth", max_length=50, index=True, description="报告类型")
    content: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=json_column(),
        description="报告内容 JSONB",
    )

    created_at: datetime = Field(default_factory=utcnow)
