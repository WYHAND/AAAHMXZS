# -*- coding: utf-8 -*-
"""一次性表结构迁移：物理删除 `conversations.followup_direction` / `followup_round` 两列。

## 为什么需要它
手册 7.7 原来有一条「同一方向追问 ≤3 轮就换维度」的规则，实现方式是在 `conversations`
上挂两列会话级计数器（`followup_direction` 当前挖掘维度 + `followup_round` 已追问轮数）。
用户已明确要求删掉这套东西（"可以把之前确认的三次换个目标继续挖的代码删掉了，
要保证代码都是有用的"），于是服务端计数逻辑、Prompt 硬约束、SSE 字段、模型列、schema
字段都已一并删除。

⚠️ 但**改模型文件不会动真实库**：`init_db` 走的是 `SQLModel.metadata.create_all`，
它只建"不存在的表"，**绝不会给已存在的表加列/删列**（`migrations/versions/` 是空的，
没有 Alembic 版本可用）。所以真实库里那两列会一直留着 —— 那就是"代码里没人用、
库里还占着"的死列，正是用户说的"没用的代码/结构"。本脚本负责把它真正删掉。

## 安全边界（顺序是刻意的，不可调换）
1. **默认 dry-run**：不加 `--apply` 只跑 `PRAGMA table_info` + 行数统计，一个字节都不写；
2. **`--apply` 先备份，再改结构**：备份用 sqlite3 官方的 **backup API**
   （`sqlite3.Connection.backup`，在线一致快照），**不是直接复制文件** ——
   文件级 copy 在"用户自己的 8000 端口服务正在写库"时可能拷到半截页，得到损坏的副本。
   备份落在 `backend/data/backups/<库文件名>.<时间戳>.bak`，路径会打印出来；
3. **`PRAGMA table_info` 先确认列存在**：列名或表名对不上就报错退出，不乱改；
4. 改结构前 `PRAGMA foreign_keys=OFF`、改完 `PRAGMA foreign_key_check` 复核：
   SQLite 的 `DROP COLUMN` 是"重建表 + 拷数据 + 换名"，在开着外键强制时做表重建，
   官方推荐的做法就是先关外键、做完再查一致性（本脚本按官方顺序来）。
   注意 `PRAGMA foreign_keys` 在事务内是空操作，所以连接用 `isolation_level=None`
   手动控制事务，保证 PRAGMA 在 BEGIN 之前生效；
5. 改完 `PRAGMA integrity_check` + 行数复核 + 再打一次 `PRAGMA table_info`，
   证明"列没了、数据一行没少"。

## SQLite 版本要求
`ALTER TABLE ... DROP COLUMN` 需要 **SQLite ≥ 3.35**。本脚本启动时先检查
`sqlite3.sqlite_version`，低于 3.35 直接报错退出（不会退化成"悄悄重建表"）。
实测本项目：Python 3.12.10 自带 sqlite lib **3.49.1**，满足。

## 用法
::

    cd backend
    $env:PYTHONIOENCODING="utf-8"

    # 1) dry-run（默认）：打印将执行的 ALTER 与当前行数，不写库
    .\\venv\\Scripts\\python.exe scripts\\drop_followup_columns.py

    # 2) 备份 + 真删列（确认 dry-run 输出后）
    .\\venv\\Scripts\\python.exe scripts\\drop_followup_columns.py --apply

    # 3) 指定库文件（默认取 settings.DATABASE_URL，即 data/app.db）
    .\\venv\\Scripts\\python.exe scripts\\drop_followup_columns.py --apply --db data\\app.db

## 只删这两列，别的一律不碰
脚本里**写死**表名与列名，不提供"删任意列"的参数：这是一次性迁移，不是通用工具。
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

# 本脚本在 backend/scripts/ 下，直接跑时 sys.path[0] 是 scripts/，`from app...` 会 ImportError。
# 先把 backend/ 塞进 sys.path —— 这是唯一的目的（必须在 import app.* 之前）。
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
from app.db.session import describe_database, normalize_database_url  # noqa: E402

# ---------------------------------------------------------------------------
# 本次迁移的目标（**写死**，不接受命令行传入）
# ---------------------------------------------------------------------------
TABLE_NAME = "conversations"
DROP_COLUMNS: Tuple[str, ...] = ("followup_direction", "followup_round")

# `ALTER TABLE ... DROP COLUMN` 的最低 SQLite 版本（3.35.0，2021-03-12 发布）
MIN_SQLITE_VERSION = (3, 35, 0)

# 备份目录（与项目既有备份一致：backend/data/backups/）
BACKUP_DIR_NAME = "backups"

_RULE_LINE = "=" * 78
_THIN_LINE = "-" * 78


class MigrationError(RuntimeError):
    """迁移无法安全进行（库不是 SQLite / 版本太低 / 目标列不存在 / 备份失败）。"""


def resolve_db_path(explicit: Optional[str]) -> Path:
    """定位要迁移的 SQLite 文件。

    默认走 ``settings.DATABASE_URL`` 的归一化结果（相对路径按 backend/ 解析，
    与 ``app/db/session.py`` 完全同一套口径，避免"脚本改了另一个库"）。
    """
    if explicit:
        candidate = Path(explicit)
        if not candidate.is_absolute():
            candidate = (BACKEND_ROOT / candidate).resolve()
        return candidate

    if not settings.is_sqlite:
        raise MigrationError(
            f"当前 DATABASE_URL 不是 SQLite（{describe_database()}）。"
            "本脚本只做 SQLite 的 ALTER TABLE；PostgreSQL 请手工执行 "
            "ALTER TABLE conversations DROP COLUMN followup_direction, DROP COLUMN followup_round;"
        )
    _, path = normalize_database_url(settings.DATABASE_URL)
    if path is None:
        raise MigrationError(
            "DATABASE_URL 指向内存库（:memory:），没有可迁移的文件。"
            "请用 --db 指定真实的 .db 文件。"
        )
    return Path(path)


def check_sqlite_version() -> str:
    """低于 3.35 直接拒绝：不提供"退化成重建表"的降级路径。"""
    raw = sqlite3.sqlite_version
    parts = tuple(int(piece) for piece in raw.split(".")[:3])
    if parts < MIN_SQLITE_VERSION:
        raise MigrationError(
            f"SQLite 版本过低：{raw} < "
            f"{'.'.join(str(p) for p in MIN_SQLITE_VERSION)}，不支持 ALTER TABLE ... DROP COLUMN。"
        )
    return raw


def table_columns(conn: sqlite3.Connection, table: str) -> List[Tuple[str, str, bool, Optional[str]]]:
    """``PRAGMA table_info``：返回 ``[(列名, 类型, NOT NULL, 默认值)]``。"""
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [(row[1], row[2], bool(row[3]), row[4]) for row in rows]


def existing_tables(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    return [row[0] for row in rows]


def row_count(conn: sqlite3.Connection, table: str) -> int:
    return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def column_value_stats(conn: sqlite3.Connection, table: str, column: str) -> Dict[str, int]:
    """删列前统计"这一列里到底存了什么"，作为丢失内容的可核对证据。

    只做 COUNT / DISTINCT 的只读查询，不改变任何数据。
    """
    total = row_count(conn, table)
    non_null = int(
        conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {column} IS NOT NULL").fetchone()[0]
    )
    distinct = int(
        conn.execute(f"SELECT COUNT(DISTINCT {column}) FROM {table}").fetchone()[0]
    )
    return {"总行数": total, "非空行数": non_null, "不同取值数": distinct}


def make_backup(db_path: Path) -> Path:
    """用 sqlite3 的 backup API 做一份在线一致快照，返回备份文件路径。

    为什么不用 ``shutil.copy``：用户自己的 8000 端口服务**正在**写这个库，
    文件级复制可能拷到写了一半的页（得到损坏副本）；backup API 在 SQLite 层面
    对源库加锁并逐页拷贝，拿到的一定是某个一致时点的完整库。
    """
    backup_dir = db_path.parent / BACKUP_DIR_NAME
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = backup_dir / f"{db_path.name}.{stamp}.bak"
    if target.exists():  # 同一秒内跑两次时不要互相覆盖
        target = backup_dir / f"{db_path.name}.{stamp}-{datetime.now().microsecond:06d}.bak"

    source = sqlite3.connect(str(db_path))
    try:
        destination = sqlite3.connect(str(target))
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
    if not target.exists() or target.stat().st_size == 0:
        raise MigrationError(f"备份失败：{target} 不存在或为空，已中止（未改动原库）。")
    return target


def plan_statements() -> List[str]:
    return [f"ALTER TABLE {TABLE_NAME} DROP COLUMN {column};" for column in DROP_COLUMNS]


def run_migration(db_path: Path, *, apply: bool) -> int:
    sqlite_version = check_sqlite_version()

    if not db_path.exists():
        print(f"[错误] 库文件不存在：{db_path}")
        return 2

    # isolation_level=None：手动控制事务，才能保证 PRAGMA foreign_keys 在 BEGIN 之前生效
    conn = sqlite3.connect(str(db_path), isolation_level=None)
    try:
        print(_RULE_LINE)
        print(f"删除 {TABLE_NAME} 上的追问计数器列 —— 模式：{'**落库 --apply**' if apply else 'DRY-RUN（默认，不写库）'}")
        print(_RULE_LINE)
        print(f"  数据库：{describe_database()}")
        print(f"  文件：  {db_path}")
        print(f"  SQLite：{sqlite_version}（DROP COLUMN 需要 ≥ 3.35，满足）")
        print(flush=True)

        # ---- ① 存在性检查（列/表对不上就退出，不乱改）----
        tables = existing_tables(conn)
        if TABLE_NAME not in tables:
            raise MigrationError(f"表 {TABLE_NAME!r} 不存在，库里的表：{', '.join(tables)}")
        columns = table_columns(conn, TABLE_NAME)
        names = [name for name, _, _, _ in columns]
        present = [column for column in DROP_COLUMNS if column in names]
        missing = [column for column in DROP_COLUMNS if column not in names]

        print(_THIN_LINE)
        print(f"【一】改前 PRAGMA table_info({TABLE_NAME})（{len(columns)} 列）")
        print(_THIN_LINE)
        for name, type_, not_null, default in columns:
            mark = "  <- 本次要删除" if name in present else ""
            print(f"  {name:<20} {type_:<12} NOT NULL={str(not_null):<5} default={default}{mark}")
        print(flush=True)

        if not present:
            print(_THIN_LINE)
            print("【二】结论：两列都不存在 —— 迁移已经做过了（幂等），本次无操作。")
            print(_THIN_LINE)
            print(f"  缺失列：{'、'.join(missing)}")
            print("  原库未被改动，也没有做备份（没有任何写操作）。")
            return 0

        # ---- ② 丢失内容证据（这一列里原本存了什么）----
        print(_THIN_LINE)
        print("【二】将被删除的列里现存的内容（只读统计，作为丢失内容的凭证）")
        print(_THIN_LINE)
        for column in present:
            stats = column_value_stats(conn, TABLE_NAME, column)
            print(
                f"  {column}: 总行数={stats['总行数']} 非空={stats['非空行数']} "
                f"不同取值={stats['不同取值数']}"
            )
        print(flush=True)

        print(_THIN_LINE)
        print("【三】将执行的语句")
        print(_THIN_LINE)
        for statement in plan_statements():
            print(f"  {statement}")
        print(f"  目标表 {TABLE_NAME} 现有 {row_count(conn, TABLE_NAME)} 行（改后必须一行不少）")
        print(flush=True)

        if not apply:
            print(_THIN_LINE)
            print("DRY-RUN：**没有写入任何字节，也没有做备份**（备份只在 --apply 时发生）。")
            print("确认上面的列与统计符合预期后，再加 --apply 落库。")
            print(_THIN_LINE)
            return 0

        # ---- ③ 备份（必须在任何写操作之前）----
        backup_path = make_backup(db_path)
        print(_THIN_LINE)
        print("【四】已备份（sqlite3 backup API，在线一致快照）")
        print(_THIN_LINE)
        print(f"  {backup_path}")
        print(f"  大小：{backup_path.stat().st_size} 字节")
        print(flush=True)

        before_rows = row_count(conn, TABLE_NAME)

        # ---- ④ 改结构（关外键 -> BEGIN -> ALTER... -> COMMIT -> 查外键）----
        print(_THIN_LINE)
        print("【五】执行 ALTER TABLE ... DROP COLUMN")
        print(_THIN_LINE)
        conn.execute("PRAGMA foreign_keys=OFF")
        try:
            conn.execute("BEGIN")
            for statement in plan_statements():
                conn.execute(statement)
            conn.execute("COMMIT")
            print(f"  已执行 {len(present)} 条 ALTER，事务已 COMMIT")
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.OperationalError:
                pass  # 事务可能根本没开起来（例如第一条 ALTER 就语法错误），忽略
            print("  [失败] ALTER 出错，已 ROLLBACK；原库结构与数据未改动。")
            print(f"  备份仍在：{backup_path}")
            raise
        finally:
            conn.execute("PRAGMA foreign_keys=ON")

        # ---- ⑤ 复核 ----
        print(flush=True)
        print(_THIN_LINE)
        print("【六】改后校验")
        print(_THIN_LINE)
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        print(f"  PRAGMA integrity_check      : {integrity}")

        fk_rows = conn.execute("PRAGMA foreign_key_check").fetchall()
        print(f"  PRAGMA foreign_key_check    : {'无违规行' if not fk_rows else f'{len(fk_rows)} 行违规 {fk_rows[:5]}'}")

        after_columns = table_columns(conn, TABLE_NAME)
        after_names = [name for name, _, _, _ in after_columns]
        still_there = [column for column in DROP_COLUMNS if column in after_names]
        print(f"  改后列（{len(after_names)} 列）：{'、'.join(after_names)}")
        print(f"  目标列是否仍在          : {'❌ 仍在：' + '、'.join(still_there) if still_there else '✅ 已全部删除'}")

        after_rows = row_count(conn, TABLE_NAME)
        print(f"  {TABLE_NAME} 行数            : {before_rows} -> {after_rows} {'✅ 一致' if before_rows == after_rows else '❌ 不一致！'}")

        messages_rows = row_count(conn, "messages")
        users_rows = row_count(conn, "users")
        print(f"  messages 行数（未触碰）      : {messages_rows}")
        print(f"  users 行数（未触碰）         : {users_rows}")

        ok = not still_there and integrity == "ok" and not fk_rows and before_rows == after_rows

        print(flush=True)
        print(_THIN_LINE)
        print(f"【七】结论：{'✅ 迁移成功，两列已从真实库物理删除' if ok else '❌ 校验未通过，请用上面的备份恢复并排查'}")
        print(f"  备份路径（恢复用）：{backup_path}")
        print(_THIN_LINE)
        return 0 if ok else 1
    finally:
        conn.close()


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(
        description=f"删除 {TABLE_NAME} 的追问计数器列（默认 dry-run，--apply 才写库）"
    )
    parser.add_argument("--apply", action="store_true", help="备份 + 真正执行 ALTER（默认只打印）")
    parser.add_argument("--db", default=None, help="SQLite 文件路径，默认取 settings.DATABASE_URL")
    args = parser.parse_args(argv)

    try:
        db_path = resolve_db_path(args.db)
        return run_migration(db_path, apply=args.apply)
    except MigrationError as exc:
        print(f"[错误] {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
