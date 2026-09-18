"""report 相关 schema（11.10 成长报告 / 11.11 结论卡片）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    type: str = Field(description="growth / conclusion / resume")
    content: Optional[Dict[str, Any]] = None
    created_at: datetime


class GrowthReportContent(BaseModel):
    """growth 报告的 content 约定结构（11.10：画像变化 + 完成任务数）。"""

    stage: str = Field(default="explore", description="阶段 slug：explore / prepare / sprint")
    stage_label: str = Field(default="探索期", description="阶段中文展示名")
    stage_changed: bool = False
    clarity_score: float = 0.0
    action_score: float = 0.0
    resume_score: float = 0.0
    total_score: float = 0.0
    score_delta: Dict[str, float] = Field(default_factory=dict, description="与上一份报告相比的变化")
    completed_tasks: int = 0
    completed_steps: int = 0
    active_days: int = 0
    highlights: List[str] = Field(default_factory=list, description="本周期亮点")
    suggestions: List[str] = Field(default_factory=list, description="下一周期建议")
