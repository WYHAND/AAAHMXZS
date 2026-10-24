"""report 相关 schema（11.10 成长报告 / 11.11 结论卡片）。

**报告语义（本轮改动，见 README §4.15）**：

- ``GET /report`` —— **每次实时计算，从不落库**，返回 :class:`GrowthReportResponse`；
- ``POST /report/save`` —— 把当前实时数据 + 用户补充说明存成**一份里程碑快照**，
  并成为下一次 ``score_delta`` 的基线；
- 用户只能编辑 ``user_note``（自己的补充说明），**不能改分数** —— 分数由行为算出。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.utils.stage import to_stage_label, to_stage_slug

# 用户补充说明的字数上限（超过 -> 1001 参数错误）
USER_NOTE_MAX_LENGTH = 500


class ReportResponse(BaseModel):
    """**数据库行**的原始视图（``reports`` 表一行）。

    注意：``GET /report`` 现在返回的是实时计算的 :class:`GrowthReportResponse`，
    不再是这个「行视图」。本模型保留给需要看原始快照的场景（如以后的历史列表）。
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    type: str = Field(description="growth / resume")
    content: Optional[Dict[str, Any]] = None
    created_at: datetime


class GrowthSuggestion(BaseModel):
    """一条建议 + **可直接喂给 ``POST /task/generate`` 的痛点词**。

    ``pain_point`` 是给"一键去做任务"用的：前端点这条建议时，
    把 ``pain_point`` 原样作为 ``{"pain_point": ...}`` 传给任务生成接口，
    让 AI 针对这个痛点拆任务 —— 这样"报告 → 行动"的闭环才闭合。
    """

    text: str = Field(description="给用户看的建议文案")
    pain_point: str = Field(
        default="迷茫",
        description="可直接作为 POST /task/generate 的 pain_point 使用",
    )


class ReportScoreDelta(BaseModel):
    """与「最近一次**保存**的报告」相比的分数变化。

    **没有基线时全部为 0**（不是"真的没变化"）—— 前端要用 ``saved`` /
    ``last_saved_at`` 判断"是否有可比对的基线"，不能只看 delta 是否为 0。
    """

    clarity_score: float = 0.0
    action_score: float = 0.0
    resume_score: float = 0.0
    total_score: float = 0.0


class GrowthReportResponse(BaseModel):
    """``GET /report`` 与 ``POST /report/save`` 的 ``data``（两者形状完全一致）。"""

    stage: str = Field(default="explore", description="阶段 slug：explore / prepare / sprint")
    stage_label: str = Field(default="探索期", description="阶段中文展示名")
    stage_changed: bool = Field(default=False, description="相对最近一次保存的报告，阶段是否变化")

    clarity_score: float = 0.0
    action_score: float = 0.0
    resume_score: float = 0.0
    total_score: float = 0.0

    score_delta: ReportScoreDelta = Field(default_factory=ReportScoreDelta)

    completed_tasks: int = 0
    completed_steps: int = 0
    active_days: int = 0

    highlights: List[str] = Field(default_factory=list, description="亮点（AI/规则生成，用户不可编辑）")
    suggestions: List[GrowthSuggestion] = Field(
        default_factory=list, description="建议（每条带 pain_point，可一键生成任务）"
    )

    # ---- 保存状态（区分"实时数据"与"已保存的里程碑"）----
    last_saved_at: Optional[datetime] = Field(
        default=None, description="最近一次保存报告的时间；从未保存过为 null"
    )
    user_note: str = Field(
        default="", description="最近一次保存的报告里用户自己写的补充说明；没保存过为 \"\""
    )
    saved: bool = Field(default=False, description="是否至少保存过一份报告（决定 delta 是否有基线）")

    # 阶段字段统一（README §4.11）：对外一律 slug + 中文 label
    @field_validator("stage", mode="before")
    @classmethod
    def _normalize_stage(cls, value: object) -> str:
        return to_stage_slug(value if isinstance(value, str) else None)

    @model_validator(mode="after")
    def _fill_stage_label(self) -> "GrowthReportResponse":
        self.stage_label = to_stage_label(self.stage)
        return self


class ReportSaveRequest(BaseModel):
    """``POST /report/save`` 入参：只允许提交**用户补充说明**。

    ⚠️ **产品红线**：这里**没有**任何分数字段 —— 分数（clarity/action/resume/total）
    全部由行为算出，让用户改就失去意义（见 README §4.15.3）。
    想把用户输入混进分数，只能通过"做任务/打卡/简历/面试"这些被记录的行为。
    """

    user_note: Optional[str] = Field(
        default=None,
        max_length=USER_NOTE_MAX_LENGTH,
        description=f"我的补充说明，可选，最多 {USER_NOTE_MAX_LENGTH} 字；超长返回 1001",
    )


class GrowthReportContent(BaseModel):
    """落库时 ``reports.content`` 的约定结构（里程碑快照）。

    = :class:`GrowthReportResponse` 的字段 + ``user_note``。
    用户补充说明单独放在 ``content.user_note``，
    **不和 AI/规则生成的 highlights / suggestions 混在一起**（避免"哪些是用户写的"说不清）。
    """

    stage: str = "explore"
    stage_label: str = "探索期"
    stage_changed: bool = False
    clarity_score: float = 0.0
    action_score: float = 0.0
    resume_score: float = 0.0
    total_score: float = 0.0
    score_delta: Dict[str, float] = Field(default_factory=dict, description="与上一份保存的报告相比")
    completed_tasks: int = 0
    completed_steps: int = 0
    active_days: int = 0
    highlights: List[str] = Field(default_factory=list)
    suggestions: List[Dict[str, Any]] = Field(default_factory=list)
    user_note: str = Field(default="", description="用户自己写的补充说明（可编辑；分数不可编辑）")
    saved_at: Optional[str] = Field(default=None, description="该快照的保存时间（ISO 字符串）")
