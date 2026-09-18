"""test 相关 schema（基础测试表，11.2 / 11.3）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.utils.stage import to_stage_label, to_stage_slug


class TestOption(BaseModel):
    """单个选项。score 用于 11.3 的分项计分。"""

    key: str = Field(description="A/B/C/D")
    text: str
    score: float = Field(default=0.0, description="该选项对应分值，0-5")


class TestQuestionResponse(BaseModel):
    """一道测试题（题目来自种子数据题库，5.4）。"""

    id: str = Field(description="题目稳定标识，如 q_clarity_01")
    dimension: str = Field(description="clarity/action/resume 或 附录A 的维度名")
    content: str
    options: List[TestOption] = Field(default_factory=list)
    multiple: bool = Field(default=False, description="是否多选")


class TestSubmitRequest(BaseModel):
    """POST /test/submit 入参。"""

    answers: Dict[str, str] = Field(
        default_factory=dict,
        description="题目 id -> 选项 key，如 {'q_clarity_01': 'B'}",
    )
    free_text: Optional[str] = Field(default=None, max_length=2000, description="可选文字补充（11.2 第4步）")


class TestResultResponse(BaseModel):
    """测试结果，同时也是初始画像（11.3）。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    clarity_score: float
    action_score: float
    resume_score: float
    total_score: float
    stage: str = Field(
        default="explore",
        description=(
            "阶段 **slug**：explore / prepare / sprint（未知值兜底 explore）。"
            "数据库 test_results.stage 存的是中文，转换在 schema 层做"
        ),
    )
    stage_label: str = Field(
        default="探索期", description="阶段中文展示名，由 stage 自动派生，不用自己传"
    )
    created_at: datetime
    answers: Optional[Dict[str, Any]] = Field(default=None, description="答题明细")
    free_text: Optional[str] = None

    # --- 阶段字段统一：stage 一律 slug，另给 stage_label 中文（同 ProfileResponse）---
    @field_validator("stage", mode="before")
    @classmethod
    def _normalize_stage(cls, value: object) -> str:
        return to_stage_slug(value if isinstance(value, str) else None)

    @model_validator(mode="after")
    def _fill_stage_label(self) -> "TestResultResponse":
        self.stage_label = to_stage_label(self.stage)
        return self
