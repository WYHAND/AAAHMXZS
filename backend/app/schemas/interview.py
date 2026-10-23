"""interview 相关 schema（11.9 模拟面试）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class InterviewStartRequest(BaseModel):
    """POST /interview/start 入参。

    ``mode`` / ``scene`` **故意不加 Literal 白名单校验**：合法值域由服务端
    ``interview_service._normalize_start_params`` 统一收敛（非法值回落默认值 + 日志），
    而不在这里 422 拦住用户 —— 这两个字段只决定"按什么方式出题"，写歪了应该让面试
    照常开始，而不是把已经点了"开始"的用户挡回来。schema 层只声明形状。
    """

    mode: str = Field(default="小测试", description="小测试 / 全真（5.3）；非法值服务端回落为默认")
    scene: str = Field(default="HR", description="HR / 项目 / 技术（5.3）；非法值服务端回落为默认")
    resume_id: Optional[UUID] = Field(default=None, description="基于哪份简历出题；为空则用最新简历")
    target_job: Optional[str] = Field(default=None, max_length=100)


class InterviewAnswerRequest(BaseModel):
    """POST /interview/{id}/answer 入参。"""

    question_id: UUID
    answer: str = Field(min_length=1, max_length=5000, description="用户回答文本")


class InterviewSubmitRequest(BaseModel):
    """内部：写入单题（出题时用）。"""

    content: str
    question_order: int = 1
    score: Optional[float] = None
    extra: Optional[Dict[str, Any]] = None


class InterviewQuestionResponse(BaseModel):
    """一道面试题（**始终是数据库里那一行主问题**，追问不新建行）。

    追问相关的三个字段从 ``extra`` JSONB 里读出来并平铺，方便前端直接用：

    - ``kind``：``main`` / ``followup``（这行当前处于什么状态）
    - ``current_followup``：当前**待回答**的追问句；没有则为 ``null``
    - ``followup_round``：这一题已经追问过的轮数（0 起）
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    interview_id: UUID
    question_order: int
    content: str = Field(description="主问题原文（追问句在 current_followup，不要覆盖这里）")
    answer: Optional[str] = Field(default=None, description="学生对**主问题**的回答（不会被追问回答覆盖）")
    followups: List[Dict[str, Any]] = Field(
        default_factory=list,
        description='追问问答记录：[{"round": 1, "q": "追问句", "a": "学生的回答"}]',
    )
    score: Optional[float] = None
    created_at: datetime
    answered_at: Optional[datetime] = None
    kind: str = Field(default="main", description="main / followup")
    current_followup: Optional[str] = Field(default=None, description="当前待回答的追问句；无则 null")
    followup_round: int = Field(default=0, description="这一题已追问过的轮数（0 起，上限 2）")


class InterviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    mode: str
    scene: str
    status: str
    created_at: datetime
    updated_at: datetime
    report: Optional[Dict[str, Any]] = None


class InterviewHistoryItem(BaseModel):
    """GET /interview/history 的一条已完成面试。

    只给列表需要的字段：复盘页仍然按 id 调 ``GET /interview/{id}/review``，
    这里不把整份 report 搬进列表（报告很长，列表只需要一个分数和入口）。
    """

    id: UUID
    mode: str
    scene: str
    status: str
    created_at: datetime
    updated_at: datetime
    # 有 AI 评分时才有值；兜底复盘（没有维度分）返回 None
    overall_score: Optional[float] = None
    has_review: bool = False


class InterviewQuestionsResponse(BaseModel):
    """GET /interview/{id}/questions 出参。"""

    interview_id: UUID
    mode: str
    scene: str
    status: str
    questions: List[InterviewQuestionResponse] = Field(default_factory=list)
    current_index: int = Field(default=1, description="当前应回答第几题（从 1 开始）")


class InterviewFinishResponse(BaseModel):
    """结束面试的返回。

    **幂等**：对已经生成过复盘的面试重复调用 ``finish``，服务端直接回已有报告，
    不重跑 AI、不更新 ``updated_at``；出参结构保持不变，前端无需区分首调/重调。
    """

    interview_id: UUID
    status: str = "已完成"
    report: Optional[Dict[str, Any]] = Field(default=None, description="复盘报告（11.9）")


class InterviewAnswerResponse(BaseModel):
    """``POST /interview/{id}/answer`` 出参：追问 / 下一题 / 面试结束。

    **前端的唯一判别依据是 ``action``**（不要靠猜、也不要靠 next_question 是否变化）：

    | action | 含义 | 前端该做什么 |
    |---|---|---|
    | ``followup`` | 这题要再问一句 | **不要追加新题**，在 ``question_id`` 这一题上就地续问，显示 ``display_content`` |
    | ``next_question`` | 换一道新题 | 顺序追加一题，显示 ``display_content`` |
    | ``finished`` | 题目问完了 | 调 ``POST /interview/{id}/finish`` 生成复盘报告 |

    ``is_followup`` 是 ``action == "followup"`` 的便捷布尔值；
    ``finished`` 是 ``action == "finished"`` 的便捷布尔值。
    """

    interview_id: UUID
    action: Literal["followup", "next_question", "finished"] = Field(
        default="next_question", description="**判别字段**：followup / next_question / finished"
    )
    is_followup: bool = Field(default=False, description='等价于 action == "followup"')
    finished: bool = Field(default=False, description='等价于 action == "finished"')
    question_id: Optional[UUID] = Field(
        default=None,
        description=(
            "本次回答**归属**的题（追问时与上一题相同 id，前端据此就地更新而不是追加）；"
            "finished 时为 null"
        ),
    )
    parent_question_id: Optional[UUID] = Field(
        default=None, description="追问时指向主问题 id（当前实现里等于 question_id）；新题与 finished 时为 null"
    )
    display_content: Optional[str] = Field(
        default=None,
        description="前端要显示/播报的文本：追问时是追问句，新题时是题目原文；finished 时为 null",
    )
    followup_round: int = Field(
        default=0, description="本次要回答的对象已追问的轮数（追问时 1..2）；新题为 0"
    )
    next_question: Optional[InterviewQuestionResponse] = Field(
        default=None, description="完整题目对象（追问时就是同一行题，content 仍是主问题）"
    )
    message: str = "success"

    @model_validator(mode="after")
    def _derive_flags(self) -> "InterviewAnswerResponse":
        """两个便捷布尔值由 action 派生，避免三处各写一遍导致不一致。"""
        self.is_followup = self.action == "followup"
        self.finished = self.action == "finished"
        return self


class InterviewReviewResponse(BaseModel):
    """GET /interview/{id}/review 出参。"""

    interview_id: UUID
    status: str
    overall_score: float = Field(default=0.0, description="综合得分 0-100")
    dimension_scores: Dict[str, float] = Field(default_factory=dict, description="分维度得分")
    strengths: List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)
    question_reviews: List[Dict[str, Any]] = Field(default_factory=list, description="逐题点评")
    summary: str = ""
    generated_at: Optional[datetime] = None
