"""resumes：简历（手册 5.3）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel

from app.models.types import json_column
from app.models.user import utcnow


class Resume(SQLModel, table=True):
    """简历。

    - file_path：本地磁盘相对路径，形如 ``uploads/resumes/{user_id}/{uuid}.pdf``（13.1）
    - parsed_data：13.3 解析出的结构化数据
    - ats_score / completeness：11.8 的 ATS 评分与完整度，同时作为画像 resume_score 的来源
    """

    __tablename__ = "resumes"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    title: str = Field(default="我的简历", max_length=200)
    file_path: Optional[str] = Field(default=None, max_length=500)

    parsed_data: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=json_column(),
        description="解析后结构化数据 JSONB",
    )

    ats_score: Optional[float] = Field(default=None, description="ATS 评分 0-100")
    completeness: Optional[float] = Field(default=None, description="完整度 0-100")
    target_job: Optional[str] = Field(default=None, max_length=100, description="目标岗位")

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
