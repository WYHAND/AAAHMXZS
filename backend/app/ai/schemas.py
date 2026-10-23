"""AI 结构化输出的 Pydantic 契约（《开发手册》7.3）。

这些模型只描述“模型必须返回什么”，与数据库模型解耦：
数据库模型的字段是 5.3 规定的，AI 输出契约是为了校验模型回复而定义的。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field

# 附录A 画像标签枚举
ALLOWED_DIMENSIONS = ("兴趣", "能力", "技能", "痛点", "焦虑", "认知", "其他")

# 附录F 岗位关键词库（骨架内置三个岗位）
# ⚠️ 使用它的老 ATS 评分链路已整体移除（2026-11，见 README §4.10）：
#    现在只剩 ``db/init_db.py::seed_job_keywords`` 的日志引用它，保留为代码常量备查。
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


# ---------- 9.24 「我的画像」顶部那句人物速写 ----------

class ProfileSummaryResult(BaseModel):
    """``profile_summary`` Prompt 的结构化输出（勘误 9.24）。

    ⚠️ 只有 ``text`` 一个字段：这句话是**描述**，不是分数也不是建议 ——
    多给字段就等于鼓励模型给评价（9.24.4：卡片不评价、不提待提升）。
    """

    text: str = Field(default="", max_length=120, description="一句话人物速写，≤45 字")


# ---------- 11.8 简历润色（POST /resume/polish） ----------
#
# ⚠️ 这一组 schema 与"从一份简历 PDF 里解析出什么"的那套（basics/title/role/period/…）
# **不共用**：那套契约（``ResumeParsed`` / ``ResumeOptimizeResult`` 等）已随老的
# 「上传 -> 解析 -> ATS 评分 -> 报告」链路整体移除（2026-11，见 README §4.10）。
# 这里描述的是"把用户在表单里填的内容润色成简历口吻"（basic/target/education/skills/
# projects/campus+STAR），落库结构 ``parsed_data`` 就是它的形状。
#
# ⚠️ 这一轮**没有 evidence 字段**（与早期"从对话生成"的设计不同）：素材不再是历史对话，
# 而是**用户此刻在表单里亲手填的这一份内容**，它本身就是唯一依据。
# 所以护栏换成了 `resume_service` 的两条机械校验：
#   ① 润色结果里的数字必须是用户原文数字的子集（见 ``app/utils/fact_guard.py``）；
#   ② 用户没填的字段不许被填（空 -> 非空一律回退成空）。
# 命中任一条就把**那个字段**回退成用户原文（不整份丢弃）。

class ResumeStar(BaseModel):
    """STAR 表述（情境/任务/行动/结果）—— 只许在用户已写下的信息范围内组织。"""

    situation: str = Field(default="", description="S 情境：用户写的背景/问题，改写说法而已")
    task: str = Field(default="", description="T 任务：用户写过的目标；没写就留空")
    action: str = Field(default="", description="A 行动：用户写过的具体做法；没写就留空")
    result: str = Field(default="", description="R 结果：用户写过的产出/反馈；没写就留空")


class ResumeBasicInfo(BaseModel):
    """基本信息（短事实，润色只做措辞规整，不许补全）。"""

    name: str = Field(default="", description="姓名；用户没填就留空")
    gender: str = Field(default="", description="性别；用户没填就留空")
    grade: str = Field(default="", description="年级；用户没填就留空")
    major: str = Field(default="", description="专业；用户没填就留空")
    school: str = Field(default="", description="学校；用户没填就留空")
    contact: str = Field(default="", description="联系方式；用户没填就留空")


class ResumeTargetInfo(BaseModel):
    """求职意向。"""

    direction: str = Field(default="", description="求职方向；用户没填就留空")
    city: str = Field(default="", description="意向城市；用户没填就留空")


class ResumeEducationItem(BaseModel):
    """教育经历一条。"""

    school: str = Field(default="")
    major: str = Field(default="")
    period: str = Field(default="", description="起止时间；用户没填就留空，**不许推算**")
    highlights: List[str] = Field(default_factory=list, description="用户写过的亮点，逐条改写措辞")


class ResumeProjectItem(BaseModel):
    """项目经历一条（``star`` 为润色后的 STAR 表述）。"""

    name: str = Field(default="")
    role: str = Field(default="", description="担任角色；用户没填就留空")
    period: str = Field(default="", description="起止时间；用户没填就留空")
    star: ResumeStar = Field(default_factory=ResumeStar)


class ResumeCampusItem(BaseModel):
    """校园与实践经历一条（字段与项目经历同构）。"""

    name: str = Field(default="")
    role: str = Field(default="")
    period: str = Field(default="")
    star: ResumeStar = Field(default_factory=ResumeStar)


class ResumePolishResult(BaseModel):
    """``resume_polish`` Prompt 的结构化输出（模型只输出这一个 JSON 对象）。

    结构与 ``parsed_data`` **逐键一致**（这是刻意的：服务端按同一份模板做字段级
    回退与完整度计算，模型换个形状就没有可比对的基准）。

    ⚠️ ``skills`` 只收 ``List[str]``（用户填的就是技能词，模型没有需要改写的成分）。
    这里用 ``Union`` 容错模型写成 ``[{"name": "Vue"}]`` 的情况，
    ``resume_service._coerce_skills`` 会把它归一回字符串。
    """

    basic: ResumeBasicInfo = Field(default_factory=ResumeBasicInfo)
    target: ResumeTargetInfo = Field(default_factory=ResumeTargetInfo)
    education: List[ResumeEducationItem] = Field(default_factory=list)
    skills: List[Union[str, Dict[str, Any]]] = Field(default_factory=list)
    projects: List[ResumeProjectItem] = Field(default_factory=list)
    campus: List[ResumeCampusItem] = Field(default_factory=list)
    self_evaluation: str = Field(default="", description="自我评价，≤3 句，只许基于用户写下的内容")


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


def empty_resume_polish() -> ResumePolishResult:
    """润色的兜底（7.6）：**全空**。

    刻意不给任何"默认文案"：润色失败时服务端会退回**用户原文**，
    返回全空只用于"AI 完全不可用"这一种情况，绝不能凭空冒出用户没写过的话。
    """
    return ResumePolishResult()


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


def empty_profile_summary() -> ProfileSummaryResult:
    """摘要的兜底（7.6）：**空文本**。

    刻意不给默认文案：调用方（``profile_service.refresh_ai_summary``）拿到空串时会
    回落到**模板句**（从可见标签拼出来，确定性、绝不杜撰），而不是让模型之外的
    第二处又编一句人话。
    """
    return ProfileSummaryResult()


__all__ = [
    "ALLOWED_DIMENSIONS",
    "JOB_KEYWORDS",
    "CORE_DIMENSIONS",
    "ProfileTagItem",
    "ProfileExtractResult",
    "ProfileSummaryResult",
    "ResumeStar",
    "ResumeBasicInfo",
    "ResumeTargetInfo",
    "ResumeEducationItem",
    "ResumeProjectItem",
    "ResumeCampusItem",
    "ResumePolishResult",
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
    "empty_profile_summary",
    "empty_resume_polish",
    "empty_interview_review",
    "empty_task_generate",
    "empty_conclusion",
]
