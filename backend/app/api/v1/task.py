"""Task 路由（10.2 Task：list / generate / detail / complete / abandon / delete）。"""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.task import (
    TaskDeleteResponse,
    TaskDetailResponse,
    TaskGenerateRequest,
    TaskGenerateResponse,
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


@router.post("/generate", response_model=ApiResponse[TaskGenerateResponse], summary="生成任务")
async def generate(
    payload: TaskGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[TaskGenerateResponse]:
    """11.5：痛点诊断 -> 任务推荐 -> 步骤拆解。

    命中同题「进行中」任务时不新建，直接返回那条已有任务（``data.reused=true``），
    并把 message 换成给用户看的提示语 —— 前端应该判断 ``reused`` 而不是比 message 文案。
    出错路径与 HTTP 状态码规则不变（见 ``app.core.errors.CODE_TO_HTTP_STATUS``）。
    """
    data = await task_service.generate_task(db, current_user, payload)
    message = task_service.REUSED_TASK_MESSAGE if data.reused else "success"
    return ApiResponse.ok(data, message=message)


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


@router.delete(
    "/{task_id}",
    response_model=ApiResponse[TaskDeleteResponse],
    summary="删除任务（连同全部步骤）",
)
async def delete_task(
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[TaskDeleteResponse]:
    """硬删除一个任务及其全部步骤。

    - 不存在**或不属于当前用户** -> 404 + ``code 2001``（不区分，避免枚举 oracle，见 README §8.1）；
    - **不可恢复**：``tasks`` 与 ``task_steps`` 都是真删，不是改状态（"放弃"才是改状态）；
    - 删完立刻重算画像（``action_score`` / ``total_score`` / ``stage``）——
      行动力分数按"已打卡的步骤"累积，所以删掉带打卡的任务分数**会真的下降**；
      返回值里的 ``completed_steps`` 就是被删掉的打卡步骤数，前端据此在删除前说清后果。
    - 重复删除同一个 id 第二次返回 2001（已不存在），符合预期。
    """
    return ApiResponse.ok(task_service.delete_task(db, current_user, task_id))
