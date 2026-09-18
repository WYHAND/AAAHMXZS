"""数据库初始化（手册 5.4 种子数据、5.5 迁移）。

本模块只做两件事：
1. ``init_db()``：正式建表走 Alembic（5.5），这里仅在本地缺迁移时给出提示；
2. ``seed_all()``：种子数据占位。

按任务要求：**不生成假的种子数据大礼包**，只留占位函数 + 注释说明该填什么（5.4）。
"""

from __future__ import annotations

from app.utils.logger import get_logger

logger = get_logger(__name__)


def init_db(create_tables: bool = False) -> None:
    """初始化数据库。

    - 正式流程：``alembic upgrade head``（手册 5.5），本函数不做任何 DDL。
    - ``create_tables=True`` 仅供本地无 Alembic 时快速试跑（不用于生产）。
    """
    if create_tables:
        from app.db.session import create_all

        logger.warning("create_all 仅供本地试跑，正式环境请使用 Alembic 迁移（手册 5.5）")
        create_all()
        return
    logger.info("init_db: 请先执行 `alembic upgrade head` 完成建表（手册 5.5）")


def seed_test_questions() -> int:
    """占位：基础测试题 30-50 题，纯选择题，四维度（手册 5.4）。

    实作要点（11.2 / 11.3 / 附录C）：
    - 覆盖维度：职业目标清晰度(clarity)、求职行动进度(action)、简历完整度(resume)、兴趣倾向；
    - 每题给出 4 个选项与分值（0-5），用于加权计算；
    - 题库目前按任务要求保留为占位，接口 ``GET /test/questions`` 会返回内置占位题库
      （见 app/services/profile_service.py 的 ``TEST_QUESTION_BANK``）。

    TODO: 落库到独立的 test_questions 表或静态 JSON（需先补 5.3 的表结构，见 README 待确认）。
    """
    logger.info("seed_test_questions: 占位，尚未实现（手册 5.4）")
    return 0


def seed_daily_questions() -> int:
    """占位：每日一问题库 30 题，四维度轮换（手册 5.4 / 附录D）。

    TODO: 写入 ``daily_questions`` 表，字段 dimension / content / options。
    """
    logger.info("seed_daily_questions: 占位，尚未实现（手册 5.4）")
    return 0


def seed_task_templates() -> int:
    """占位：成长任务模板 6 个，每个 3-5 步（手册 5.4 / 附录E）。

    TODO: 建 template 表或本地常量；``POST /task/generate`` 从模板实例化到 ``tasks`` + ``task_steps``。
    """
    logger.info("seed_task_templates: 占位，尚未实现（手册 5.4）")
    return 0


def seed_job_keywords() -> int:
    """占位：岗位关键词库（产品经理 / 前端开发 / 数据分析，附录F）。

    TODO: 建常量或表，供 ATS 评分（11.8）与 resume_optimize 使用。
    """
    logger.info("seed_job_keywords: 占位，尚未实现（手册 5.4 / 附录F）")
    return 0


def seed_badges() -> int:
    """占位：奖章「起步行动家」（手册 5.4 / 11.12）。

    TODO: 写入 ``badges`` 表，condition 形如
    ``{"event": "task_first_completed", "threshold": 1}``。
    """
    logger.info("seed_badges: 占位，尚未实现（手册 5.4）")
    return 0


def seed_all() -> None:
    """一次性灌入全部种子数据（当前全部为占位）。"""
    total = (
        seed_test_questions()
        + seed_daily_questions()
        + seed_task_templates()
        + seed_job_keywords()
        + seed_badges()
    )
    logger.info("seed_all 完成，共写入 %s 条（骨架阶段均为占位，未真实落库）", total)


if __name__ == "__main__":
    # 用法（有 Python 后）：python -m app.db.init_db
    from app.utils.logger import configure_logging

    configure_logging()
    logger.info("init_db: 请先执行 `alembic upgrade head` 完成建表（手册 5.5）")
