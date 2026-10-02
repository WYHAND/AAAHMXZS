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
    """GET /daily/today 出参：题目 + 今天是否已答。

    ``question`` 可以为 ``null``：题库未初始化、或该用户已答完全部题目时。
    前端应展示空态（提示先运行 ``python -m app.db.init_db`` 或"题库答完啦"），
    **不要**再拿一个假 UUID 去调 ``POST /daily/answer``（会被 2001 拒绝）。
    """

    question: Optional[DailyQuestionResponse] = Field(
        default=None, description="今日题目；题库为空/已答完时为 null"
    )
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


# ---------------------------------------------------------------------------
# GET /daily/history 出参（每日一问历史）
# ---------------------------------------------------------------------------

class DailyHistoryItem(BaseModel):
    """历史里的一条答题记录（题干/维度从题库 join 出来，容错见 service）。

    ``content`` 为空字符串 / ``dimension`` 为 ``null`` 表示**这条回答指向的题目
    已经不在 ``daily_questions`` 里**（题库被重建/删除等脏数据）。这是**明确的
    占位**，不是"这条记录不存在"—— 条目本身照常返回，前端可显示"题目已不可用"，
    绝不静默丢条目（丢了用户会以为自己的打卡消失了）。
    """

    id: UUID = Field(description="daily_answers.id")
    question_id: UUID = Field(description="daily_questions.id")
    content: str = Field(description="题干原文；题目已不可用时为 \"\"")
    dimension: Optional[str] = Field(default=None, description="维度（兴趣/能力/…）；题目已不可用时为 null")
    answer: str = Field(description="用户答案")
    answered_at: datetime = Field(description="回答时间（UTC，ISO 格式）")


class DailyHistoryResponse(BaseModel):
    """GET /daily/history 出参：按 ``answered_at`` **倒序**（最新在前）。

    ``total`` 是该用户答过的**真实总条数**；``items`` 最多 ``HISTORY_MAX_ITEMS``
    （服务端硬上限 100，见 ``daily_question_service.get_history`` 的说明）。
    """

    total: int = Field(default=0, description="该用户答过的总条数（真实总数，不受 items 上限影响）")
    items: List[DailyHistoryItem] = Field(default_factory=list, description="倒序的历史记录，最多 100 条")
