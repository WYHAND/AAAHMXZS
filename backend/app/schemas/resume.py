"""resume 相关 schema（11.8 简历生成/优化）。

老 ATS 链路（上传解析 / 五步表单创建 / 优化报告）的 schema —— ``ResumeCreate`` /
``ResumeUpdate`` / ``ResumeParseRequest`` / ``ResumeOptimizeRequest`` /
``ResumeOptimizeResponse`` —— 已随该链路整体移除（2026-11，见 README §4.10）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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


# ---------------------------------------------------------------------------
# 模板 -> 用户填 -> AI 只润色（GET /resume/template、POST /resume/polish、
# GET|PUT /resume/mine）
# ---------------------------------------------------------------------------

class ResumeTemplateField(BaseModel):
    """模板里的一个字段（前端照它渲染一个输入项）。"""

    key: str = Field(description="字段名；``star.*`` 表示经历内部的 STAR 子字段")
    label: str = Field(description="中文标签")
    question: str = Field(description="要问用户的那一句话（前端直接拿来当问题）")
    example: str = Field(default="", description="示例答案")
    required: bool = Field(default=False, description="是否必填")
    multiple: bool = Field(default=False, description="是否可多值（前端渲染成一组输入）")
    lines: bool = Field(
        default=False,
        description="可多值且**一项一行**地编辑（技能用：展开后的表述自带顿号逗号，"
        "用顿号分隔的单行输入框会把一句话切成好几项）",
    )


class ResumeTemplateSection(BaseModel):
    """模板里的一个分组。

    ``repeatable=True`` 时 ``fields[].key`` 相对**单条经历**（整个 section 是数组）；
    ``repeatable=False`` 时相对 **section 本身**。
    """

    key: str
    label: str
    repeatable: bool = False
    fields: List[ResumeTemplateField] = Field(default_factory=list)


class ResumeTemplateResponse(BaseModel):
    """``GET /api/v1/resume/template`` 的 data（纯静态配置）。"""

    sections: List[ResumeTemplateSection] = Field(default_factory=list)


class ResumePolishRequest(BaseModel):
    """``POST /api/v1/resume/polish`` 入参：用户当前填的表单内容。"""

    parsed_data: Dict[str, Any] = Field(
        description=(
            "与模板同结构的表单内容（basic/target/education/skills/projects/campus/"
            "self_evaluation）。**AI 只会改写这里面已有的内容**，没填的字段保持空。"
        )
    )
    target_job: Optional[str] = Field(default=None, max_length=100, description="目标岗位（选填）")


class ResumeMineUpdate(BaseModel):
    """``PUT /api/v1/resume/mine`` 入参（用户手动编辑后保存，不调 AI）。"""

    title: Optional[str] = Field(default=None, max_length=200)
    target_job: Optional[str] = Field(default=None, max_length=100)
    parsed_data: Dict[str, Any] = Field(description="与模板同结构的表单内容（全量覆盖）")
