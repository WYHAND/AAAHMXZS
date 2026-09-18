"""数据库初始化（手册 5.4 种子数据、5.5 迁移）。

两条路径（README §2.1 / §4.13）：

1. **SQLite 联调（最省事）**::

       cd backend
       python -m app.db.init_db            # 建表 + 灌种子占位（幂等，可反复跑）
       python -m app.db.init_db --no-seed  # 只建表
       python -m app.db.init_db --drop     # 【危险】先删表再建

2. **Alembic（生产/正式）**::

       alembic upgrade head

   ``create_all`` 不记录迁移版本，所以正式库请走 Alembic；SQLite 下也能用 Alembic，
   但注意 ``render_as_batch``（见 ``migrations/env.py``）。

种子数据（5.4）目前全是**占位函数**：按任务要求不生成假的种子数据大礼包，
只留函数与注释说明该填什么。它们在本文件里可以被安全调用（写 0 条、只打日志）。
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence

from app.db.seed_data import BADGES, DAILY_QUESTIONS, TEST_QUESTIONS
from app.db.session import create_all, describe_database, drop_all
from app.utils.logger import configure_logging, get_logger

logger = get_logger(__name__)


def init_db(create_tables: bool = False, drop_first: bool = False) -> None:
    """初始化数据库。

    - ``create_tables=True``：调用 ``SQLModel.metadata.create_all``（幂等）；
    - ``drop_first=True``：先 ``drop_all``（**会丢数据**，仅本地试跑）；
    - ``create_tables=False``：只给提示，不动任何 DDL（正式流程走 Alembic）。
    """
    if drop_first:
        logger.warning("--drop：即将删除全部表，这是破坏性操作")
        drop_all()

    if create_tables:
        logger.info("目标数据库：%s", describe_database())
        create_all()
        logger.info("提示：生产 PostgreSQL 请改用 `alembic upgrade head`（手册 5.5）")
        return

    logger.info("init_db: 请先执行 `alembic upgrade head` 完成建表（手册 5.5）")


def seed_test_questions() -> int:
    """基础测试题 30 题落库（手册 5.4：30-50 题、纯选择题、四维度）。

    幂等：按 ``code`` 判重，已存在就跳过（不覆盖，避免把人工微调过的题面冲掉）。
    题库内容在 ``app/db/seed_data.py::TEST_QUESTIONS``。
    """
    from sqlmodel import Session, select

    from app.db.session import engine
    from app.models.test import TestQuestion

    created = 0
    with Session(engine) as db:
        existing = {
            row for row in db.exec(select(TestQuestion.code)).all()
        }
        for order_no, item in enumerate(TEST_QUESTIONS, start=1):
            if item["code"] in existing:
                continue
            db.add(
                TestQuestion(
                    code=item["code"],
                    dimension=item["dimension"],
                    content=item["content"],
                    options=item.get("options"),
                    multiple=bool(item.get("multiple", False)),
                    order_no=order_no,
                )
            )
            created += 1
        db.commit()
        total = len(db.exec(select(TestQuestion.id)).all())
    logger.info("seed_test_questions: 新增 %s 题，题库共 %s 题（手册 5.4）", created, total)
    return created


def seed_daily_questions() -> int:
    """每日一问题库 30 题落库（手册 5.4：30 题，四维度轮换）。

    幂等：按 ``content`` 判重（``daily_questions`` 没有 code 列，题干本身足够唯一）。
    """
    from sqlmodel import Session, select

    from app.db.session import engine
    from app.models.daily_question import DailyQuestion

    created = 0
    with Session(engine) as db:
        existing = set(db.exec(select(DailyQuestion.content)).all())
        for item in DAILY_QUESTIONS:
            if item["content"] in existing:
                continue
            # options 存 {"options": [...]} 形状：与接口契约（home/daily 会归一化成数组）一致，
            # 且保留了以后加元数据的空间。
            db.add(
                DailyQuestion(
                    dimension=item["dimension"],
                    content=item["content"],
                    options={"options": item.get("options") or []},
                )
            )
            created += 1
        db.commit()
        total = len(db.exec(select(DailyQuestion.id)).all())
    logger.info("seed_daily_questions: 新增 %s 题，题库共 %s 题（手册 5.4）", created, total)
    return created


def seed_task_templates() -> int:
    """成长任务模板：**不落库**（当前有意为之）。

    模板在 ``app/services/task_service.py::TASK_TEMPLATES``，用途是喂给
    ``task_generate`` Prompt 的**参考样例**，不是用户可见数据；手册 5.2 也没有
    模板表。因此保留为代码常量，并在 README §5.2 说明未落库的原因与影响。
    """
    from app.services.task_service import TASK_TEMPLATES

    logger.info(
        "seed_task_templates: 跳过（模板是 AI 提示词参考，保留为代码常量，共 %s 个）",
        len(TASK_TEMPLATES),
    )
    return 0


def seed_job_keywords() -> int:
    """岗位关键词库：**不落库**（当前有意为之）。

    在 ``app/ai/schemas.py::JOB_KEYWORDS``，用途是 ATS 评分的**词表**，
    不是用户可见数据；手册 5.2 也没有对应表。理由见 README §5.2。
    """
    from app.ai.schemas import JOB_KEYWORDS

    logger.info("seed_job_keywords: 跳过（ATS 评分词表，保留为代码常量，共 %s 个岗位）", len(JOB_KEYWORDS))
    return 0


def seed_badges() -> int:
    """奖章定义落库（手册 5.4「起步行动家」+ 11.12）。

    幂等：按 ``name`` 判重。``condition`` 是跨方言 JSON 列，整体赋值即可。
    """
    from sqlmodel import Session, select

    from app.db.session import engine
    from app.models.badge import Badge

    created = 0
    with Session(engine) as db:
        existing = set(db.exec(select(Badge.name)).all())
        for item in BADGES:
            if item["name"] in existing:
                continue
            db.add(Badge(name=item["name"], condition=item.get("condition")))
            created += 1
        db.commit()
        total = len(db.exec(select(Badge.id)).all())
    logger.info("seed_badges: 新增 %s 枚，共 %s 枚（手册 5.4 / 11.12）", created, total)
    return created


def seed_all() -> int:
    """一次性灌入全部种子数据，返回**新增**条数合计。

    幂等：重复执行不会重复插入（各类数据按 code / content / name 判重）。
    """
    total = (
        seed_test_questions()
        + seed_daily_questions()
        + seed_task_templates()
        + seed_job_keywords()
        + seed_badges()
    )
    logger.info("seed_all 完成，新增 %s 条（重复执行不会重复插入）", total)
    return total


def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m app.db.init_db",
        description="建表 + 灌种子占位（SQLite 联调用；生产请走 alembic upgrade head）",
    )
    parser.add_argument(
        "--create-tables",
        action="store_true",
        help="调用 create_all 建表（幂等，默认开启）",
    )
    parser.add_argument(
        "--no-create-tables",
        dest="create_tables",
        action="store_false",
        help="不建表，只打提示/只灌种子",
    )
    parser.add_argument("--no-seed", dest="seed", action="store_false", help="只建表，不灌种子")
    parser.add_argument("--drop", dest="drop_first", action="store_true", help="【危险】先删表再建")
    parser.set_defaults(create_tables=True, seed=True, drop_first=False)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI 入口：``python -m app.db.init_db [--no-seed] [--no-create-tables] [--drop]``。"""
    configure_logging()
    args = _parse_args(argv)

    logger.info("=" * 60)
    logger.info("初始化数据库，目标：%s", describe_database())
    logger.info("=" * 60)

    init_db(create_tables=args.create_tables, drop_first=args.drop_first)
    if args.seed:
        seed_all()

    logger.info("完成。下一步：uvicorn app.main:app --reload --port 8000（手册 3.6）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
