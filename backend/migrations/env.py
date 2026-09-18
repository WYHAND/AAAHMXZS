"""Alembic 迁移环境（手册 5.5 / 17.6）。

- 连接串从 ``app.core.config.settings.DATABASE_URL`` 读取，不写在 alembic.ini 里
- ``target_metadata`` 用 SQLModel 的元数据；必须 import app.models 才能注册全部表
- **SQLite 下开启 ``render_as_batch=True``**：SQLite 的 ``ALTER TABLE`` 能力极弱
  （不能 DROP COLUMN / ALTER COLUMN），Alembic 的 batch 模式会走
  "建新表 -> 拷数据 -> 删旧表 -> 改名" 的迂回路线，否则以后任何改列操作都会失败
- autogenerate 只能识别到表结构变化，JSONB → JSON 这类方言差异需要人工核对
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

# 让 `alembic` 在 backend/ 下执行时能 import 到 app 包
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
import app.models  # noqa: E402,F401  触发全部模型注册
from app.db.session import normalize_database_url  # noqa: E402

config = context.config

# 允许用环境变量覆盖（例如容器里通过 env_file 注入）。
# SQLite 的相对路径会在这里被归一化成 backend/ 下的绝对路径，
# 保证 `alembic upgrade head` 与运行时看到的是**同一个库文件**。
_raw_url = os.getenv("DATABASE_URL") or settings.DATABASE_URL
_normalized_url, _sqlite_path = normalize_database_url(_raw_url)
config.set_main_option("sqlalchemy.url", _normalized_url)

IS_SQLITE = _normalized_url.strip().lower().startswith("sqlite")
if _sqlite_path is not None:
    print(f"[alembic] 使用 SQLite 文件: {_sqlite_path}")

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# autogenerate 的目标元数据（16 张表，见 app/models/__init__.py）
target_metadata = SQLModel.metadata


def _common_context_kwargs() -> dict:
    """两种模式共用的 context 参数。

    ``render_as_batch`` 只对 SQLite 有效（其它方言会忽略），在 SQLite 上是必需的：
    没有它，以后 autogenerate 出来的改列/删列语句在 SQLite 上会直接失败。
    """
    return {
        "target_metadata": target_metadata,
        "compare_type": True,
        "compare_server_default": True,
        "render_as_batch": IS_SQLITE,
    }


def run_migrations_offline() -> None:
    """离线模式：只生成 SQL，不连数据库（alembic upgrade head --sql）。"""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **_common_context_kwargs(),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：连库执行迁移。"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, **_common_context_kwargs())
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
