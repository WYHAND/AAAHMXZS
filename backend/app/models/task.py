"""tasks / task_steps：成长任务与步骤（手册 5.3）。"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel

from app.models.user import utcnow


class Task(SQLModel, table=True):
    """成长任务。

    - pain_point：关联痛点标签（附录A 痛点维度）
    - status：进行中 / 已完成 / 已放弃（5.3）
    - value_note：价值说明（11.5 让用户明白“为什么要做”）
    """

    __tablename__ = "tasks"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    title: str = Field(max_length=200)
    description: Optional[str] = Field(default=None, description="任务描述 TEXT")
    pain_point: Optional[str] = Field(default=None, max_length=100, index=True)

    status: str = Field(default="进行中", max_length=20, index=True)
    value_note: Optional[str] = Field(default=None, description="价值说明 TEXT")
    difficulty: Optional[str] = Field(default=None, max_length=20, description="简单/中等/困难")
    estimated_days: Optional[int] = Field(default=None, description="预计天数")

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class TaskStep(SQLModel, table=True):
    """任务步骤；打卡即把 completed 置 True 并写 feedback（11.6）。"""

    __tablename__ = "task_steps"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    task_id: UUID = Field(foreign_key="tasks.id", index=True)

    step_order: int = Field(default=1, description="步骤序号，从 1 开始")
    title: str = Field(max_length=200)
    action: Optional[str] = Field(default=None, description="行动指引 TEXT")
    resource: Optional[str] = Field(default=None, max_length=500, description="资源链接")

    completed: bool = Field(default=False, index=True)
    feedback: Optional[str] = Field(default=None, description="打卡反馈 TEXT")
    completed_at: Optional[datetime] = Field(default=None)
