"""Badge 路由（10.2 Badge：GET /badge）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.badge import BadgeOverviewResponse
from app.services import badge_service

router = APIRouter(prefix="/badge", tags=["Badge 奖章"])


@router.get("", response_model=ApiResponse[BadgeOverviewResponse], summary="我的奖章总览")
async def list_badges(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[BadgeOverviewResponse]:
    """11.12：全部奖章（固定顺序）+ 是否获得 + 进度；不写库。"""
    return ApiResponse.ok(badge_service.get_badge_overview(db, current_user))
