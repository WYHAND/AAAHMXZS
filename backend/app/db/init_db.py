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
from typing import Dict, Optional, Sequence, Tuple

from app.db.seed_data import BADGES, DAILY_QUESTIONS, TEST_QUESTIONS
from app.db.session import create_all, describe_database, drop_all
from app.utils.logger import configure_logging, get_logger

logger = get_logger(__name__)

# 「后加的列」清单。``SQLModel.metadata.create_all`` 只建**缺失的表**，不会给已有表
# ALTER —— 所以老库（含打包后 exe 自带的库）在加列后会直接死在 ``no such column``。
# 加列时在这里登记一行即可（见 ensure_columns 的说明）。
ADDED_COLUMNS: Dict[str, Sequence[Tuple[str, str]]] = {
    # 勘误 9.24.5：「我的画像」卡片顶部那句人物速写
    "profiles": (
        ("ai_summary", "TEXT"),
        ("ai_summary_key", "TEXT"),
    ),
}


def ensure_columns() -> None:
    """幂等补齐「后加的列」（手册 5.5 迁移的最小实现）。

    为什么不只写一个一次性迁移脚本：**没人会记得在每条路径上跑它**。
    放在 ``init_db`` 里，开发库与打包产物就都能自愈 ——
    ``backend/run_server.py``（PyInstaller 入口）调的正是
    ``init_db(create_tables=True)``，所以交付出去的 exe 打开一次就自动补上。

    安全：只做 ``ADD COLUMN``（可空、无默认值），不动任何已有列与数据；
    列已存在就跳过；表还不存在时也跳过（``create_all`` 会连列一起建出来）。
    """
    from sqlalchemy import inspect, text

    from app.db.session import engine

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    added: list = []

    for table, columns in ADDED_COLUMNS.items():
        if table not in tables:
            continue
        present = {column["name"] for column in inspector.get_columns(table)}
        for name, ddl_type in columns:
            if name in present:
                continue
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl_type}"))
            added.append(f"{table}.{name}")

    if added:
        logger.info("ensure_columns：已补列 %s（手册 5.5）", ", ".join(added))
    else:
        logger.info("ensure_columns：无缺失列")


def ensure_indexes() -> None:
    """给**已有表**补建模型里声明、但库里缺失的索引（含 unique index）。

    为什么需要：``create_all`` 只建缺失的**表**，对已存在的表完全跳过 ——
    连后来在模型里新加的 ``index=True`` 都不会补。老库/打包后的 exe 因此会
    悄悄退化成全表扫描，且没有任何报错。这里按列集合判断是否已存在，
    再调 ``Index.create(checkfirst=True)``，对 SQLite / PostgreSQL 都成立。
    """
    import app.models  # noqa: F401 - 确保所有表已注册
    from sqlalchemy import inspect
    from sqlmodel import SQLModel

    from app.db.session import engine

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    created: list[str] = []

    for table in SQLModel.metadata.sorted_tables:
        if table.name not in tables:
            continue
        existing = {
            tuple(index.get("column_names") or ())
            for index in inspector.get_indexes(table.name)
        }
        for index in table.indexes:
            columns = tuple(column.name for column in index.columns)
            if columns in existing:
                continue
            try:
                index.create(bind=engine, checkfirst=True)
                created.append(f"{table.name}({', '.join(columns)})")
                existing.add(columns)
            except Exception as exc:  # noqa: BLE001 - 单个索引失败不应阻止启动
                logger.error(
                    "补建索引失败（该索引可能没建成，请手工检查） %s(%s): %s",
                    table.name,
                    ", ".join(columns),
                    exc,
                )

    if created:
        logger.info("ensure_indexes：已补索引 %s", ", ".join(created))
    else:
        logger.info("ensure_indexes：无缺失索引")


def ensure_unique_constraints() -> None:
    """给已有表补建模型里声明的唯一约束（以唯一索引的形式落地）。

    ``UniqueConstraint`` 无法像 ``Index`` 一样 ``create(checkfirst=True)``，
    只能显式 ``CREATE UNIQUE INDEX``。这里先按**列集合**判断（兼容 SQLite 的
    ``sqlite_autoindex`` 与 PG 的约束名差异），缺失才建。

    失败**不自动删数据**：如果库里已经有重复行，建索引会失败。此时只打一条
    可执行的 error（含排查 SQL），让部署者决定保留哪一条 —— 静默删用户数据
    比缺一个约束更危险。
    """
    import app.models  # noqa: F401 - 确保所有表已注册
    from sqlalchemy import UniqueConstraint, inspect, text
    from sqlmodel import SQLModel

    from app.db.session import engine

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    created: list[str] = []

    for table in SQLModel.metadata.sorted_tables:
        if table.name not in tables:
            continue

        existing: set[tuple[str, ...]] = set()
        for constraint in inspector.get_unique_constraints(table.name):
            existing.add(tuple(constraint.get("column_names") or ()))
        for index in inspector.get_indexes(table.name):
            if index.get("unique"):
                existing.add(tuple(index.get("column_names") or ()))

        for constraint in table.constraints:
            if not isinstance(constraint, UniqueConstraint):
                continue
            columns = tuple(column.name for column in constraint.columns)
            if columns in existing:
                continue

            name = constraint.name or f"uq_{table.name}_{'_'.join(columns)}"
            columns_sql = ", ".join(f'"{column}"' for column in columns)
            ddl = (
                f'CREATE UNIQUE INDEX IF NOT EXISTS "{name}" '
                f'ON "{table.name}" ({columns_sql})'
            )
            try:
                with engine.begin() as conn:
                    conn.execute(text(ddl))
                created.append(f"{table.name}({', '.join(columns)})")
                existing.add(columns)
            except Exception as exc:  # noqa: BLE001 - 见 docstring：不自动删重复数据
                logger.error(
                    "补建唯一约束失败（表里可能已有重复行，系统未自动删除）%s(%s): %s。"
                    " 排查：SELECT %s, COUNT(*) FROM %s GROUP BY %s HAVING COUNT(*) > 1；"
                    " 处理完重复行后重新执行 `python -m app.db.init_db` 即可补上。",
                    table.name,
                    ", ".join(columns),
                    exc,
                    ", ".join(columns),
                    table.name,
                    ", ".join(columns),
                )

    if created:
        logger.info("ensure_unique_constraints：已补唯一约束 %s", ", ".join(created))
    else:
        logger.info("ensure_unique_constraints：无缺失唯一约束")


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
        # create_all 之后：补齐「后加的列 / 索引 / 唯一约束」
        # （老库与打包产物自愈；create_all 不会 ALTER 已存在的表）
        ensure_columns()
        ensure_indexes()
        ensure_unique_constraints()
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
    """奖章定义落库（手册 5.4 + 11.12）；返回**新增**枚数。

    幂等 **upsert**（不是"按名字跳过已存在"）：按 ``name`` 找，
    - 不存在 -> 插入；
    - 存在但 ``condition`` 变了 -> **只更新 condition 这一列**（不动 id / name，
      所以 ``user_badges`` 里指向它的行一条都不会丢，已获得的奖章不会因为重灌种子而失效）。

    为什么必须更新而不是跳过：真实库里那两枚旧奖章是"没有 key 的旧定义"
    （``{"event": ..., "threshold": ..., "description": ...}``），
    前端要靠 ``condition["key"]`` 选奖章美术；只跳过的话它们**永远补不上 key**。

    ``condition`` 是跨方言 JSON 列，整体赋值即可（SQLAlchemy 不追踪 JSON 内部就地修改）。
    """
    from sqlmodel import Session, select

    from app.db.session import engine
    from app.models.badge import Badge

    created = 0
    updated = 0
    with Session(engine) as db:
        existing = {badge.name: badge for badge in db.exec(select(Badge)).all()}
        for item in BADGES:
            condition = item.get("condition")
            badge = existing.get(item["name"])
            if badge is None:
                db.add(Badge(name=item["name"], condition=condition))
                created += 1
                continue
            if badge.condition != condition:
                badge.condition = condition
                db.add(badge)
                updated += 1
        db.commit()
        total = len(db.exec(select(Badge.id)).all())
    logger.info(
        "seed_badges: 新增 %s 枚，更新 %s 枚，共 %s 枚（手册 5.4 / 11.12）",
        created,
        updated,
        total,
    )
    return created


def seed_all() -> int:
    """一次性灌入全部种子数据，返回**新增**条数合计。

    幂等：重复执行不会重复插入（各类数据按 code / content / name 判重；
    奖章按 name **upsert**，定义变了会更新 ``condition``）。
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
    parser.add_argument(
        "--no-demo",
        dest="demo",
        action="store_false",
        help="不创建 demo 演示账号（默认创建，账号 demo / demo123456）",
    )
    parser.add_argument("--drop", dest="drop_first", action="store_true", help="【危险】先删表再建")
    parser.set_defaults(create_tables=True, seed=True, demo=True, drop_first=False)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI 入口：``python -m app.db.init_db [--no-seed] [--no-demo] [--drop]``。"""
    configure_logging()
    args = _parse_args(argv)

    logger.info("=" * 60)
    logger.info("初始化数据库，目标：%s", describe_database())
    logger.info("=" * 60)

    init_db(create_tables=args.create_tables, drop_first=args.drop_first)
    if args.seed:
        seed_all()
        if args.demo:
            from app.db.seed_demo import seed_demo_user

            if seed_demo_user():
                logger.info("演示账号：demo / demo123456（登录后直接看完整闭环）")

    logger.info("完成。下一步：uvicorn app.main:app --reload --port 8000（手册 3.6）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
