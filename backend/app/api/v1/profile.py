"""Profile 路由（10.2 Profile：profile / tags / feedback）。"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.profile import ProfileFeedbackRequest, ProfileResponse, ProfileTagResponse
from app.services import profile_service

router = APIRouter(prefix="/profile", tags=["Profile 画像"])


@router.get("", response_model=ApiResponse[ProfileResponse], summary="获取画像")
async def get_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ProfileResponse]:
    """画像主表 + 标签 + 基础资料（11.3 / 7.8）。"""
    return ApiResponse.ok(profile_service.get_profile(db, current_user))


@router.get("/tags", response_model=ApiResponse[List[ProfileTagResponse]], summary="获取标签")
async def get_tags(
    dimension: Optional[str] = Query(default=None, description="可选：兴趣/能力/技能/痛点/焦虑/认知"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[List[ProfileTagResponse]]:
    """画像标签，按权重降序。"""
    return ApiResponse.ok(profile_service.list_tags_response(db, current_user.id, dimension))


@router.post("/feedback", response_model=ApiResponse[ProfileResponse], summary="标签反馈")
async def feedback(
    payload: ProfileFeedbackRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ProfileResponse]:
    """用户对标签的认可/否定，会调整权重并重算阶段。"""
    return ApiResponse.ok(profile_service.feedback(db, current_user, payload))
