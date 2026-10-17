"""profiles / profile_tags：画像主表与画像标签（手册 5.3）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel

from app.models.types import json_column
from app.models.user import utcnow


class Profile(SQLModel, table=True):
    """画像主表：三个分项分数 + 加权总分 + 阶段。

    注意 ``stage`` 存的是**中文**（探索期/准备期/冲刺期，手册 5.3 原定义），
    对外接口统一转成 slug（explore/prepare/sprint），转换在 schema 层做，
    见 backend/README.md §4.11。**不要**为了改接口而动这一列的编码。
    """

    __tablename__ = "profiles"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    clarity_score: float = Field(default=0.0, description="职业目标清晰度 0-100")
    action_score: float = Field(default=0.0, description="求职行动进度 0-100")
    resume_score: float = Field(default=0.0, description="简历完整度 0-100")
    total_score: float = Field(default=0.0, description="加权总分 0-100")

    # 探索期 / 准备期 / 冲刺期（中文存储，接口层转 slug）
    stage: str = Field(default="探索期", max_length=20, index=True)

    updated_at: datetime = Field(default_factory=utcnow)

    # 9.24（2026-10）「我的画像」卡片顶部那句"你是个什么样的人"。
    # 为什么落库而不是每次现算：镜子必须**稳定**（每次刷新换一句"你是谁"，
    # 立刻变成"这 AI 在瞎猜"），而且每次打开都调模型 = 成本 + 首屏延迟。
    # ai_summary_key 是生成时所用标签集的指纹，指纹变了才重写（见 profile_service）。
    ai_summary: Optional[str] = Field(default=None, max_length=300)
    ai_summary_key: Optional[str] = Field(default=None, max_length=64)


class ProfileTag(SQLModel, table=True):
    """画像标签。

    dimension 取值见附录A：兴趣/能力/技能/痛点/焦虑/认知
    source 取值见 5.3：test/chat/resume/interview/daily/task
    """

    __tablename__ = "profile_tags"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    dimension: str = Field(max_length=50, index=True, description="兴趣/能力/技能/痛点/焦虑/认知")
    label: str = Field(max_length=100, index=True, description="标签名")
    weight: float = Field(default=0.0, description="权重 0-1")
    source: str = Field(max_length=50, index=True, description="test/chat/resume/interview/daily/task")

    extra: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=json_column(),  # PG=JSONB / SQLite=JSON(TEXT)，见 app/models/types.py
        description="扩展信息（证据原文、模型置信度等）",
    )

    updated_at: datetime = Field(default_factory=utcnow)
