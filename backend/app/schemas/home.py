"""home 相关 schema：首页聚合（设计说明书 5.4 需求，手册 10.2 未列，按用户要求补实现）。

前端原本要串行发 4 个请求（profile / task / daily / conversations），
现在一次 ``GET /api/v1/home/summary`` 拿全，便于统一决策「下一步建议」。

契约（响应 data 的形状）：见 backend/README.md「/home/summary」一节。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.utils.stage import to_stage_label, to_stage_slug


class HomeProfileSummary(BaseModel):
    """首页要用的画像精简版（不返回完整 tags/user，避免首页响应过重）。"""

    model_config = ConfigDict(from_attributes=True)

    clarity_score: float = 0.0
    action_score: float = 0.0
    resume_score: float = 0.0
    total_score: float = 0.0
    stage: str = Field(default="explore", description="阶段 slug：explore / prepare / sprint")
    tested: bool = Field(
        default=False,
        description="是否已完成基础测试表（依据 test_results）。前端守卫必须用它，不要看画像对象是否存在",
    )

    # 防御性归一化：即使有人把 profiles 实体（stage 是中文）直接 model_validate 进来，
    # 出来的也一定是 slug。规则见 README §4.11。
    @field_validator("stage", mode="before")
    @classmethod
    def _normalize_stage(cls, value: object) -> str:
        return to_stage_slug(value if isinstance(value, str) else None)


class HomeTag(BaseModel):
    """首页展示用的画像标签（精简字段）。"""

    model_config = ConfigDict(from_attributes=True)

    dimension: str
    label: str
    weight: float = 0.0
    source: str = Field(default="test", description="test/chat/resume/interview/daily/task")


class HomeDailyQuestion(BaseModel):
    """今日一问；题库为空时整个对象为 ``null``。"""

    id: UUID
    content: str
    options: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="选项数组（已把 daily_questions.options 的 JSONB 归一化成数组）",
    )
    answered: bool = False


class HomeAiFinding(BaseModel):
    """AI 主动发现（痛点维度里权重最高的几条，最多 3 条）。"""

    pain_point: str = Field(description="痛点标签原文，如「缺项目经验」")
    label: str = Field(description="展示用标签（当前与 pain_point 同值，留字段是为了将来 AI 润色）")
    reason: str = Field(default="", description="为什么这么判断（尽量引用对话里的原话）")
    target_route: str = Field(default="/task", description="点这条建议应该去哪：/chat /task /resume /interview")


class HomeOngoingTask(BaseModel):
    """进行中的任务（最多 2 条）。"""

    id: UUID
    title: str
    difficulty: Optional[str] = None
    estimated_days: Optional[int] = None
    done_steps: int = Field(default=0, description="已完成步骤数（批量 group by 算出，非 N+1）")
    total_steps: int = Field(default=0, description="步骤总数")
    current_step_title: Optional[str] = Field(default=None, description="第一条未完成步骤的标题")


class HomeNextAction(BaseModel):
    """后端决定的「下一步做什么」。

    ⚠️ 这就是产品「AI 主动性」的落点：不让前端自己判断优先级，
    由后端按画像/任务状态给出唯一动作。当前是写死的规则（见 home_service.py），
    后续可替换为 AI 生成（届时本结构不变，前端不用改）。
    """

    text: str = Field(description="按钮/卡片文案")
    route: str = Field(description="前端路由，如 /chat、/task/<id>")
    reason: str = Field(default="", description="为什么推荐这个（给用户看的轻量解释）")


class HomeSummaryResponse(BaseModel):
    """``GET /api/v1/home/summary`` 的 data。"""

    stage: str = Field(default="explore", description="阶段 slug：explore / prepare / sprint")
    stage_label: str = Field(
        default="探索期", description="阶段中文名（附加字段，方便前端直接展示，可不使用）"
    )
    profile: HomeProfileSummary = Field(default_factory=HomeProfileSummary)
    tags: List[HomeTag] = Field(default_factory=list, description="画像标签（按权重降序）")
    daily_question: Optional[HomeDailyQuestion] = Field(
        default=None, description="今日一问；没有题目时为 null"
    )
    ai_findings: List[HomeAiFinding] = Field(
        default_factory=list, description="AI 主动发现（痛点维度权重 Top3）；没有则空数组，不报错"
    )
    ongoing_tasks: List[HomeOngoingTask] = Field(
        default_factory=list, description="进行中的任务（最多 2 条）"
    )
    next_action: HomeNextAction = Field(
        default_factory=lambda: HomeNextAction(
            text="和 AI 聊聊我的方向", route="/chat", reason="先聊聊，我们再决定做什么"
        )
    )

    # 阶段字段统一（同 ProfileResponse / TestResultResponse，见 README §4.11）
    @field_validator("stage", mode="before")
    @classmethod
    def _normalize_stage(cls, value: object) -> str:
        return to_stage_slug(value if isinstance(value, str) else None)

    @model_validator(mode="after")
    def _fill_stage_label(self) -> "HomeSummaryResponse":
        self.stage_label = to_stage_label(self.stage)
        return self
