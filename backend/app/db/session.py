"""数据库引擎与会话。

对应《开发手册》2.3 后端选型（SQLModel + PostgreSQL）与 5.5 数据库迁移。

说明：
- 使用同步驱动 psycopg2（手册 2.6 依赖清单即 psycopg2-binary），
  因此会话是同步 ``Session``；service 层签名统一为 ``Session``。
- 需要异步/线程池时，在路由里用 ``fastapi.concurrency.run_in_threadpool`` 包一层
  （见 ``app/api/v1/chat.py`` 的 SSE 端点）。
- 连接串里的 ``postgresql://`` 会被 SQLModel/SQLAlchemy 走 psycopg2 方言；
  若换成 ``postgresql+psycopg://`` 则需要 psycopg3，本骨架不这样做。
"""

from __future__ import annotations

from typing import Any, Generator, Optional

from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import settings

# pool_pre_ping：容器化部署下避免拿到被数据库断开的死连接
_engine_kwargs: dict[str, Any] = {"pool_pre_ping": True, "echo": bool(settings.DEBUG)}
if settings.DATABASE_URL.startswith("sqlite"):
    # 允许本地用 sqlite 做纯语法/流程试跑（手册未要求，仅供调试，见 README）
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine: Engine = create_engine(settings.DATABASE_URL, **_engine_kwargs)

SessionLocal = Session


def get_session() -> Generator[Session, None, None]:
    """独立会话工厂（等价于 ``app.core.deps.get_db``，供定时任务/脚本使用）。"""
    with Session(engine) as session:
        yield session


def session_scope() -> Session:
    """定时任务用的上下文：``with session_scope() as db: ...``。"""
    return Session(engine)


def init_engine(database_url: Optional[str] = None) -> Engine:
    """按需重建引擎（迁移脚本/测试用）。"""
    global engine
    engine = create_engine(database_url or settings.DATABASE_URL, **_engine_kwargs)
    return engine


def create_all() -> None:
    """仅用于本地快速试跑：直接建表。

    正式流程请用 Alembic（手册 5.5），不要在生产调用它。
    """
    # 触发模型注册
    import app.models  # noqa: F401

    SQLModel.metadata.create_all(engine)
