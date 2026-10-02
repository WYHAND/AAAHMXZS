"""任务提醒任务（手册 12.2：每天 10 点，检查未打卡任务）。

11.13 / 1.5：MVP 只做「基础站内提醒」，不做推送通道。
本任务负责找出「进行中且超过 N 天没有新打卡」的任务，写入日志/提醒队列；
站内提醒的落地方式手册未定义（没有 notifications 表），见 README「待确认」。
"""

from __future__ import annotations

from datetime import timedelta
from typing import Dict, List

from sqlmodel import select

from app.db.session import SessionLocal
from app.models.task import Task, TaskStep
from app.models.user import utcnow
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

# 超过这个天数没有打卡就提醒
STALE_DAYS = 3


def remind_unfinished_tasks() -> List[Dict[str, str]]:
    """扫描未完成任务，返回提醒列表（当前仅记录日志）。

    TODO: 有通知表/Electron 通知通道后，把返回值交给推送层（见 README「待确认」）。
    """
    reminders: List[Dict[str, str]] = []
    try:
        with SessionLocal() as db:
            # 这里比的是"**过了多久**"（经过时长），不是"哪个日历日"，所以基准必须是
            # UTC，和 ``completed_at`` / ``created_at``（``utcnow()`` 写的 UTC）同源。
            # 原先用 ``datetime.now()``（本地时间，UTC+8）会比 UTC 快 8 小时，
            # 阈值整体后移 —— 任务要"多晾" 8 小时才会被提醒。
            # 注意：经过时长的比较**不需要**也不该用 app/utils/time.py 的日历日工具。
            threshold = utcnow() - timedelta(days=STALE_DAYS)
            statement = select(Task).where(Task.status == "进行中")  # type: ignore[union-attr]
            tasks = list(db.exec(statement).all())

            for task in tasks:
                last_step = db.exec(
                    select(TaskStep)
                    .where(TaskStep.task_id == task.id)
                    .order_by(TaskStep.completed_at.desc())  # type: ignore[union-attr]
                ).first()

                last_active = None
                if last_step is not None and last_step.completed_at is not None:
                    last_active = last_step.completed_at
                else:
                    last_active = task.created_at

                if last_active is not None and last_active < threshold:
                    reminders.append(
                        {
                            "user_id": str(task.user_id),
                            "task_id": str(task.id),
                            "title": task.title,
                            "message": f"「{task.title}」已经 {STALE_DAYS} 天没有新打卡了，要不要今天做一步？",
                        }
                    )

            logger.info("任务提醒检查完成，待提醒=%s 条", len(reminders))
    except Exception as exc:  # noqa: BLE001
        logger.error("任务提醒定时任务异常: %s", sanitize(exc))

    return reminders
