# -*- coding: utf-8 -*-
"""一次性迁移：给 `profiles` 补两列 `ai_summary` / `ai_summary_key`（勘误 9.24.5）。

## 为什么需要它
「我的画像」卡片顶部那句"你是个什么样的人"要**落库缓存**（理由见 9.24.5 第 2 条：
镜子必须稳定 + 不能每次打开都调模型），所以要给 `profiles` 加两列。

⚠️ 但**改模型文件不会动真实库**：`init_db` 走 `SQLModel.metadata.create_all`，
它只建"不存在的表"，**绝不会给已存在的表加列**。

## 但这次和上次（`drop_followup_columns.py`）不一样
上次删列只能靠一次性脚本；这次只是 **ADD COLUMN**，所以**主路径已经内置在
`init_db.ensure_columns()`**：开发库和打包后的 exe（`run_server.py` 会调
`init_db(create_tables=True)`）都会**自愈**，不需要谁记得跑脚本。

本脚本因此退化成"**审计 + 手动兜底**"：想在不启动服务的前提下单独确认/补列时用它。
两条路径共用同一个 `ensure_columns()`，不会出现"脚本补的列和服务补的列不一样"。

## 安全边界
1. **默认 dry-run**：只打印 `PRAGMA table_info(profiles)` 与"将会执行的 ADD COLUMN"，
   一个字节都不写；
2. `--apply` 才真改，且**只做 ADD COLUMN**（可空、无默认值）：不动任何已有列与数据；
3. 列已存在就跳过（幂等，可反复跑）；
4. 改完再打一次 `PRAGMA table_info` + 行数，证明"列加上了、数据一行没少"。

## 用法
::

    cd backend
    $env:PYTHONIOENCODING="utf-8"

    # 1) dry-run（默认）
    .\\venv\\Scripts\\python.exe scripts\\add_profile_summary_columns.py

    # 2) 真加列
    .\\venv\\Scripts\\python.exe scripts\\add_profile_summary_columns.py --apply
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional, Sequence

# 本脚本在 backend/scripts/ 下，直接跑时 sys.path[0] 是 scripts/，`from app...` 会 ImportError。
# 先把 backend/ 塞进 sys.path —— 这是唯一的目的（必须在 import app.* 之前）。
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
from app.db.session import describe_database, normalize_database_url  # noqa: E402

# 目标表（**写死**，不是通用工具；真值来源是 app/db/init_db.py::ADDED_COLUMNS）
TABLE_NAME = "profiles"

_RULE_LINE = "=" * 78
_THIN_LINE = "-" * 78


def _resolve_db_path(explicit: Optional[str]) -> Optional[Path]:
    """定位 SQLite 文件（与 session.py 同一套归一化口径，避免"脚本改了另一个库"）。"""
    if explicit:
        candidate = Path(explicit)
        if not candidate.is_absolute():
            candidate = (BACKEND_ROOT / candidate).resolve()
        return candidate
    if not settings.is_sqlite:
        return None
    _, path = normalize_database_url(settings.DATABASE_URL)
    return path


def _existing_columns(db_path: Path) -> List[str]:
    import sqlite3

    connection = sqlite3.connect(db_path)
    try:
        rows = connection.execute(f"PRAGMA table_info({TABLE_NAME})").fetchall()
    finally:
        connection.close()
    return [row[1] for row in rows]


def _row_count(db_path: Path) -> int:
    import sqlite3

    connection = sqlite3.connect(db_path)
    try:
        return int(connection.execute(f"SELECT COUNT(*) FROM {TABLE_NAME}").fetchone()[0])
    finally:
        connection.close()


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="给 profiles 补 ai_summary / ai_summary_key 两列（勘误 9.24.5）")
    parser.add_argument("--apply", action="store_true", help="真的执行 ADD COLUMN（默认只 dry-run）")
    parser.add_argument("--db", default=None, help="指定库文件；默认取 settings.DATABASE_URL")
    args = parser.parse_args(argv)

    print(_RULE_LINE)
    print("profiles 补列：ai_summary / ai_summary_key（勘误 9.24.5）")
    print(_RULE_LINE)
    print(f"目标数据库：{describe_database()}")

    db_path = _resolve_db_path(args.db)
    if db_path is None:
        print("✗ 这不是 SQLite 库：本脚本只处理 SQLite。"
              "PostgreSQL 请走 alembic（本脚本不代劳）。")
        return 2
    if not db_path.exists():
        print(f"✗ 库文件不存在：{db_path}（先跑 python -m app.db.init_db 建库）")
        return 2

    before = _existing_columns(db_path)
    print(f"库文件：{db_path}")
    print(f"当前列（{len(before)}）：{', '.join(before)}")

    from app.db.init_db import ADDED_COLUMNS  # 真值来源，不在这里写第二份

    wanted = [name for name, _ in ADDED_COLUMNS.get(TABLE_NAME, ())]
    missing = [name for name in wanted if name not in before]
    print(f"缺失列：{missing or '（无，已是最新）'}")
    print(_THIN_LINE)

    if not missing:
        print("✓ 无需迁移。")
        return 0

    if not args.apply:
        for name in missing:
            print(f"[dry-run] ALTER TABLE {TABLE_NAME} ADD COLUMN {name} TEXT")
        print(_THIN_LINE)
        print("dry-run 结束，未写库。确认后加 --apply 执行。")
        return 0

    rows_before = _row_count(db_path)

    # 复用 init_db 的同一实现（与开发/打包两条路径共用，避免两份 DDL 分叉）
    from app.db.init_db import ensure_columns

    ensure_columns()

    after = _existing_columns(db_path)
    rows_after = _row_count(db_path)
    print(f"迁移后列（{len(after)}）：{', '.join(after)}")
    print(f"行数：{rows_before} -> {rows_after}（应当相同）")
    ok = all(name in after for name in wanted) and rows_before == rows_after
    print(_RULE_LINE)
    print("✓ 迁移完成，数据一行未动。" if ok else "✗ 复核未通过，请检查上面的输出。")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
