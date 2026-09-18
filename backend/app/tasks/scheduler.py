"""APScheduler 调度器（手册 12.1 / 12.2）。

任务清单（12.2）：

===========  ==========  ==================================
任务          频率         说明
===========  ==========  ==================================
每日一问生成   每天 0 点    生成次日题目
任务提醒       每天 10 点   检查未打卡任务
奖章结算       每小时       检查奖章条件
数据清理       每周         清理过期临时文件
===========  ==========  ==================================

12.3 不做：双月复盘、画像衰减。
"""

from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.tasks.badge_job import settle_badges
from app.tasks.cleanup_job import cleanup_expired_files
from app.tasks.daily_question_job import generate_daily_questions
from app.tasks.reminder_job import remind_unfinished_tasks
from app.utils.logger import get_logger

logger = get_logger(__name__)

# 全局单例（12.1 示例即模块级 scheduler）
scheduler = AsyncIOScheduler(timezone="Asia/Shanghai")

JOB_DAILY_QUESTION = "daily_question_generate"
JOB_TASK_REMINDER = "task_reminder"
JOB_BADGE_SETTLE = "badge_settle"
JOB_CLEANUP = "data_cleanup"


def register_jobs() -> None:
    """注册全部定时任务（幂等：重复调用会替换同名 job）。"""
    scheduler.add_job(
        generate_daily_questions,
        trigger=CronTrigger(hour=0, minute=0),
        id=JOB_DAILY_QUESTION,
        name="每日一问生成（每天0点）",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        remind_unfinished_tasks,
        trigger=CronTrigger(hour=10, minute=0),
        id=JOB_TASK_REMINDER,
        name="任务提醒（每天10点）",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        settle_badges,
        trigger=CronTrigger(minute=0),  # 每小时
        id=JOB_BADGE_SETTLE,
        name="奖章结算（每小时）",
        replace_existing=True,
        misfire_grace_time=1800,
    )
    scheduler.add_job(
        cleanup_expired_files,
        trigger=CronTrigger(day_of_week="sun", hour=3, minute=0),  # 每周日 3 点
        id=JOB_CLEANUP,
        name="数据清理（每周）",
        replace_existing=True,
        misfire_grace_time=7200,
    )
    logger.info("APScheduler 已注册 %s 个定时任务", len(scheduler.get_jobs()))


def start_scheduler() -> AsyncIOScheduler:
    """在 FastAPI startup 时调用（见 app/main.py）。"""
    if not scheduler.running:
        register_jobs()
        scheduler.start()
        logger.info("APScheduler 已启动，时区=%s", scheduler.timezone)
    return scheduler


def shutdown_scheduler() -> None:
    """在 FastAPI shutdown 时调用。"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("APScheduler 已停止")
