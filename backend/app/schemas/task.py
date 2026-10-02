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


class TaskDeleteResponse(BaseModel):
    """DELETE /task/{id} 的响应（硬删除任务 + 它的全部步骤）。

    ``completed_steps`` 是**这次真的被删掉的已打卡步骤数**，前端拿它把后果说清楚：
    ``action_score``（行动力）是"数已完成打卡的步骤"算出来的（见
    ``profile_service.recompute_stage``），所以删掉带打卡的任务，分数会真的下降 ——
    删除前必须先告诉用户"有多少步会被一起删掉"，不能静默删。
    """

    id: UUID
    title: str
    deleted_steps: int = Field(default=0, description="被删掉的步骤总数（含未打卡的）")
    completed_steps: int = Field(default=0, description="其中已打卡的步骤数（行动力分数就是按它累积的）")


class TaskGenerateResponse(TaskDetailResponse):
    """生成任务的响应：在任务详情之上多一个"是否复用了已有任务"的标记。

    前端靠这个布尔值决定提示语（"已经有一个类似的任务了"），而不是去匹配
    message 里的中文 —— 文案会改，字段不会。
    """

    reused: bool = Field(default=False, description="True=命中了已有同题任务，本次没有新建")
