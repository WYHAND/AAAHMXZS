"""Badge 路由（10.2 Badge：GET /badge）。"""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.badge import UserBadgeResponse
from app.services import badge_service

router = APIRouter(prefix="/badge", tags=["Badge 奖章"])


@router.get("", response_model=ApiResponse[List[UserBadgeResponse]], summary="我的奖章")
async def list_badges(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[List[UserBadgeResponse]]:
    """11.12：MVP 只有「起步行动家」一枚。"""
    return ApiResponse.ok(badge_service.list_user_badges(db, current_user))
