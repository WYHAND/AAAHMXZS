"""daily_questions / daily_answers：每日一问题库与回答（手册 5.3）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlmodel import Column, Field, SQLModel

from app.models.profile import JSONType
from app.models.user import utcnow


class DailyQuestion(SQLModel, table=True):
    """每日一问题库（11.7：每天 1 题，累计 7 题触发画像微调）。"""

    __tablename__ = "daily_questions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    dimension: str = Field(max_length=50, index=True, description="维度：兴趣/能力/技能/痛点/焦虑/认知")
    content: str = Field(description="题目 TEXT")

    options: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONType, nullable=True),
        description="选项 JSONB，形如 [{key,text,weight}]",
    )

    created_at: datetime = Field(default_factory=utcnow)


class DailyAnswer(SQLModel, table=True):
    """用户对每日一问的回答（answer 为 VARCHAR(200)，5.3）。"""

    __tablename__ = "daily_answers"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)
    question_id: UUID = Field(foreign_key="daily_questions.id", index=True)

    answer: str = Field(max_length=200)
    answered_at: datetime = Field(default_factory=utcnow)
