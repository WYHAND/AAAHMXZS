"""每日一问生成任务（手册 12.2：每天 0 点，生成次日题目）。"""

from __future__ import annotations

from sqlmodel import select

from app.db.session import SessionLocal
from app.models.daily_question import DailyQuestion
from app.models.user import User
from app.services import daily_question_service, profile_service
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)


async def generate_daily_questions() -> int:
    """为所有未注销用户准备一道每日一问。

    - 题库还有没答过的题 -> 直接复用（不重复建题）
    - 题库耗尽 -> 调 ``daily_question`` Prompt 生成口语化题目（7.4）
    - 任何单个用户失败都不影响其他用户（12.2 单机定时任务要稳）

    返回本次处理（生成或选中）的用户数。
    """
    processed = 0
    try:
        with SessionLocal() as db:
            users = list(db.exec(select(User).where(User.deleted_at.is_(None))).all())  # type: ignore[union-attr]
            logger.info("每日一问生成开始，用户数=%s", len(users))

            for user in users:
                try:
                    stage = profile_service.get_stage(db, user.id)
                    question = await daily_question_service.generate_daily_question_for_user(db, user, stage)
                    if question is None:
                        logger.warning("每日一问未生成 user_id=%s", user.id)
                        continue
                    processed += 1
                except Exception as exc:  # noqa: BLE001 - 单用户失败不中断任务
                    logger.error("每日一问生成失败 user_id=%s err=%s", user.id, sanitize(exc))

            total_questions = len(db.exec(select(DailyQuestion.id)).all())
            logger.info("每日一问生成完成 processed=%s 题库总量=%s", processed, total_questions)
    except Exception as exc:  # noqa: BLE001 - 定时任务不能把异常抛给调度器
        logger.error("每日一问定时任务异常: %s", sanitize(exc))

    return processed
