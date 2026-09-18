"""Report 路由（10.2 Report：GET /report）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.report import ReportResponse
from app.services import report_service

router = APIRouter(prefix="/report", tags=["Report 成长报告"])


@router.get("", response_model=ApiResponse[ReportResponse], summary="成长报告")
async def get_report(
    refresh: bool = Query(default=False, description="true 则重新计算并生成一份新报告"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ReportResponse]:
    """11.10：画像变化 + 完成任务数聚合。"""
    return ApiResponse.ok(report_service.get_growth_report(db, current_user, refresh))
