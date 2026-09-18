"""profile 相关 schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserResponse

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
    stage: str = "探索期"
    updated_at: datetime
    tags: list[ProfileTagResponse] = Field(default_factory=list, description="画像标签，按维度聚合由前端处理")
    user: Optional[UserResponse] = Field(default=None, description="基础资料，便于前端一次渲染")


class ProfileFeedbackRequest(BaseModel):
    """POST /profile/feedback：用户说“这条标签不对”。"""

    tag_id: Optional[UUID] = Field(default=None, description="要反馈的标签；为空表示对整体画像反馈")
    approved: bool = Field(default=True, description="True 认可 / False 不认可")
    comment: Optional[str] = Field(default=None, max_length=500, description="补充说明")
