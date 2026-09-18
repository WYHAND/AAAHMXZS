"""badge 相关 schema（11.12 奖章）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class BadgeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    condition: Optional[Dict[str, Any]] = None
    created_at: datetime


class UserBadgeResponse(BaseModel):
    """GET /badge 出参：用户已获得的奖章。"""

    id: UUID = Field(description="user_badges.id")
    badge_id: UUID
    name: str
    condition: Optional[Dict[str, Any]] = None
    obtained_at: datetime
