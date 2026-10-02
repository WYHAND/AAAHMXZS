"""AI 结构化输出的 Pydantic 契约（《开发手册》7.3）。

这些模型只描述“模型必须返回什么”，与数据库模型解耦：
数据库模型的字段是 5.3 规定的，AI 输出契约是为了校验模型回复而定义的。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

# 附录A 画像标签枚举
ALLOWED_DIMENSIONS = ("兴趣", "能力", "技能", "痛点", "焦虑", "认知", "其他")

# 附录F 岗位关键词库（骨架内置三个岗位）
JOB_KEYWORDS: Dict[str, List[str]] = {
    "产品经理": ["需求分析", "原型", "PRD", "用户调研", "竞品分析", "数据指标", "Axure", "流程图"],
    "前端开发": ["React", "Vue", "TypeScript", "Webpack", "CSS", "性能优化", "组件化", "Git"],
    "数据分析": ["SQL", "Python", "Excel", "可视化", "指标体系", "AB测试", "Pandas", "报表"],
}

CORE_DIMENSIONS = ("沟通表达", "逻辑思维", "专业基础", "项目经验", "求职动机")


# ---------- 7.4 profile_extract ----------

class ProfileTagItem(BaseModel):
    """单条画像标签。"""

    dimension: str = Field(description="兴趣/能力/技能/痛点/焦虑/认知")
    label: str = Field(max_length=100)
    weight: float = Field(default=0.5, ge=0.0, le=1.0)
    evidence: Optional[str] = Field(
        default=None,
        max_length=500,
        description=(
            "支撑该标签的原文片段 —— **必须是学生自己写过的原话**（从输入里原样复制），"
            "不是 AI 说的话、不是 AI 的提问、不是 AI 的安慰。没有学生原话就不要输出这条标签。"
            "服务端读侧还会拿它去 messages.role='user' 里做子串核对"
            "（见 profile_service.evidence_for_tags），对不上的一律不进 Prompt。"
        ),
    )


class ProfileExtractResult(BaseModel):
    """画像抽取结果。"""

    tags: List[ProfileTagItem] = Field(default_factory=list)
    pain_points: List[str] = Field(default_factory=list, description="识别出的痛点标签")
    summary: str = Field(default="", description="一句话归纳用户当前状态")


# ---------- 7.4 resume_parse ----------

class ResumeBasics(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    target_job: Optional[str] = None


class ResumeSectionItem(BaseModel):
    title: Optional[str] = Field(default=None, description="学校/公司/项目名")
    role: Optional[str] = Field(default=None, description="专业/职位/角色")
    period: Optional[str] = Field(default=None, description="起止时间")
    description: Optional[str] = Field(default=None, description="描述原文要点")
    highlights: List[str] = Field(default_factory=list, description="可量化的成果")


class ResumeParsed(BaseModel):
    """简历解析结果（13.3 文本 -> 结构化）。"""

    basics: ResumeBasics = Field(default_factory=ResumeBasics)
    education: List[ResumeSectionItem] = Field(default_factory=list)
    experience: List[ResumeSectionItem] = Field(default_factory=list)
    projects: List[ResumeSectionItem] = Field(default_factory=list)
    skills: List[str] = Field(default_factory=list)
    completeness: float = Field(default=0.0, ge=0.0, le=1.0, description="信息完整度 0-1")


# ---------- 7.4 resume_optimize ----------

class ResumeSuggestion(BaseModel):
    section: str = Field(description="basic/education/experience/project/skill 等小节")
    problem: str = Field(description="问题描述")
    suggestion: str = Field(description="修改建议")
    example: Optional[str] = Field(default=None, description="改写示例")


class ResumeOptimizeResult(BaseModel):
    ats_score: float = Field(default=0.0, ge=0.0, le=100.0)
    completeness: float = Field(default=0.0, ge=0.0, le=100.0)
    matched_keywords: List[str] = Field(default_factory=list)
    missing_keywords: List[str] = Field(default_factory=list)
    suggestions: List[ResumeSuggestion] = Field(default_factory=list)
    summary: str = ""


# ---------- 7.4 interview_question / interview_followup ----------

class InterviewQuestionItem(BaseModel):
    order: int = Field(default=1)
    content: str
    intent: Optional[str] = Field(default=None, description="出题意图")
    reference_points: List[str] = Field(default_factory=list, description="参考答案要点")


class InterviewQuestionResult(BaseModel):
    questions: List[InterviewQuestionItem] = Field(default_factory=list)


class InterviewFollowupResult(BaseModel):
    should_followup: bool = Field(default=True, description="是否需要追问")
    followup: Optional[str] = Field(default=None, description="追问题目")


# ---------- 7.4 interview_review ----------

class InterviewQuestionReview(BaseModel):
    question: str
    answer_summary: Optional[str] = None
    score: float = Field(default=0.0, ge=0.0, le=100.0)
    comment: str = ""
    better_answer: Optional[str] = None


class InterviewReviewResult(BaseModel):
    overall_score: float = Field(default=0.0, ge=0.0, le=100.0)
    dimension_scores: Dict[str, float] = Field(default_factory=dict, description="分维度得分")
    strengths: List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)
    question_reviews: List[InterviewQuestionReview] = Field(default_factory=list)
    summary: str = ""
    # 7.8 画像回流：本轮面试暴露的技能/盲区/沟通能力
    tags: List[ProfileTagItem] = Field(default_factory=list)


# ---------- 7.4 task_generate ----------

class TaskStepItem(BaseModel):
    order: int = Field(default=1)
    title: str
    action: str = Field(description="行动指引")
    resource: Optional[str] = Field(default=None, description="资源链接或搜索关键词")


class TaskGenerateResult(BaseModel):
    title: str
    description: str = ""
    pain_point: str = ""
    value_note: str = Field(default="", description="为什么值得做")
    difficulty: str = Field(default="简单", description="简单/中等/困难")
    estimated_days: int = Field(default=3, ge=1, le=90)
    steps: List[TaskStepItem] = Field(default_factory=list)


# ---------- 11.4 新会话开场白（JSON 结构化 + 声明依据） ----------

class OpeningResult(BaseModel):
    """开场白的结构化输出：**一句话 + 它依据了哪条素材**。

    ⚠️ **2026-11 语义已变（第三次报同一个问题后）**：新会话的第一句话
    **只聊日常**（"你今年大几啦？"），所以这一轮**不给模型任何素材**
    （标签 / 任务 / 用户原话 / stage 一律不进 Prompt）。

    于是 ``used`` 的角色从"申报依据"变成了**自证字段**：

    - 正常情况**恒为空数组** —— 第一句不依据任何素材；
    - 任何非空的 ``used`` 都会被 ``chat_service._validate_opening`` 判违规
      （本轮素材清单恒为空，申报的依据必然对不上）→ 换成本地日常模板；
    - 服务端另外**无条件**扫"用户事实引导语"（``_USER_FACT_HINTS``）：``text`` 里
      只要出现关于用户的具体事实（"你之前说过…""你提过…""你标签里…"），同样判违规。

    为什么还要保留 ``used`` 这个字段：它是"模型有没有偷偷加事实"的**可校验载体**，
    接口契约（``{text, used}`` 两个字段）不变，服务端校验逻辑也不用重写。

    ⚠️ **不要**给 ``used`` 加 ``max_length``/枚举校验器：允许空列表，
    而"非空即违规"这条业务判断留给服务端（``_validate_opening``），Pydantic 层判不了。

    （历史：最初加 ``used`` 是因为纯文本开场白无法检查"关于用户的陈述有没有依据"，
    实测模型会把素材加工成新事件：「帮同学修电脑」-> 「你上次说帮同学修电脑，那次是哪出问题？」。
    现在第一句连素材都没有了，这条防线改为"任何用户事实都拦"。）
    """

    text: str = Field(
        default="",
        description="开场白本身：一句话 ≤60 字，口语，无引号/JSON/Markdown/换行",
    )
    used: List[str] = Field(
        default_factory=list,
        description=(
            "**恒为空数组**：第一句话只聊日常，不依据任何素材。"
            "非空（标签/任务标题/用户原话）会被服务端判违规并换成日常模板；"
            "它现在只用来自证「没有偷偷加关于用户的事实」"
        ),
    )


# ---------- 11.11 结论卡片 ----------

class ConclusionCardResult(BaseModel):
    summary: str = ""
    pain_points: List[str] = Field(default_factory=list)
    suggestions: List[str] = Field(default_factory=list)
    next_actions: List[str] = Field(default_factory=list)


# ---------- 便捷默认实例（7.6 兜底用） ----------

def empty_profile_extract() -> ProfileExtractResult:
    return ProfileExtractResult(tags=[], pain_points=[], summary="")


def empty_resume_parsed() -> ResumeParsed:
    return ResumeParsed()


def empty_resume_optimize() -> ResumeOptimizeResult:
    return ResumeOptimizeResult()


def empty_interview_review() -> InterviewReviewResult:
    return InterviewReviewResult()


def empty_task_generate(pain_point: str = "迷茫") -> TaskGenerateResult:
    return TaskGenerateResult(
        title="先做一件小事",
        description="暂时没生成成功，先用一个通用起步任务。",
        pain_point=pain_point,
        value_note="动起来比想清楚更重要。",
        difficulty="简单",
        estimated_days=3,
        steps=[
            TaskStepItem(order=1, title="列出你感兴趣的 3 个方向", action="每方向写一句话说明为什么"),
            TaskStepItem(order=2, title="和一个学长/学姐聊 10 分钟", action="问他当初怎么选的"),
            TaskStepItem(order=3, title="写下今天的一个收获", action="三句话以内即可"),
        ],
    )


def empty_conclusion() -> ConclusionCardResult:
    return ConclusionCardResult()


__all__ = [
    "ALLOWED_DIMENSIONS",
    "JOB_KEYWORDS",
    "CORE_DIMENSIONS",
    "ProfileTagItem",
    "ProfileExtractResult",
    "ResumeBasics",
    "ResumeSectionItem",
    "ResumeParsed",
    "ResumeSuggestion",
    "ResumeOptimizeResult",
    "InterviewQuestionItem",
    "InterviewQuestionResult",
    "InterviewFollowupResult",
    "InterviewQuestionReview",
    "InterviewReviewResult",
    "TaskStepItem",
    "TaskGenerateResult",
    "OpeningResult",
    "ConclusionCardResult",
    "empty_profile_extract",
    "empty_resume_parsed",
    "empty_resume_optimize",
    "empty_interview_review",
    "empty_task_generate",
    "empty_conclusion",
]
