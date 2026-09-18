"""interviews / interview_questions：面试记录与题目（手册 5.2 / 5.3）。

``interview_questions`` 在 5.2 表清单里，但 5.3 没有给字段表；
本骨架按“面试题目与回答”（5.2 的描述）补齐字段，见 README「待确认」。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlmodel import Column, Field, SQLModel

from app.models.profile import JSONType
from app.models.user import utcnow


class Interview(SQLModel, table=True):
    """面试会话。

    - mode：小测试 / 全真（5.3）
    - scene：HR / 项目 / 技术（5.3）
    - status：进行中 / 已完成（5.3）
    - report：11.9 复盘报告，含评分、亮点、改进项
    """

    __tablename__ = "interviews"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    mode: str = Field(default="小测试", max_length=50)
    scene: str = Field(default="HR", max_length=50)
    status: str = Field(default="进行中", max_length=20, index=True)

    report: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONType, nullable=True),
        description="复盘报告 JSONB",
    )

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class InterviewQuestion(SQLModel, table=True):
    """面试题目与回答（11.9：每题后 1-2 轮追问）。"""

    __tablename__ = "interview_questions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    interview_id: UUID = Field(foreign_key="interviews.id", index=True)

    question_order: int = Field(default=1, description="题目序号，从 1 开始")
    content: str = Field(description="题目文本")
    answer: Optional[str] = Field(default=None, description="用户回答")

    followups: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONType, nullable=True),
        description="追问与追问回答 JSONB，形如 [{q, a}]",
    )

    score: Optional[float] = Field(default=None, description="该题得分 0-100")
    extra: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONType, nullable=True),
        description="扩展信息 JSONB",
    )

    created_at: datetime = Field(default_factory=utcnow)
    answered_at: Optional[datetime] = Field(default=None)
