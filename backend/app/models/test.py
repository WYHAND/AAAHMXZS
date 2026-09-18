"""test_results：基础测试表结果（手册 5.2 表清单，5.3 未给字段表）。

字段按 11.2 基础测试表流程 + 11.3 初始画像生成补齐，
见 backend/README.md「待确认」。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlmodel import Column, Field, SQLModel

from app.models.profile import JSONType
from app.models.user import utcnow


class TestResult(SQLModel, table=True):
    """一次测试提交。

    - answers：逐题作答明细 ``[{"question_id": "...", "option": "B", "score": 3}]``
    - free_text：可选文字补充（11.2 第 4 步交给 DeepSeek 抽标签）
    - 三个分项分数：提交时算出的初始画像分（11.3）
    """

    __tablename__ = "test_results"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    answers: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSONType, nullable=True),
        description="答题明细 JSONB",
    )
    free_text: Optional[str] = Field(default=None, description="可选文字补充")

    clarity_score: float = Field(default=0.0)
    action_score: float = Field(default=0.0)
    resume_score: float = Field(default=0.0)
    total_score: float = Field(default=0.0)
    stage: str = Field(default="探索期", max_length=20)

    created_at: datetime = Field(default_factory=utcnow)
