"""Task 路由（10.2 Task：list / generate / detail / complete / abandon）。"""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.task import (
    TaskDetailResponse,
    TaskGenerateRequest,
    TaskResponse,
    TaskStepCompleteRequest,
)
from app.services import task_service

router = APIRouter(prefix="/task", tags=["Task 成长任务"])


@router.get("", response_model=ApiResponse[List[TaskResponse]], summary="任务列表")
async def list_tasks(
    status: Optional[str] = Query(default=None, description="进行中 / 已完成 / 已放弃"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[List[TaskResponse]]:
    return ApiResponse.ok(task_service.list_tasks(db, current_user, status))


@router.post("/generate", response_model=ApiResponse[TaskDetailResponse], summary="生成任务")
async def generate(
    payload: TaskGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[TaskDetailResponse]:
    """11.5：痛点诊断 -> 任务推荐 -> 步骤拆解。"""
    return ApiResponse.ok(await task_service.generate_task(db, current_user, payload))


@router.get("/{task_id}", response_model=ApiResponse[TaskDetailResponse], summary="任务详情")
async def detail(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[TaskDetailResponse]:
    return ApiResponse.ok(task_service.get_task_detail(db, current_user, task_id))


@router.post(
    "/{task_id}/steps/{step_id}/complete",
    response_model=ApiResponse[TaskDetailResponse],
    summary="打卡",
)
async def complete_step(
    task_id: UUID,
    step_id: UUID,
    payload: TaskStepCompleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[TaskDetailResponse]:
    """11.6：打卡 + 反馈 -> 更新画像标签 -> 可能触发奖章（11.12）。"""
    return ApiResponse.ok(
        await task_service.complete_step(db, current_user, task_id, step_id, payload)
    )


@router.post("/{task_id}/abandon", response_model=ApiResponse[TaskResponse], summary="放弃")
async def abandon(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[TaskResponse]:
    return ApiResponse.ok(task_service.abandon_task(db, current_user, task_id))
