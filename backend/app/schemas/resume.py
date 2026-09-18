"""resume 相关 schema（11.8 简历生成/优化）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ResumeCreate(BaseModel):
    """新建简历（引导式生成的五步表单结果，11.8）。"""

    title: str = Field(default="我的简历", max_length=200)
    target_job: Optional[str] = Field(default=None, max_length=100, description="目标岗位")
    parsed_data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="结构化简历内容：basics/education/experience/projects/skills",
    )


class ResumeUpdate(BaseModel):
    """更新简历（全部可选，支持部分更新）。"""

    title: Optional[str] = Field(default=None, max_length=200)
    target_job: Optional[str] = Field(default=None, max_length=100)
    parsed_data: Optional[Dict[str, Any]] = None


class ResumeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    file_path: Optional[str] = Field(default=None, description="本地磁盘相对路径（13.1）")
    parsed_data: Optional[Dict[str, Any]] = None
    ats_score: Optional[float] = None
    completeness: Optional[float] = None
    target_job: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ResumeParseRequest(BaseModel):
    """上传解析的元信息（文件本身走 multipart，见 /resume/upload）。"""

    title: Optional[str] = Field(default=None, max_length=200)
    target_job: Optional[str] = Field(default=None, max_length=100)


class ResumeOptimizeRequest(BaseModel):
    """POST /resume/{id}/optimize 入参。"""

    target_job: Optional[str] = Field(default=None, max_length=100, description="为空则用简历自身的 target_job")
    focus: Optional[str] = Field(default=None, max_length=200, description="希望重点优化的方向")


class ResumeOptimizeResponse(BaseModel):
    """优化报告（GET /resume/{id}/report 与 POST optimize 共用结构）。"""

    resume_id: UUID
    ats_score: float = Field(default=0.0, description="ATS 评分 0-100")
    completeness: float = Field(default=0.0, description="完整度 0-100")
    matched_keywords: List[str] = Field(default_factory=list, description="命中的岗位关键词")
    missing_keywords: List[str] = Field(default_factory=list, description="缺失的岗位关键词")
    suggestions: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="逐条建议：[{section, problem, suggestion, example}]",
    )
    summary: str = Field(default="", description="整体点评")
    generated_at: Optional[datetime] = None
