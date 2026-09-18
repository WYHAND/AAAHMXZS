"""daily_question 相关 schema（11.7 每日一问）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DailyQuestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    dimension: str
    content: str
    options: Optional[Dict[str, Any]] = Field(default=None, description="选项 JSONB")
    created_at: datetime


class TodayQuestionResponse(BaseModel):
    """GET /daily/today 出参：题目 + 今天是否已答。"""

    question: DailyQuestionResponse
    answered: bool = False
    answer: Optional[str] = Field(default=None, description="今日已答的答案")
    streak: int = Field(default=0, description="连续打卡天数（11.7 累计7题触发画像微调）")


class DailyAnswerRequest(BaseModel):
    """POST /daily/answer 入参。answer 对应 daily_answers.answer VARCHAR(200)。"""

    question_id: UUID
    answer: str = Field(min_length=1, max_length=200)


class DailyAnswerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    question_id: UUID
    answer: str
    answered_at: datetime
    # 11.7：累计 7 题触发画像微调，这里回传是否已触发
    profile_refreshed: bool = Field(default=False, description="是否已触发画像微调")
    extracted_tags: List[Dict[str, Any]] = Field(default_factory=list, description="7.8 回流标签")
