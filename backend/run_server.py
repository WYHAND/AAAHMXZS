"""桌面端（Electron）打包后的**后端启动入口**。

为什么需要这个文件（而不是直接 uvicorn 起 ``app.main:app``）：

1. **必须先建表 + 灌种子**。``app/main.py`` 的 lifespan 刻意**不做隐式 DDL**
   （见 main.py 里那段注释：隐式建表会让人不知道库结构是谁改的），表不存在时
   只在日志里警告"请先执行 ``python -m app.db.init_db``"。
   换到一台新机器上，如果没人先跑 init_db，**所有接口都会死在 ``no such table: users``**。
   所以打包入口把 ``init_db(create_tables=True) + seed_all()`` 放在起 uvicorn 之前 ——
   两者都是**幂等**的（表已存在就跳过、种子按 code/name 判重），第二次启动不会重复插数据。
   ⚠️ ``init_db()`` 的 ``create_tables`` **默认是 False**（给 CLI 用的默认值），必须显式传 True。
2. **必须是 `from app.main import app` 这种「直接导入」，不能用 `uvicorn.run("app.main:app")` 字符串**：
   PyInstaller 靠**静态分析**收集依赖，字符串动态导入它看不见 —— 结果就是打出来的包
   没有 fastapi，启动直接 ``ModuleNotFoundError: No module named 'fastapi'``。
   直接导入还顺带解决了建表时机：导入 app 会把所有 model 注册进
   ``SQLModel.metadata``，之后的 ``create_all()`` 才知道要建哪些表。
3. 打包后没有 ``python -m`` 这种调用方式，需要一个明确的入口脚本给 PyInstaller。

⚠️ ``.env`` 是 **cwd 相对**读的（勘误 9.14）：Electron 主进程 spawn 本程序时
必须把 ``cwd`` 设成这个文件所在目录，否则读不到 ``DEEPSEEK_API_KEY``，AI 全线走兜底。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import uvicorn


def _pin_runtime_paths() -> None:
    """打包后把 **SQLite 数据文件钉在 exe 同级**（而不是 PyInstaller 的 ``_internal`` 里）。

    为什么要钉：``app/db/session.py`` 的相对路径是**按代码文件位置**解析的
    （``BACKEND_ROOT = Path(__file__).resolve().parents[2]``）。冻结后 ``session.py``
    位于 ``_internal/app/db/``，于是 ``sqlite:///./data/app.db`` 会落到
    ``_internal/data/app.db`` —— 能用，但**藏在运行时目录里**：用户找不到、备份不知道拷哪个、
    重打一次包（PyInstaller 会重建 ``_internal``）数据就没了。

    钉到 ``<exe 同级>/data/app.db`` 后：位置直观、整包拷走数据跟着走。
    ⚠️ 必须在 ``import app`` **之前**执行：``app.core.config`` 在导入时就会实例化
    ``Settings()``，之后再设环境变量就晚了。
    """
    if not getattr(sys, "frozen", False):
        return  # 开发模式保持原样（backend/data/app.db）
    exe_dir = Path(sys.executable).resolve().parent
    data_dir = exe_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    absolute = f"sqlite:///{(data_dir / 'app.db').as_posix()}"
    os.environ.setdefault("DATABASE_URL", absolute)
    print(f"[run_server] 数据文件：{data_dir / 'app.db'}", flush=True)


_pin_runtime_paths()

# ⚠️ 顺序要求：先导入 app（把整条依赖链与所有 model 暴露给 PyInstaller），再建表
from app.main import app  # noqa: E402


def _prepare_database() -> None:
    """建表 + 灌种子（幂等）。失败不阻止启动：接口会自己报错，日志能查到原因。"""
    try:
        from app.db.init_db import init_db, seed_all

        init_db(create_tables=True)
        seed_all()
        print("[run_server] 数据库就绪（建表 + 种子完成）", flush=True)
    except Exception as exc:  # noqa: BLE001 - 打包首启失败也要给出可读原因
        print(f"[run_server] 数据库初始化失败（服务仍会启动）：{exc}", flush=True)


def main() -> None:
    _prepare_database()

    # 127.0.0.1：只监听本机，桌面端不需要对外暴露
    port = int(os.getenv("APP_PORT", "8000"))
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level=os.getenv("APP_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
