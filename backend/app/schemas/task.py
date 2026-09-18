"""task 相关 schema（11.5 / 11.6 成长任务）。"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TaskGenerateRequest(BaseModel):
    """POST /task/generate 入参。"""

    pain_point: Optional[str] = Field(
        default=None,
        max_length=100,
        description="指定痛点；为空则由服务端从画像标签里挑（11.5）",
    )


class TaskStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    task_id: UUID
    step_order: int
    title: str
    action: Optional[str] = None
    resource: Optional[str] = None
    completed: bool = False
    feedback: Optional[str] = None
    completed_at: Optional[datetime] = None


class TaskStepCompleteRequest(BaseModel):
    """POST /task/{id}/steps/{step_id}/complete 入参（打卡，11.6）。"""

    feedback: Optional[str] = Field(default=None, max_length=1000, description="打卡反馈")


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    description: Optional[str] = None
    pain_point: Optional[str] = None
    status: str = "进行中"
    value_note: Optional[str] = None
    difficulty: Optional[str] = None
    estimated_days: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    progress: float = Field(default=0.0, description="完成进度 0-1，列表页展示用")


class TaskDetailResponse(TaskResponse):
    """任务详情：含步骤列表。"""

    steps: List[TaskStepResponse] = Field(default_factory=list)
