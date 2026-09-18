"""interview 相关 schema（11.9 模拟面试）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class InterviewStartRequest(BaseModel):
    """POST /interview/start 入参。"""

    mode: str = Field(default="小测试", description="小测试 / 全真（5.3）")
    scene: str = Field(default="HR", description="HR / 项目 / 技术（5.3）")
    resume_id: Optional[UUID] = Field(default=None, description="基于哪份简历出题；为空则用最新简历")
    target_job: Optional[str] = Field(default=None, max_length=100)


class InterviewAnswerRequest(BaseModel):
    """POST /interview/{id}/answer 入参。"""

    question_id: UUID
    answer: str = Field(min_length=1, max_length=5000, description="用户回答文本")


class InterviewSubmitRequest(BaseModel):
    """内部：写入单题（出题时用）。"""

    content: str
    question_order: int = 1
    score: Optional[float] = None
    extra: Optional[Dict[str, Any]] = None


class InterviewQuestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    interview_id: UUID
    question_order: int
    content: str
    answer: Optional[str] = None
    followups: Optional[Dict[str, Any]] = Field(default=None, description="追问记录")
    score: Optional[float] = None
    created_at: datetime
    answered_at: Optional[datetime] = None


class InterviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    mode: str
    scene: str
    status: str
    created_at: datetime
    updated_at: datetime
    report: Optional[Dict[str, Any]] = None


class InterviewFinishResponse(BaseModel):
    """结束面试的返回。"""

    interview_id: UUID
    status: str = "已完成"
    report: Optional[Dict[str, Any]] = Field(default=None, description="复盘报告（11.9）")


class InterviewReviewResponse(BaseModel):
    """GET /interview/{id}/review 出参。"""

    interview_id: UUID
    status: str
    overall_score: float = Field(default=0.0, description="综合得分 0-100")
    dimension_scores: Dict[str, float] = Field(default_factory=dict, description="分维度得分")
    strengths: List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)
    question_reviews: List[Dict[str, Any]] = Field(default_factory=list, description="逐题点评")
    summary: str = ""
    generated_at: Optional[datetime] = None
