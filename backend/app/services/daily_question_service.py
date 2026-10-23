"""每日一问业务逻辑（手册 11.7、7.4 daily_question、7.8 画像回流）。

流程（11.7）：
1. 每天生成 1 题（``app/tasks/daily_question_job.py`` 每天 0 点跑）
2. 用户点击即答（``answer_question``）
3. 累计 7 题触发画像微调（``should_refresh_profile`` + 回流标签）
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import FALLBACK_CHAT_REPLY
from app.ai.schemas import ProfileTagItem  # noqa: F401 - 类型提示用
from app.core.errors import BusinessException, ErrorCode
from app.models.daily_question import DailyAnswer, DailyQuestion
from app.models.user import User
from app.schemas.daily_question import (
    DailyAnswerRequest,
    DailyAnswerResponse,
    DailyHistoryItem,
    DailyHistoryResponse,
    DailyQuestionResponse,
    TodayQuestionResponse,
)
from app.services import profile_service
from app.utils.logger import get_logger, sanitize
from app.utils.time import current_local_date, local_date_of, local_day_range_utc

logger = get_logger(__name__)

# 11.7：累计 7 题触发画像微调
REFRESH_EVERY_N_ANSWERS = 7

# 维度轮换顺序（5.4：30 题，四维度轮换）
DIMENSION_ROTATION: List[str] = ["兴趣", "能力", "技能", "痛点", "焦虑", "认知"]

# 题库来源：`daily_questions` 表（种子在 app/db/seed_data.py::DAILY_QUESTIONS，
# 由 `python -m app.db.init_db` 灌入）。**不再保留代码内兜底题库** ——
# 之前题库为空时会返回一道"id 是全零 UUID 的假题"，前端拿这个 id 去
# POST /daily/answer 竟然还能写进 daily_answers（SQLite 当时没开外键强制），
# 结果库里出现指向不存在题目的孤儿回答。现在题库为空就明确返回 null，
# 由前端展示空态并提示先执行 init_db。


# ---------------------------------------------------------------------------
# 今日问题（GET /daily/today）
# ---------------------------------------------------------------------------

def get_today_question(db: Session, user: User) -> TodayQuestionResponse:
    """GET /daily/today：返回今天该答的题目（**只从数据库题库取**）。

    选择策略：
    1. 今天已答过 -> 直接返回那道题 + ``answered=True``；
    2. 否则按"用户回答数 % 维度数"轮换维度，取该维度下第一道没答过的题；
    3. 该维度都答完了 -> 全局找一道没答过的；
    4. **题库为空或全答完 -> ``question = None``**（契约允许 null，前端展示空态）。

    第 4 条曾经是"返回一道内置占位题、id 用全零 UUID"——那是假数据：
    前端拿全零 UUID 去答题居然能写进 ``daily_answers``（当时 SQLite 没开外键强制），
    库里就留下了指向不存在题目的孤儿记录。现在宁可为 null 也不造假。
    """
    answered_today = _find_answer_today(db, user.id)
    if answered_today is not None:
        question = db.get(DailyQuestion, answered_today.question_id)
        return TodayQuestionResponse(
            question=_question_response(question),
            answered=True,
            answer=answered_today.answer,
            streak=count_consecutive_days(db, user.id),
        )

    total_answered = count_answers(db, user.id)
    dimension = DIMENSION_ROTATION[total_answered % len(DIMENSION_ROTATION)]
    question = _pick_question_for_dimension(db, user.id, dimension)

    return TodayQuestionResponse(
        question=question,
        answered=False,
        answer=None,
        streak=count_consecutive_days(db, user.id),
    )


def _question_response(question: Optional[DailyQuestion]) -> Optional[DailyQuestionResponse]:
    """ORM 行 -> 出参；``None`` 原样返回（题库空/答完时前端显示空态）。"""
    if question is None:
        return None
    return DailyQuestionResponse.model_validate(question)


def _pick_question_for_dimension(db: Session, user_id, dimension: str) -> Optional[DailyQuestionResponse]:
    """按维度挑一道用户没答过的题；都答完了返回 ``None``。"""
    answered_ids = {
        row.question_id for row in db.exec(select(DailyAnswer).where(DailyAnswer.user_id == user_id)).all()
    }
    statement = select(DailyQuestion).where(DailyQuestion.dimension == dimension)
    for question in db.exec(statement).all():
        if question.id not in answered_ids:
            return DailyQuestionResponse.model_validate(question)

    # 该维度都答过了 -> 全局找一道没答过的
    for question in db.exec(select(DailyQuestion)).all():
        if question.id not in answered_ids:
            return DailyQuestionResponse.model_validate(question)

    # 题库为空 或 全部答完：返回 None（不再造占位题）
    logger.info("每日一问：没有可出的题（题库为空或已答完）user_id=%s", user_id)
    return None


# ---------------------------------------------------------------------------
# 回答（POST /daily/answer）
# ---------------------------------------------------------------------------

async def answer_question(db: Session, user: User, payload: DailyAnswerRequest) -> DailyAnswerResponse:
    """POST /daily/answer：记录回答；累计 7 题触发画像微调（11.7）。"""
    if _find_answer_today(db, user.id) is not None:
        raise BusinessException(ErrorCode.PARAM_ERROR, "今天已经回答过了，明天再来")

    question = db.get(DailyQuestion, payload.question_id)
    if question is None:
        # 显式校验：题目必须真实存在。
        # 曾经（题库存代码常量 + 全零 UUID 占位题 + SQLite 未开外键）这里能"成功"
        # 写入一条指向不存在题目的 daily_answers，产生孤儿数据。
        # 现在除了这段校验，SQLite 也已经开启 PRAGMA foreign_keys=ON（双重保险）。
        raise BusinessException.not_found("题目不存在，请重新获取今日问题")

    answer = DailyAnswer(
        user_id=user.id,
        question_id=payload.question_id,
        answer=payload.answer,
    )
    db.add(answer)
    db.commit()
    db.refresh(answer)

    total = count_answers(db, user.id)
    refreshed = False
    extracted: List[Dict[str, Any]] = []

    # 规则：答题即记录一次"持续反思"线索（11.7 的无感采集）
    profile_service.apply_tags(
        db,
        user.id,
        [{"dimension": "能力", "label": "持续反思", "weight": 0.4, "source": "daily"}],
        source="daily",
    )

    if should_refresh_profile(total):
        text = f"每日一问（{question.dimension}）：{question.content}\n学生回答：{payload.answer}"
        extracted = await profile_service.extract_tags_from_text(db, user.id, text, source="daily")
        profile_service.recompute_stage(db, user.id)
        refreshed = True
        logger.info("每日一问累计 %s 题，已触发画像微调 user_id=%s", total, user.id)

    response = DailyAnswerResponse.model_validate(answer)
    response.profile_refreshed = refreshed
    response.extracted_tags = extracted
    return response


def should_refresh_profile(total_answers: int) -> bool:
    """11.7：累计 7 题触发画像微调。"""
    return total_answers > 0 and total_answers % REFRESH_EVERY_N_ANSWERS == 0


# ---------------------------------------------------------------------------
# 历史（GET /daily/history）
# ---------------------------------------------------------------------------

# 服务端硬上限：**不是分页**（10.2 没有分页约定，不自创 offset/cursor）。
# 用户每天最多答 1 题，正常一年也就 365 条；这里压到 100 条纯粹是"极端脏数据
# 情况下别一次吐爆响应体"的兜底。`total` 仍返回真实总条数，前端据此提示
# "仅显示最近 100 条"。要真正分页必须走手册 10.2 的变更流程。
HISTORY_MAX_ITEMS = 100

# 题目被删/改后 join 不到时的占位（**不静默丢条目**）
_HISTORY_MISSING_CONTENT = ""


def get_history(db: Session, user: User) -> DailyHistoryResponse:
    """GET /daily/history：当前用户答过的每日一问，``answered_at`` 倒序（最新在前）。

    - 只查"当前 token 的用户"（不接收任何 id），因此不存在越权/2001 的场景；
    - ``items`` 用 ``daily_answers`` join ``daily_questions`` 取题干与维度；
    - **容错**：外键虽然指向 ``daily_questions``，但历史脏数据/题库重建可能让某条
      回答找不到题目。此时 ``content`` 给空字符串、``dimension`` 给 ``null``，
      **条目照样返回**（绝不静默丢 —— 用户会以为打卡记录消失）。
      这也保证接口不会因为一条脏数据 500 掉整个历史；
    - 标题信息一次查出（``IN`` 批量），不做 N+1。
    """
    total = count_answers(db, user.id)

    statement = (
        select(DailyAnswer)
        .where(DailyAnswer.user_id == user.id)
        .order_by(
            DailyAnswer.answered_at.desc(),  # type: ignore[union-attr]
            DailyAnswer.id.desc(),  # 次级键：时间戳并列时保证顺序稳定（同 README §4.13.8）
        )
        .limit(HISTORY_MAX_ITEMS)
    )
    answers = list(db.exec(statement).all())

    # 一次批量取题目，避免逐条 db.get 的 N+1
    question_ids = {row.question_id for row in answers}
    questions: Dict[Any, DailyQuestion] = {}
    if question_ids:
        rows = db.exec(select(DailyQuestion).where(DailyQuestion.id.in_(question_ids))).all()  # type: ignore[union-attr]
        questions = {q.id: q for q in rows}

    items: List[DailyHistoryItem] = []
    for row in answers:
        question = questions.get(row.question_id)
        if question is None:
            logger.warning(
                "每日一问历史：题目已不可用（脏数据），按占位返回 answer_id=%s question_id=%s user_id=%s",
                row.id, row.question_id, user.id,
            )
        items.append(
            DailyHistoryItem(
                id=row.id,
                question_id=row.question_id,
                content=question.content if question is not None else _HISTORY_MISSING_CONTENT,
                dimension=question.dimension if question is not None else None,
                answer=row.answer,
                answered_at=row.answered_at,
            )
        )

    if total > len(items):
        logger.info("每日一问历史：user_id=%s total=%s 仅返回最近 %s 条", user.id, total, len(items))
    return DailyHistoryResponse(total=total, items=items)


# ---------------------------------------------------------------------------
# 统计
# ---------------------------------------------------------------------------

def count_answers(db: Session, user_id) -> int:
    return len(db.exec(select(DailyAnswer.id).where(DailyAnswer.user_id == user_id)).all())


def _find_answer_today(db: Session, user_id) -> Optional[DailyAnswer]:
    """今天（**用户本地日历日**）是否已答。

    ``answered_at`` 是 ``utcnow()`` 写的 naive UTC，而"今天"是用户所在时区的
    日历日，所以窗口必须先在本地日历日上取好、再换算回 UTC 才能和这一列直接比较
    （换算集中在 ``app/utils/time.py``，不要在这里自己拼 ``datetime.now()``）。

    历史 bug：原先用 ``datetime.combine(datetime.now().date(), time.min)`` 取本地
    日期当窗口边界，直接和 UTC 列比较，等于窗口整体前移 8 小时 —— 本地
    00:00–08:00 答的题被判成"不是今天"，页面于是显示未答（见 utils/time.py 注释）。
    """
    start, end = local_day_range_utc()
    statement = select(DailyAnswer).where(
        DailyAnswer.user_id == user_id,
        DailyAnswer.answered_at >= start,
        DailyAnswer.answered_at < end,
    )
    return db.exec(statement).first()


def count_consecutive_days(db: Session, user_id) -> int:
    """连续打卡天数（从**用户本地的今天**往前数连续日期）。

    去重/游标都必须用"本地日历日"：``answered_at`` 是 UTC，直接 ``.date()`` 得到
    UTC 日历日，和 ``datetime.now().date()``（本地日历日）混用，会在本地
    00:00–08:00 这段把前一天的答题算到"今天"，连续天数偏大。
    """
    statement = select(DailyAnswer).where(DailyAnswer.user_id == user_id).order_by(
        DailyAnswer.answered_at.desc()  # type: ignore[union-attr]
    )
    answers = list(db.exec(statement).all())
    if not answers:
        return 0

    days = {local_date_of(a.answered_at) for a in answers if a.answered_at}
    streak = 0
    cursor = current_local_date()
    if cursor not in days:
        cursor = cursor - timedelta(days=1)
    while cursor in days:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


# ---------------------------------------------------------------------------
# 定时任务用：每日一问生成（app/tasks/daily_question_job.py）
# ---------------------------------------------------------------------------

async def generate_daily_question_for_user(db: Session, user: User, stage: str = "探索期") -> Optional[DailyQuestion]:
    """12.2：每天 0 点为用户准备次日题目。

    逻辑：先从**数据库题库**里挑一道该用户没答过的题；
    题库耗尽时，取题库里最后一道题的维度/题干作为素材，调用 ``daily_question``
    Prompt 生成一道新的口语化题目并落库；AI 不可用则返回 ``None``（不造占位题）。

    ``stage`` 是**中文阶段名**（给 Prompt 用，见 ``profile_service.get_stage``）。
    """
    answered_ids = {
        row.question_id for row in db.exec(select(DailyAnswer).where(DailyAnswer.user_id == user.id)).all()
    }
    for question in db.exec(select(DailyQuestion)).all():
        if question.id not in answered_ids:
            return question

    # 题库耗尽：以题库里的题作为素材，让 AI 生成一道同维度的新题（7.4）
    source_row = db.exec(select(DailyQuestion)).first()
    if source_row is None:
        # 题库根本没初始化：不生成假题，让调用方/日志暴露"需要先 init_db"
        logger.warning("每日一问题库为空，跳过生成（请先执行 python -m app.db.init_db）user_id=%s", user.id)
        return None

    source_dimension = source_row.dimension
    source_content = source_row.content
    source_options = (source_row.options or {}).get("options") if isinstance(source_row.options, dict) else None
    try:
        text = await deepseek_client.chat_prompt_text(
            prompt_name="daily_question",
            variables={
                "dimension": source_dimension,
                "content": source_content,
                "options": source_options or [],
                "stage": stage,
                "profile_summary": "",
            },
            temperature=0.9,
            max_tokens=200,
        )
    except Exception as exc:  # noqa: BLE001 - 7.6 兜底
        logger.warning("每日一问生成失败，本轮跳过 user_id=%s err=%s", user.id, sanitize(exc))
        return None

    if (text or "").strip() == FALLBACK_CHAT_REPLY:
        # AI 挂了：别把兜底话术当题干写进 daily_questions（宁可不生成）
        logger.warning("每日一问命中 AI 兜底话术，本轮跳过 user_id=%s", user.id)
        return None

    content = (text or "").strip().splitlines()[0][:200] if text else ""
    if not content:
        return None

    question = DailyQuestion(
        dimension=source_dimension,
        content=content,
        options={"options": source_options or [], "generated_by": "ai"},
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question
