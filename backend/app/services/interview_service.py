"""AI 模拟面试业务逻辑（手册 11.9、7.4、7.8）。

流程（11.9）：
1. ``start_interview``：选模式与场景 -> DeepSeek 基于简历出题 -> 写 interviews + interview_questions
2. ``get_questions``：取题目（含追问出来的题）
3. ``submit_answer``：存回答 -> 判断是否需要追问（每题 1-2 轮）-> 返回下一题
4. ``finish_interview``：生成复盘报告 -> 写 interviews.report
5. ``get_review``：读复盘报告

画像回流钩子（7.8）：``finish_interview`` 结束后把复盘里的 tags 写入 profile_tags
（技能、项目深度、知识盲区、沟通能力），并重算阶段。
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import STRUCTURED_TEMPERATURE
from app.ai.schemas import (
    CORE_DIMENSIONS,
    InterviewFollowupResult,
    InterviewQuestionResult,
    InterviewReviewResult,
    empty_interview_review,
)
from app.core.errors import BusinessException, ErrorCode, not_found_unless_owner
from app.models.interview import Interview, InterviewQuestion
from app.models.resume import Resume
from app.models.user import User, utcnow
from app.schemas.interview import (
    InterviewAnswerRequest,
    InterviewAnswerResponse,
    InterviewFinishResponse,
    InterviewQuestionResponse,
    InterviewQuestionsResponse,
    InterviewResponse,
    InterviewReviewResponse,
    InterviewStartRequest,
)
from app.services import profile_service
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

# 11.9：每题后 1-2 轮追问
MAX_FOLLOWUP_PER_QUESTION = 2

# 模式 -> 题目数量（小测试轻量，全真完整）
MODE_QUESTION_COUNT: Dict[str, int] = {"小测试": 3, "全真": 6}

FALLBACK_QUESTIONS: List[Dict[str, Any]] = [
    {
        "order": 1,
        "content": "先简单介绍一下你自己吧，重点说说和这个岗位相关的部分。",
        "intent": "破冰 + 自我认知",
        "reference_points": ["表述有条理", "能提炼与岗位相关的经历"],
    },
    {
        "order": 2,
        "content": "你简历里最想让我问的是哪一段经历？为什么？",
        "intent": "考察自我评估",
        "reference_points": ["能说清角色", "能说出这段经历的收获"],
    },
    {
        "order": 3,
        "content": "这件事里最难的地方是什么，你当时怎么处理的？",
        "intent": "考察解决问题的能力",
        "reference_points": ["有具体难点", "有处理过程", "有结果"],
    },
]


# ---------------------------------------------------------------------------
# 开始面试 / 出题
# ---------------------------------------------------------------------------

async def start_interview(db: Session, user: User, payload: InterviewStartRequest) -> InterviewResponse:
    """POST /interview/start（11.9 第 1-2 步）。"""
    mode = payload.mode if payload.mode in MODE_QUESTION_COUNT else "小测试"
    scene = payload.scene or "HR"

    resume = _pick_resume(db, user, payload.resume_id)
    target_job = payload.target_job or (resume.target_job if resume else None) or "未指定"
    tags = profile_service.serialize_tags(profile_service.list_tags(db, user.id))
    resume_json = json.dumps((resume.parsed_data if resume else None) or {}, ensure_ascii=False)

    result: InterviewQuestionResult = await deepseek_client.chat_prompt_json(
        prompt_name="interview_question",
        variables={
            "mode": mode,
            "scene": scene,
            "target_job": target_job,
            "resume_json": resume_json,
            "profile_tags": tags,
        },
        schema=InterviewQuestionResult,
        default=InterviewQuestionResult(),
        temperature=STRUCTURED_TEMPERATURE,
    )

    interviews = Interview(user_id=user.id, mode=mode, scene=scene, status="进行中")
    db.add(interviews)
    db.commit()
    db.refresh(interviews)

    questions = result.questions or []
    if not questions:
        # 7.6 兜底：AI 出题失败时用内置题目
        logger.warning("面试出题为空，使用内置兜底题目 user_id=%s", user.id)
        questions = InterviewQuestionResult.model_validate({"questions": FALLBACK_QUESTIONS}).questions

    expected = MODE_QUESTION_COUNT.get(mode, 3)
    for index, question in enumerate(questions[:expected], start=1):
        db.add(
            InterviewQuestion(
                interview_id=interviews.id,
                question_order=question.order or index,
                content=question.content,
                extra={"intent": question.intent, "reference_points": question.reference_points,
                       "kind": "main", "followup_round": 0},
            )
        )
    db.commit()

    return InterviewResponse.model_validate(interviews)


def get_questions(db: Session, user: User, interview_id: UUID) -> InterviewQuestionsResponse:
    """GET /interview/{id}/questions。"""
    interview = get_interview(db, user, interview_id)
    questions = list_questions(db, interview.id)
    current = next((q.question_order for q in questions if not q.answer), len(questions) or 1)
    return InterviewQuestionsResponse(
        interview_id=interview.id,
        mode=interview.mode,
        scene=interview.scene,
        status=interview.status,
        questions=[to_question_response(q) for q in questions],
        current_index=current,
    )


# ---------------------------------------------------------------------------
# 提交回答 + 追问
# ---------------------------------------------------------------------------

async def submit_answer(
    db: Session,
    user: User,
    interview_id: UUID,
    payload: InterviewAnswerRequest,
) -> InterviewAnswerResponse:
    """``POST /interview/{id}/answer``（11.9 第 3 步：每题后 1-2 轮追问）。

    状态机（**追问不新建题目行**，全部挂在这一行 ``interview_questions`` 上）：

    ``extra["followup_question"]`` 是"当前是否有待回答的追问"的**唯一真源**：

    1. 进来时如果它非空 -> 学生这次答的是**追问** -> 追加到 ``followups``，
       然后清空它（表示追问已答完）；
    2. 否则 -> 学生答的是**主问题** -> 写 ``question.answer``（主问题回答永不被覆盖）；
    3. 已追问轮数 < 2 时问 AI 要不要继续追问：要 -> 写回 ``followup_question`` +
       ``followup_round+1``，返回 ``action="followup"``；
    4. 不追问 -> 找下一道 ``answer`` 还为空的主问题，返回 ``action="next_question"``；
    5. 没有下一题 -> ``action="finished"``，提示前端调 ``/finish``。

    ⚠️ 历史实现有两个 bug（已修）：
    - 用 ``extra["kind"] == "followup"`` 判断"这次答的是不是追问"，但那个字段从来
      没被置成 ``"followup"``（出题时写死 ``"main"``），于是**主问题的回答会被第二次
      作答覆盖**、``followups`` 永远为空；现在改判 ``followup_question`` 是否待答。
    - ``followups`` 从未被回传给前端，追问句也藏在 ``extra`` 里没暴露；
      现在 schema 平铺了 ``current_followup`` / ``followup_round`` / ``kind``。
    """
    interview = get_interview(db, user, interview_id)
    if interview.status == "已完成":
        raise BusinessException(ErrorCode.PARAM_ERROR, "该场面试已结束")

    question = db.get(InterviewQuestion, payload.question_id)
    if question is None or question.interview_id != interview.id:
        # 不属于本场面试的题目一律按"不存在"处理（同"越权按不存在"规则，README §8）
        raise BusinessException.not_found("题目不存在")

    extra = dict(question.extra or {})
    asked_rounds = int(extra.get("followup_round") or 0)
    pending_followup = extra.get("followup_question") or None

    # ⚠️ JSONB 写入约定：**只做整体赋值，不做就地修改**。
    # SQLAlchemy 默认不追踪 JSON 列的内部变更（这就是 MutableDict 存在的原因）：
    # 如果直接 `question.extra["x"] = 1` 而不重新赋值，flush 时比较不出差异，UPDATE 不会发。
    # 所以这里统一是 `extra = dict(question.extra or {})` -> 改副本 -> `question.extra = extra`，
    # `followups` 同理（每次都新建 list 再赋值）。
    if pending_followup:
        followups = list(question.followups or [])
        followups.append({"round": asked_rounds, "q": pending_followup, "a": payload.answer})
        question.followups = followups
        extra["followup_question"] = None      # 追问已答完
        extra["kind"] = "followup"
    else:
        question.answer = payload.answer       # 主问题回答，永不覆盖
        extra["kind"] = extra.get("kind") or "main"

    question.answered_at = utcnow()
    question.extra = extra
    db.add(question)
    db.commit()
    db.refresh(question)

    # 3) 还要不要继续追问（上限 MAX_FOLLOWUP_PER_QUESTION 轮）
    if asked_rounds < MAX_FOLLOWUP_PER_QUESTION:
        followup = await _maybe_followup(db, interview, question, payload.answer, asked_rounds)
        if followup is not None:
            extra["followup_question"] = followup
            extra["followup_round"] = asked_rounds + 1
            question.extra = extra
            db.add(question)
            db.commit()
            db.refresh(question)
            return InterviewAnswerResponse(
                interview_id=interview.id,
                action="followup",
                question_id=question.id,
                parent_question_id=question.id,   # 同一行题，前端就地续问
                display_content=followup,
                followup_round=asked_rounds + 1,
                next_question=to_question_response(question),
                message="请回答追问",
            )

    # 4/5) 换下一道未作答的主问题；没有就结束
    next_question = next((q for q in list_questions(db, interview.id) if not q.answer), None)
    if next_question is None:
        return InterviewAnswerResponse(
            interview_id=interview.id,
            action="finished",
            question_id=None,
            parent_question_id=None,
            display_content=None,
            followup_round=0,
            next_question=None,
            message="题目已全部作答，请调用 POST /interview/{id}/finish 生成复盘报告",
        )
    return InterviewAnswerResponse(
        interview_id=interview.id,
        action="next_question",
        question_id=next_question.id,
        parent_question_id=None,
        display_content=next_question.content,
        followup_round=0,
        next_question=to_question_response(next_question),
        message="next question",
    )


async def _maybe_followup(
    db: Session,
    interview: Interview,
    question: InterviewQuestion,
    answer: str,
    followup_round: int,
) -> Optional[str]:
    """7.4 interview_followup：判断是否需要追问（失败返回 None，不打断流程）。"""
    try:
        result: InterviewFollowupResult = await deepseek_client.chat_prompt_json(
            prompt_name="interview_followup",
            variables={
                "scene": interview.scene,
                "question": question.content,
                "answer": answer,
                "followup_round": followup_round,
            },
            schema=InterviewFollowupResult,
            default=InterviewFollowupResult(should_followup=False),
            temperature=STRUCTURED_TEMPERATURE,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("追问判断失败 interview_id=%s err=%s", interview.id, sanitize(exc))
        return None

    if result.should_followup and result.followup:
        return result.followup.strip()[:200]
    return None


# ---------------------------------------------------------------------------
# 结束 + 复盘（11.9 第 4 步、7.4 interview_review）
# ---------------------------------------------------------------------------

async def finish_interview(db: Session, user: User, interview_id: UUID) -> InterviewFinishResponse:
    """POST /interview/{id}/finish：生成复盘报告。"""
    interview = get_interview(db, user, interview_id)
    questions = list_questions(db, interview.id)
    if not questions:
        raise BusinessException(ErrorCode.PARAM_ERROR, "该面试还没有题目")

    report = await _build_review(db, user, interview, questions)

    interview.report = report
    interview.status = "已完成"
    interview.updated_at = utcnow()
    db.add(interview)
    db.commit()
    db.refresh(interview)

    # 7.8 画像回流：面试 -> 技能/项目深度/知识盲区/沟通能力
    tags = report.get("tags") or []
    if tags:
        profile_service.apply_tags(db, user.id, tags, source="interview")
    profile_service.recompute_stage(db, user.id)

    return InterviewFinishResponse(interview_id=interview.id, status=interview.status, report=report)


def get_review(db: Session, user: User, interview_id: UUID) -> InterviewReviewResponse:
    """GET /interview/{id}/review：读复盘报告（未结束时提示先 finish）。"""
    interview = get_interview(db, user, interview_id)
    report = dict(interview.report or {})
    if not report:
        raise BusinessException(ErrorCode.NOT_FOUND, "该面试尚未生成复盘报告，请先调用 finish")

    dimension_scores = {k: float(v) for k, v in (report.get("dimension_scores") or {}).items()}
    for dimension in CORE_DIMENSIONS:
        dimension_scores.setdefault(dimension, 0.0)

    return InterviewReviewResponse(
        interview_id=interview.id,
        status=interview.status,
        overall_score=float(report.get("overall_score") or 0.0),
        dimension_scores=dimension_scores,
        strengths=list(report.get("strengths") or []),
        improvements=list(report.get("improvements") or []),
        question_reviews=list(report.get("question_reviews") or []),
        summary=str(report.get("summary") or ""),
        generated_at=interview.updated_at,
    )


async def _build_review(
    db: Session,
    user: User,
    interview: Interview,
    questions: List[InterviewQuestion],
) -> Dict[str, Any]:
    """调用 interview_review Prompt 生成复盘；失败用 7.6 兜底结构。"""
    qa_payload = [
        {
            "order": q.question_order,
            "question": q.content,
            "answer": q.answer,
            "followups": q.followups,
            "reference_points": (q.extra or {}).get("reference_points"),
        }
        for q in questions
    ]
    tags = profile_service.serialize_tags(profile_service.list_tags(db, user.id))

    result: InterviewReviewResult = await deepseek_client.chat_prompt_json(
        prompt_name="interview_review",
        variables={
            "mode": interview.mode,
            "scene": interview.scene,
            "target_job": "未指定",
            "qa_json": json.dumps(qa_payload, ensure_ascii=False),
            "profile_tags": tags,
        },
        schema=InterviewReviewResult,
        default=empty_interview_review(),
        temperature=STRUCTURED_TEMPERATURE,
        max_tokens=3000,
    )

    return {
        "overall_score": result.overall_score,
        "dimension_scores": result.dimension_scores,
        "strengths": result.strengths,
        "improvements": result.improvements,
        "question_reviews": [r.model_dump() for r in result.question_reviews],
        "summary": result.summary,
        # 7.8 回流标签随报告一起保存
        "tags": [t.model_dump() for t in result.tags],
        "generated_at": utcnow().isoformat(),
    }


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

def get_interview(db: Session, user: User, interview_id: UUID) -> Interview:
    """取当前用户自己的面试。

    **「不存在」与「不属于自己」都返回 2001**（项目级编码规则，见 README §8 与
    ``app.core.errors.not_found_unless_owner``）。本函数服务于
    ``/{id}/questions``、``/{id}/answer``、``/{id}/finish``、``/{id}/review``。
    """
    return not_found_unless_owner(db.get(Interview, interview_id), user.id, "面试记录不存在")


def list_questions(db: Session, interview_id: UUID) -> List[InterviewQuestion]:
    statement = (
        select(InterviewQuestion)
        .where(InterviewQuestion.interview_id == interview_id)
        .order_by(InterviewQuestion.question_order.asc(), InterviewQuestion.created_at.asc())  # type: ignore[union-attr]
    )
    return list(db.exec(statement).all())


def to_question_response(question: InterviewQuestion) -> InterviewQuestionResponse:
    """ORM 行 -> 出参（额外把 ``extra`` 里的追问状态平铺出来）。

    为什么不直接用 ``model_validate``：``kind`` / ``current_followup`` /
    ``followup_round`` 存在 ``extra`` JSONB 里，不是模型属性，需要显式解包。
    """
    extra = question.extra if isinstance(question.extra, dict) else {}
    followups = question.followups if isinstance(question.followups, list) else []
    return InterviewQuestionResponse(
        id=question.id,
        interview_id=question.interview_id,
        question_order=question.question_order,
        content=question.content,
        answer=question.answer,
        followups=followups,
        score=question.score,
        created_at=question.created_at,
        answered_at=question.answered_at,
        kind=str(extra.get("kind") or "main"),
        current_followup=extra.get("followup_question") or None,
        followup_round=int(extra.get("followup_round") or 0),
    )


def _pick_resume(db: Session, user: User, resume_id: Optional[UUID]) -> Optional[Resume]:
    """11.9：基于简历出题；未指定就用最新一份。"""
    if resume_id is not None:
        resume = db.get(Resume, resume_id)
        if resume is None or resume.user_id != user.id:
            raise BusinessException(ErrorCode.NOT_FOUND, "简历不存在")
        return resume
    statement = (
        select(Resume)
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc())  # type: ignore[union-attr]
    )
    return db.exec(statement).first()
