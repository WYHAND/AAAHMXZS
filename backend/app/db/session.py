"""数据库引擎与会话（SQLite 默认 / PostgreSQL 可切）。

对应《开发手册》2.3 后端选型与 5.5 数据库迁移。

⚠️ **数据库已由 PostgreSQL 改为 SQLite（用户拍板，见 README §4.13 与第 6 节）**。
本模块是「一套代码两种库」的落点，要点：

1. **驱动**：SQLite 走内置 ``sqlite3``（Python 自带，零依赖）；
   PostgreSQL 走 ``psycopg2-binary``（现在在 requirements.txt 里是注释掉的可选项）。
2. **SQLite 相对路径归一化**：``sqlite:///./data/app.db`` 里的相对路径按
   **backend/** 解析（而不是进程 CWD），并自动创建父目录 —— 否则从仓库根启动
   会把库文件落到别处，且首次启动会因为目录不存在直接报错。
3. **``check_same_thread=False``**：FastAPI 的同步路由跑在线程池、SSE 端点还会在
   生成器里再用一次 Session，不设这个会报
   ``SQLite objects created in a thread can only be used in that same thread``。
4. **连接池**：文件型 SQLite 用默认池即可；**内存库必须 ``StaticPool`` +
   ``check_same_thread=False``**，否则每个连接看到的是各自独立的空库。
5. **会话类型**：统一是同步 ``Session``（service 层签名都是 ``Session``），
   需要异步时在路由里用 ``fastapi.concurrency.run_in_threadpool``（见 chat SSE 端点）。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)

# backend/ 目录（app/db/session.py -> app/db -> app -> backend）
BACKEND_ROOT = Path(__file__).resolve().parents[2]

# sqlite:///xxx 或 sqlite+pysqlite:///xxx
_SQLITE_PREFIX_RE = re.compile(r"^(sqlite(?:\+\w+)?:///)(.*)$", re.IGNORECASE)


def normalize_database_url(url: str) -> Tuple[str, Optional[Path]]:
    """归一化 ``DATABASE_URL``，返回 ``(最终 URL, SQLite 文件绝对路径或 None)``。

    SQLite 的相对路径按 **backend/** 解析（不是进程 CWD），并确保父目录存在。
    绝对路径（``sqlite:////data/app.db``）与内存库（``:memory:``）原样返回。
    """
    match = _SQLITE_PREFIX_RE.match(url.strip())
    if not match:
        return url, None

    prefix, raw_path = match.group(1), match.group(2)
    if not raw_path or raw_path == ":memory:":
        # 内存库：sqlite:// 或 sqlite:///:memory:
        return url, None
    # Windows 下也可能是 sqlite:///C:/...（盘符绝对路径）
    if re.match(r"^[A-Za-z]:[\\/]", raw_path):
        return url, Path(raw_path)

    candidate = Path(raw_path)
    if candidate.is_absolute():
        return url, candidate

    absolute = (BACKEND_ROOT / candidate).resolve()
    absolute.parent.mkdir(parents=True, exist_ok=True)
    # SQLAlchemy 的 sqlite URL 用 POSIX 风格路径最稳（Windows 也认 D:/a/b.db）
    return f"{prefix}{absolute.as_posix()}", absolute


def _register_sqlite_foreign_keys_pragma() -> None:
    """SQLite 必须显式打开外键强制（**每个连接都要设，不能只设一次**）。

    实测背景：SQLite 默认 **不** 强制外键。表现是往 ``daily_answers`` 插一条
    ``question_id`` 指向不存在的题目的记录会**成功**（HTTP 200），于是
    "外键约束"变成纯装饰，库里的孤儿数据再也回不来。
    正确做法是监听 ``Engine`` 的 ``connect`` 事件，在每条新连接上执行
    ``PRAGMA foreign_keys=ON`` —— 连接池每次新建连接都会触发，
    这也是唯一能保证"所有连接都生效"的位置。

    PostgreSQL 天生强制外键，不需要这段。（``event.listens_for(Engine, "connect")``
    是类级监听，对之后创建的所有引擎都生效。）
    """
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    @event.listens_for(Engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ANN001
        # 仅对 sqlite3 连接生效（其它方言的连接对象没有 cursor 语义差异，但没必要碰）
        if type(dbapi_connection).__module__.split(".")[0] != "sqlite3":
            return
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


def _build_engine_kwargs() -> Dict[str, Any]:
    """按方言拼引擎参数。"""
    # echo 由 DB_ECHO 单独控制（默认关）：DEBUG 下也不要把每条 SQL 都打出来刷屏
    kwargs: Dict[str, Any] = {"echo": bool(settings.DB_ECHO)}

    if settings.is_sqlite:
        if settings.is_in_memory_sqlite:
            # 内存库：必须 StaticPool，否则不同连接看到各自的空库
            kwargs["poolclass"] = StaticPool
        else:
            # 文件库：pre_ping 便宜，能躲开"库文件被替换/删掉"的偶发问题
            kwargs["pool_pre_ping"] = True
        if settings.SQLITE_CHECK_SAME_THREAD_FALSE:
            # FastAPI 线程池 + SSE 生成器复用连接，必须关掉同线程检查
            kwargs["connect_args"] = {"check_same_thread": False}
        return kwargs

    # PostgreSQL（或其它服务型数据库）
    kwargs["pool_pre_ping"] = True
    return kwargs


def _create_engine_for(url: str) -> Engine:
    normalized, sqlite_path = normalize_database_url(url)
    if sqlite_path is not None:
        logger.info("数据库：SQLite 文件 %s", sqlite_path)
    elif settings.is_sqlite:
        logger.info("数据库：SQLite（内存库，进程结束即清空）")
    else:
        logger.info("数据库：%s", normalized.split("@")[-1] if "@" in normalized else normalized)
    return create_engine(normalized, **_build_engine_kwargs())


# 先注册外部键 PRAGMA，再建引擎：监听的是 Engine 类的 connect 事件，
# 放在前面可以保证"这个模块里创建的任何引擎、任何时点的连接"都生效。
if settings.is_sqlite:
    _register_sqlite_foreign_keys_pragma()

engine: Engine = _create_engine_for(settings.DATABASE_URL)

if settings.is_sqlite:
    logger.info("SQLite 已启用外键强制（PRAGMA foreign_keys=ON，逐连接生效）")


def SessionLocal() -> Session:
    """**唯一的会话工厂**：``db = SessionLocal()`` / ``with SessionLocal() as db:``。

    ⚠️ 为什么是函数而不是模块级 ``sessionmaker(bind=engine)``：
    ``init_engine()`` 会**重建全局 engine**，模块级的 ``sessionmaker`` 会把旧引擎
    焊死在里面，换过引擎之后所有会话都指向废弃引擎（测试/迁移时特别容易踩）。
    写成函数就每次调用时现取 ``engine``，永远拿到当前那个。

    使用约定：
    - FastAPI 路由用依赖注入的 ``app.core.deps.get_db``（它内部就是这个工厂）；
    - 请求生命周期之外（APScheduler 定时任务、脚本、SSE 生成器）自己开：
      ``with SessionLocal() as session: ...`` 或 ``session = SessionLocal()`` 后
      在 ``finally`` 里 ``close()``。
    """
    return Session(engine)


def init_engine(database_url: Optional[str] = None) -> Engine:
    """按需重建引擎（迁移脚本/测试/SQLite 试跑用）。"""
    global engine
    engine = _create_engine_for(database_url or settings.DATABASE_URL)
    return engine


def create_all() -> None:
    """直接建表（**联调最省事的路径**，不依赖 Alembic）。

    幂等：已存在的表不会重复创建，所以可以反复执行。

    使用场景（README §2.1 / §4.13）：
    - 本地 SQLite 联调：``python -m app.db.init_db``（内部就调它）
    - 生产 PostgreSQL：**请用 Alembic**（``alembic upgrade head``）——
      ``create_all`` 不记录迁移版本，以后想改成 Alembic 管理会很难。
    """
    # 触发全部模型注册（必须在 create_all 之前 import，否则元数据里没有表）
    import app.models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    logger.info(
        "建表完成，共 %s 张表：%s",
        len(SQLModel.metadata.tables),
        ", ".join(sorted(SQLModel.metadata.tables)),
    )


def drop_all() -> None:
    """删表（**危险**，仅本地试跑/测试用；文件库上会丢数据）。"""
    import app.models  # noqa: F401

    SQLModel.metadata.drop_all(engine)
    logger.warning("已删除全部表（drop_all）")


def describe_database() -> str:
    """给启动日志/CLI 用的一句话描述（不打印密码，14.6）。"""
    if settings.is_sqlite:
        _, path = normalize_database_url(settings.DATABASE_URL)
        return f"SQLite @ {path}" if path else "SQLite @ :memory:"
    url = settings.DATABASE_URL
    return url.split("@")[-1] if "@" in url else url
