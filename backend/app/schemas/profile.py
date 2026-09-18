"""profile 相关 schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.user import UserResponse
from app.utils.stage import to_stage_label, to_stage_slug

DimensionType = Literal["兴趣", "能力", "技能", "痛点", "焦虑", "认知"]
SourceType = Literal["test", "chat", "resume", "interview", "daily", "task"]


class ProfileTagBase(BaseModel):
    dimension: str = Field(description="兴趣/能力/技能/痛点/焦虑/认知")
    label: str = Field(max_length=100)
    weight: float = Field(default=0.0, ge=0.0, le=1.0)
    source: str = Field(default="test", description="test/chat/resume/interview/daily/task")
    extra: Optional[Dict[str, Any]] = None


class ProfileTagCreate(ProfileTagBase):
    """内部：AI/测试写标签时使用（7.8 画像回流）。"""

    user_id: UUID


class ProfileTagResponse(ProfileTagBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    updated_at: datetime


class ProfileUpdate(BaseModel):
    """内部：画像分数/阶段更新。"""

    clarity_score: Optional[float] = Field(default=None, ge=0, le=100)
    action_score: Optional[float] = Field(default=None, ge=0, le=100)
    resume_score: Optional[float] = Field(default=None, ge=0, le=100)
    total_score: Optional[float] = Field(default=None, ge=0, le=100)
    stage: Optional[str] = None


class ProfileResponse(BaseModel):
    """GET /profile 出参。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    clarity_score: float = 0.0
    action_score: float = 0.0
    resume_score: float = 0.0
    total_score: float = 0.0
    stage: str = Field(
        default="explore",
        description=(
            "阶段 **slug**：explore / prepare / sprint（未知值兜底 explore）。"
            "数据库 profiles.stage 存的是中文，转换在 schema 层做（见 _normalize_stage）"
        ),
    )
    stage_label: str = Field(
        default="探索期",
        description="阶段中文展示名（探索期/准备期/冲刺期），由 stage 自动派生，不用自己传",
    )
    updated_at: datetime
    tested: bool = Field(
        default=False,
        description=(
            "是否已完成基础测试表（依据该用户有没有 test_results 记录）。"
            "⚠️ 前端判断「用户做没做过测评」必须看这个字段，"
            "不要看画像对象是否存在 —— 画像走 get_or_create，存在不代表做过测评"
        ),
    )
    tags: list[ProfileTagResponse] = Field(default_factory=list, description="画像标签，按维度聚合由前端处理")
    user: Optional[UserResponse] = Field(default=None, description="基础资料，便于前端一次渲染")

    # --- 阶段字段统一：stage 一律 slug，另给 stage_label 中文 ---
    # 数据库 profiles.stage 存的是**中文**（手册 5.3：探索期/准备期/冲刺期），
    # 不为改接口而动存量数据编码，所以在 schema 层做转换。
    # 规则见 README §4.11「stage 字段全接口统一」。
    @field_validator("stage", mode="before")
    @classmethod
    def _normalize_stage(cls, value: object) -> str:
        """把中文阶段名 / 已经是 slug 的值，统一成 slug；未知值兜底 explore。"""
        return to_stage_slug(value if isinstance(value, str) else None)

    @model_validator(mode="after")
    def _fill_stage_label(self) -> "ProfileResponse":
        """stage_label 由 stage 派生，避免两处各写一遍导致分叉。"""
        self.stage_label = to_stage_label(self.stage)
        return self


class ProfileFeedbackRequest(BaseModel):
    """POST /profile/feedback：用户说“这条标签不对”。"""

    tag_id: Optional[UUID] = Field(default=None, description="要反馈的标签；为空表示对整体画像反馈")
    approved: bool = Field(default=True, description="True 认可 / False 不认可")
    comment: Optional[str] = Field(default=None, max_length=500, description="补充说明")
