"""一次性数据清理脚本：清掉开发期在**真实库**里留下的探针/测试账号（跑完可留档，不必删）。

## 为什么需要它
开发过程中各类验证（后端接口冒烟、前端 Playwright 渲染检查、AI 开场白验收……）都是
**对着真实开发库**跑的，于是造出了一批 agent 自己的探针账号（``diag_1517f5ca``、
``opening_tags_67800f``、``smoke_e6f8cd`` …）。这些账号不是产品数据，留在库里会：
污染「用户数 / 会话数」统计、干扰画像与提示词的回归对比、让人分不清哪条数据是真人产生的。

⚠️ 但**用户的真实账号绝对不能删**：``wyh`` / ``admin`` 名下挂着真人打卡记录
（"花了多久：两天 / 卡在哪：吴"、"进度：做完了 · 感受：顺利"），``admin`` 名下的任务
还是用**最新提示词**生成的合规样本。所以本脚本的第一原则是：
**宁可少删，绝不多删** —— 判不准的一律进「需人工决定」，默认不删。

## 判定规则（保守、可解释、全部打印依据）
1. **白名单（硬编码在文件最前面，永不删）**：``wyh`` / ``admin``。
   写死而不是靠规则推断：这两个名字看起来最像测试号（``admin`` 像种子账号、``wyh`` 无后缀），
   但它们是用户本人在浏览器里登录的账号。任何"名字像测试号"的自动规则都会误伤它们，
   所以直接在入口处短路。
2. **探针模式（确证信号 ①）**：用户名形如 ``前缀_6~8位十六进制``（agent 建号用
   ``secrets.token_hex(3|4)`` 收尾，实测早期 8 位、后期 6 位两种都有），或 ``u<数字>[_hex]``。
   实测这类前缀有 ``indep_ / recheck_ / ai_ / diag_ / sse / del_a_ / del_b_ / fin_ / finb_ /
   rep_ / opening_*_ / probe / probe2 / probe3 / smoke_``。
3. **真实痕迹（确证信号 ②，一票否决自动删除）**：命中探针模式**且**毫无真人痕迹，才算确证。
   三条痕迹规则（任一命中即进「需人工决定」）：
   - ``T1`` 有「已完成」状态的任务（探针只造"进行中"的任务，不会真去完成）；
   - ``T2`` 有**非模板**打卡反馈（探针脚本写的是"做完了"这类短句，真人反馈带
     "花了多久：/卡在哪："这类表单结构）；
   - ``T3`` 有简历/面试记录（只有真人会走上传简历、做面试这种重流程）。
4. **【需人工决定】（默认不删）**：命中探针模式但带真实痕迹的；或名字可疑但**没有**
   确证模式的（例如白名单账号 + 数字后缀的 ``wyh1``）。只列依据与关联行数，交人拍板。
5. 其余账号一律视为真实账号保留。
6. **人工提升（``--include-manual <账号>``，可重复，也收 UUID / 裸 32 位 hex）**：
   把用户**明确点名**的【需人工决定】账号提升为删除，语义是"我确认这个账号可以删"。
   两条硬边界：① 只对**已经列进【需人工决定】**的账号生效（不在这个桶里的会被拒绝）；
   ② 白名单（``wyh`` / ``admin``）**任何情况下都不能被它撬开** —— 传白名单直接报错并以
   退出码 2 结束，一个字节都不写。dry-run 的报告里会明确写出"该账号因 ``--include-manual``
   从人工桶提升为删除"，供人复核。
   （账号已被上一次 ``--apply`` 删掉时，会打印"未匹配到账号（可能已删除）"的警告而不是
   报错 —— 否则第二遍幂等复跑就没法用同一套参数了；**命中白名单仍然一律报错**。）
7. **显式删会话（``--delete-conversation <id>``，可重复，也收裸 32 位 hex）**：
   删掉点名的会话及其名下的 ``messages``（用途：清理真实账号里的空会话，例如 ``admin``
   的『新对话 2』—— 它只有一条开场白。单删那条消息没意义：前端对空会话会重新拉一条
   开场白，所以干净的清理是把整个空会话删掉）。
   安全闸：默认**拒绝**删除含 ``user`` 角色消息的会话（那可能是真实对话，误删不可逆），
   确实要删必须再加 ``--force``；**只删被点名的会话，其它会话一个字都不碰**
   （会话 id 找不到时同样按"可能已删除"警告处理，规则与上面 --include-manual 一致）。

## 删除顺序（不留孤儿行）
表清单**不写死**：运行时从 ``app/models`` 的 ``SQLModel.metadata`` 枚举全部表，
- 以「有 ``user_id`` 列的表」为根（``profiles`` / ``profile_tags`` / ``test_results`` /
  ``conversations`` / ``resumes`` / ``interviews`` / ``tasks`` / ``daily_answers`` /
  ``reports`` / ``user_badges`` / ``users``），
- 再沿外键找它们的子表（``messages`` ← ``conversations``、``task_steps`` ← ``tasks``、
  ``interview_questions`` ← ``interviews``），
- 按**逆拓扑序**（子表先于父表）显式 ``DELETE``：SQLite 的 ``ON DELETE CASCADE``
  本项目模型里根本没声明，指望级联必然留下孤儿行，显式删除才可靠。
- 题库类表（``badges`` / ``daily_questions`` / ``test_questions``）没有 ``user_id``、
  也不是任何用户表的子表，**不在删除范围内**。
- 是**硬删除**（``users`` 行本身也删），不是软删除 —— 落库前请自行备份 ``data/app.db``。

## 默认 dry-run
默认**一个字节都不写库**：dry-run 只跑 ``SELECT``，连 ``commit()`` 都不会被调用
（``Session`` 的只读事务最后显式 ``rollback()``）。必须显式 ``--apply`` 才会 DELETE + commit。
``--apply`` 落库后会自动做一次落库后校验（``PRAGMA integrity_check`` /
``PRAGMA foreign_key_check`` / 各表剩余行数 / 剩余 ``sys:opening`` 条数 / 保留账号完整性），
并复扫一遍作为幂等证据。

## 用法
::

    cd backend
    $env:PYTHONIOENCODING="utf-8"

    # 1) dry-run（默认）：打印判定依据 + 将删除的账号/行数，不写库
    .\\venv\\Scripts\\python.exe scripts\\cleanup_probe_data.py

    # 2) 只读报告：只看 sys:opening 开场白残留 + 判定摘要，同样不写库
    .\\venv\\Scripts\\python.exe scripts\\cleanup_probe_data.py --report

    # 3) 只看某个账号（username 或 UUID；白名单/需人工决定规则依然生效）
    .\\venv\\Scripts\\python.exe scripts\\cleanup_probe_data.py --user rep_c18c7bf1

    # 4) 真正落库（用户拍板后再跑）
    .\\venv\\Scripts\\python.exe scripts\\cleanup_probe_data.py --apply

    # 5) 人工提升【需人工决定】的账号 + 连空会话一起删（用户点名确认过的才写在这里）
    .\\venv\\Scripts\\python.exe scripts\\cleanup_probe_data.py ^
        --include-manual rep_c18c7bf1 --delete-conversation 3a1dd5f63cb243428203430edc71b962
    # 同上再加 --apply 才真的删

    # 6) 若另一个 agent 正在改 task_steps：本轮先别删它（会留下 N 行孤儿，见输出警告）
    .\\venv\\Scripts\\python.exe scripts\\cleanup_probe_data.py --apply --skip-task-steps

## 并发安全
库是 SQLite 且**同时可能有别的写入**（例如另一个 agent 在跑
``scripts/fix_legacy_task_steps.py`` 改 ``task_steps``）：撞到 ``database is locked``
会等 1.5s 重试，最多 3 次，仍失败就打印明确报错并以退出码 3 结束（不死循环）。
本脚本 dry-run 阶段对 ``task_steps`` **只 SELECT**。
"""

from __future__ import annotations

import argparse
import re
import sys
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID

# 本脚本在 backend/scripts/ 下，直接跑时 sys.path[0] 是 scripts/，`from app...` 会 ImportError。
# 先把 backend/ 塞进 sys.path —— 这是唯一的目的（必须在 import app.* 之前）。
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import Table, func, or_, text  # noqa: E402
from sqlalchemy import delete as sa_delete  # noqa: E402
from sqlalchemy import select as sa_select  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402
from sqlalchemy.sql.elements import ColumnElement  # noqa: E402
from sqlmodel import Session, SQLModel, select  # noqa: E402

import app.models  # noqa: E402,F401  <= 必须 import：否则 metadata 里没有表，枚举会漏表
from app.db.session import SessionLocal, describe_database  # noqa: E402
from app.models.conversation import Conversation, Message  # noqa: E402
from app.models.interview import Interview  # noqa: E402
from app.models.resume import Resume  # noqa: E402
from app.models.task import Task, TaskStep  # noqa: E402
from app.models.user import User  # noqa: E402
from app.utils.logger import configure_logging, get_logger  # noqa: E402

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# 〇、绝对不可删：用户自己的真实账号（**硬编码在最前面**）
# ---------------------------------------------------------------------------
# 这里刻意"写死"而不是靠规则推断：这两个名字表面上最像测试/种子账号，
# 但它们是用户本人在浏览器里登录的账号，名下挂着真人打卡与合规任务。
# 自动规则一旦把它们卷进来就是不可逆的数据事故，所以在入口处直接短路。
WHITELIST_USERNAMES: Tuple[str, ...] = ("wyh", "admin")

# 前端/AI 开场白功能写入的幂等 id（用于 --report 找"留在真实账号会话里的验证残留"）
OPENING_CLIENT_MSG_ID = "sys:opening"

# 任务的「已完成」状态（5.3 中文枚举）
TASK_STATUS_DONE = "已完成"

# 消息角色里的「用户消息」：删会话的安全闸就卡在这个角色上（有它 = 可能是真实对话）
MESSAGE_ROLE_USER = "user"

# ---------------------------------------------------------------------------
# 一、确证信号 ①：探针用户名模式
# ---------------------------------------------------------------------------
# 为什么用"前缀_6~8位十六进制"而不是"看起来像测试号"：
# agent 建号统一是 ``f"{prefix}_{secrets.token_hex(3)}"``（部分早期脚本用 token_hex(4)），
# 所以"随机十六进制尾巴"是**机器可判定的确定性特征**，而"名字里有 test/probe"只是猜测。
# 实测同时存在 8 位（2026-09-18 那批）与 6 位（2026-09-25 那批）后缀，两种都要认。
_HEX_SUFFIX = r"[0-9a-f]{6,8}"

PROBE_PATTERNS: Tuple[Tuple[str, re.Pattern[str], str], ...] = (
    (
        "hex_suffix",
        re.compile(rf"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_{_HEX_SUFFIX}$", re.IGNORECASE),
        "前缀_6~8位十六进制后缀（agent 批量建号以 token_hex 收尾，如 ai_92dd7d21、smoke_e6f8cd）",
    ),
    (
        "u_number",
        re.compile(rf"^u\d+(?:_{_HEX_SUFFIX})?$", re.IGNORECASE),
        "u<数字> 或 u<数字>_<hex>（冒烟脚本的临时账号 u1/u2/u3）",
    ),
)

# ---------------------------------------------------------------------------
# 二、疑似信号（只进「需人工决定」，**永不**据此自动删）
# ---------------------------------------------------------------------------
# 这些前缀是项目里探针脚本用过的名字，但**没有**十六进制尾巴，所以不构成确证：
# 万一有个真人用户真叫 ``test_user``，我们只把它列出来给人看，不自动删。
_SUSPECT_PREFIXES: Tuple[str, ...] = (
    "probe", "test", "tmp", "qa", "diag", "smoke", "check", "recheck", "sse",
    "fin", "finb", "del", "rep", "indep", "opening", "ai", "demo", "bench",
    "perf", "mock", "fake", "dummy", "temp",
)
_SUSPECT_PREFIX_RE = re.compile(
    rf"^(?:{'|'.join(_SUSPECT_PREFIXES)})(?:[_-]|\d|$)", re.IGNORECASE
)
# 白名单账号 + 数字/下划线后缀：实测有 ``wyh1``（在 wyh 之后 12 分钟注册，疑似冒烟注册），
# 但也可能是用户自己开的第二个账号 —— 所以只列进「需人工决定」。
_SUSPECT_WHITELIST_VARIANT_RE = re.compile(
    rf"^(?:{'|'.join(WHITELIST_USERNAMES)})(?:[_-]|\d)", re.IGNORECASE
)

# ---------------------------------------------------------------------------
# 三、确证信号 ②：真实痕迹（任一命中 → 不自动删）
# ---------------------------------------------------------------------------
# 探针脚本写打卡时会塞一句极短的模板话术；真人手写会带表单结构（"花了多久：/卡在哪："）
# 或"进度：… · 感受：…"。所以"非模板反馈"是很好的真人证据。
PROBE_CANNED_FEEDBACK = frozenset(
    {"做完了", "已完成", "完成", "打卡", "测试", "test", "ok", "好的", "done", "1", "是", "无"}
)

TRACE_RULES: Tuple[Tuple[str, str], ...] = (
    ("T1", f"有「{TASK_STATUS_DONE}」状态的任务（探针只造『进行中』的任务，不会真去完成）"),
    ("T2", "有非模板打卡反馈（模板短句之外的手写反馈，如『花了多久：…』『进度：…』）"),
    ("T3", "有简历或面试记录（只有真人会走上传简历/做面试这类重流程）"),
)

# 判定结果（三种，互斥）
DECISION_DELETE = "delete"
DECISION_MANUAL = "manual"
DECISION_KEEP = "keep"

# 数据库忙时的重试参数（不死循环：3 次之后报错退出）
LOCK_RETRY_ATTEMPTS = 3
LOCK_RETRY_DELAY_SECONDS = 1.5

# 打印宽度（与项目其它脚本一致）
_RULE_LINE = "=" * 78
_THIN_LINE = "-" * 78


class DatabaseBusy(RuntimeError):
    """``database is locked`` 重试 3 次仍失败：明确报错，不静默、不死循环。"""


class UserInputError(RuntimeError):
    """命令行参数指向了不允许的目标（例如用 ``--include-manual`` 撬白名单）。

    单独一种异常类型是为了让 main 能在**任何写操作之前**统一拦下并 exit 2：
    这类错误必须"整批拒绝"，不能删一半再报错。
    """


# ---------------------------------------------------------------------------
# 四、SQLite 并发：撞锁重试
# ---------------------------------------------------------------------------
def _is_locked_error(exc: BaseException) -> bool:
    """只对 ``database is locked`` 重试，其它数据库错误照原样抛出（不掩盖真 bug）。"""
    return isinstance(exc, OperationalError) and "database is locked" in str(exc).lower()


def _with_lock_retry(db: Session, what: str, action: Any) -> Any:
    """执行 ``action()``；撞到 SQLite 写锁就 rollback 后重试，最多 3 次。

    SQLite 同一时刻只允许一个写事务，而用户自己跑着 ``--reload`` 的后端、另一个 agent
    可能正在改 ``task_steps``。重试前必须 ``rollback()``：失败的事务会一直持有锁，
    不 rollback 的话下一次尝试必然还是 locked。
    """
    last_exc: Optional[BaseException] = None
    for attempt in range(1, LOCK_RETRY_ATTEMPTS + 1):
        try:
            return action()
        except OperationalError as exc:
            if not _is_locked_error(exc):
                raise
            last_exc = exc
            print(
                f"  [等待] {what}：database is locked"
                f"（第 {attempt}/{LOCK_RETRY_ATTEMPTS} 次），{LOCK_RETRY_DELAY_SECONDS}s 后重试 …",
                flush=True,
            )
            db.rollback()
            time.sleep(LOCK_RETRY_DELAY_SECONDS)
    raise DatabaseBusy(
        f"{what}：连续 {LOCK_RETRY_ATTEMPTS} 次撞到 database is locked。"
        "库正被别的进程写入（后端 / 另一个 agent 的脚本），请稍后重跑，本脚本不会继续死等。"
    ) from last_exc


# ---------------------------------------------------------------------------
# 五、删表图：从 models 枚举全部表，推出「子表先于父表」的删除顺序
# ---------------------------------------------------------------------------
def _all_tables() -> Dict[str, Table]:
    """``SQLModel.metadata`` 里的全部表（key = 表名）。

    为什么不写死表名：需求要求"自己枚举 models 下所有表"，将来新增一张带 ``user_id``
    的表（例如新的 ``notes``）时，本脚本必须自动跟上——写死会把新表变成孤儿。
    """
    return dict(SQLModel.metadata.tables)


def _deletion_order(tables: Dict[str, Table], affected: Set[str]) -> List[str]:
    """返回删除顺序（**子表在前，父表在后**）。

    做法：以"被影响的表"为根做 DFS，先把所有子表收进来，最后才 append 自己。
    SQLite 的外键没有 ``ON DELETE CASCADE``（本项目模型里压根没声明），
    父表先删就会留下再也删不掉的孤儿行，所以顺序必须显式算出来。
    """
    children: Dict[str, List[str]] = {}
    for name, table in tables.items():
        for fk in table.foreign_keys:
            parent = fk.column.table.name
            children.setdefault(parent, []).append(name)

    order: List[str] = []
    seen: Set[str] = set()

    def visit(name: str) -> None:
        if name in seen:
            return
        seen.add(name)
        for child in sorted(children.get(name, ())):
            visit(child)
        order.append(name)

    for name in sorted(affected):
        visit(name)
    return order


def _build_predicates(
    tables: Dict[str, Table], user_ids: Sequence[UUID]
) -> Dict[str, Optional[ColumnElement[bool]]]:
    """为每张表造出「属于这批用户的行」的 WHERE 条件；不在影响范围内的表返回 ``None``。

    - 有 ``user_id`` 列的：直接 ``user_id IN (...)``；
    - 子表（``messages`` / ``task_steps`` / ``interview_questions``）：用**子查询**
      ``fk IN (SELECT id FROM 父表 WHERE 父表自己的条件)``。
      用子查询而不是"先查 id 再 IN"是刻意的：并发写入时（另一个 agent 正在改库）
      id 快照会过期，子查询在 DELETE 的那一刻求值，**不会留下孤儿行**；
    - 题库类表（``badges`` / ``daily_questions`` / ``test_questions``）：既没有 ``user_id``
      也没有指向用户表的外键 → ``None``，永不进删除集。
    """
    memo: Dict[str, Optional[ColumnElement[bool]]] = {}
    visiting: Set[str] = set()

    def build(name: str) -> Optional[ColumnElement[bool]]:
        if name in memo:
            return memo[name]
        if name in visiting:  # 防御：外键成环时不做无限递归
            return None
        visiting.add(name)
        table = tables[name]

        parts: List[ColumnElement[bool]] = []
        if name == "users":
            parts.append(table.c.id.in_(list(user_ids)))
        elif "user_id" in table.c:
            parts.append(table.c.user_id.in_(list(user_ids)))

        for fk in table.foreign_keys:
            parent = fk.column.table.name
            if parent == "users":
                continue  # users 的条件已由 user_id 覆盖，重复加没有意义
            parent_predicate = build(parent)
            if parent_predicate is None:
                continue
            parts.append(
                fk.parent.in_(sa_select(tables[parent].c.id).where(parent_predicate))
            )

        visiting.discard(name)
        memo[name] = or_(*parts) if parts else None
        return memo[name]

    for table_name in tables:
        build(table_name)
    return memo


@dataclass
class DeletePlan:
    """一张清理计划：删除顺序 + 每张表的行数（先 SELECT COUNT(*) 算出来）。"""

    # [(表名, Table, 谓词, 将删除行数)]，顺序即删除顺序（子表在前）
    entries: List[Tuple[str, Table, ColumnElement[bool], int]] = field(default_factory=list)
    # 因 --skip-task-steps 被排除的表 -> 会留下的孤儿行数
    skipped: List[Tuple[str, int]] = field(default_factory=list)

    @property
    def total_rows(self) -> int:
        return sum(row_count for _, _, _, row_count in self.entries)

    @property
    def counts(self) -> Dict[str, int]:
        return {name: row_count for name, _, _, row_count in self.entries}


def _count_rows(db: Session, table: Table, predicate: ColumnElement[bool]) -> int:
    """显式 ``SELECT COUNT(*)``：需求要求"删除前先把每张表将删除的行数打印出来"。"""
    stmt = sa_select(func.count()).select_from(table).where(predicate)
    return int(db.execute(stmt).scalar_one())


def build_delete_plan(
    db: Session,
    user_ids: Sequence[UUID],
    *,
    skip_task_steps: bool = False,
) -> DeletePlan:
    """按 ``user_ids`` 造出完整删除计划（只跑 SELECT，不写库）。"""
    tables = _all_tables()
    predicates = _build_predicates(tables, user_ids)
    affected = {name for name, predicate in predicates.items() if predicate is not None}

    plan = DeletePlan()
    for name in _deletion_order(tables, affected):
        predicate = predicates.get(name)
        if predicate is None:
            continue
        row_count = _count_rows(db, tables[name], predicate)
        # task_steps 是「另一个 agent 正在并发改的表」：给出显式豁免开关。
        # 默认**不豁免**（否则 tasks 被删后这几行会变成永久孤儿）；
        # 只有在确实需要让路给并发脚本时才用 --skip-task-steps，并在输出里大声警告。
        if skip_task_steps and name == "task_steps":
            plan.skipped.append((name, row_count))
            continue
        plan.entries.append((name, tables[name], predicate, row_count))
    return plan


# ---------------------------------------------------------------------------
# 六、账号判定
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TraceHit:
    """一条"真实痕迹"证据。"""

    rule_id: str
    detail: str


@dataclass
class AccountVerdict:
    """一个账号的判定结果（含全部可解释依据）。"""

    user: User
    pattern_hits: List[str] = field(default_factory=list)   # 命中的确证模式说明
    suspect_hits: List[str] = field(default_factory=list)   # 命中的疑似启发式说明
    traces: List[TraceHit] = field(default_factory=list)    # 真实痕迹
    decision: str = DECISION_KEEP
    reason: str = ""
    counts: Dict[str, int] = field(default_factory=dict)    # 各表关联行数
    # 是否由 --include-manual 人工提升为删除（报告里要显式标出来，便于复核）
    promoted: bool = False

    @property
    def username(self) -> str:
        return self.user.username

    @property
    def created_at_text(self) -> str:
        created = self.user.created_at
        return created.strftime("%Y-%m-%d %H:%M:%S") if created else "(未知)"

    @property
    def counts_text(self) -> str:
        if not self.counts:
            return "（无任何关联行）"
        return "  ".join(f"{name}={count}" for name, count in self.counts.items())

    @property
    def evidence_text(self) -> str:
        """一行话说清"为什么删/为什么不删"。"""
        bits: List[str] = []
        if self.pattern_hits:
            bits.append("命中探针模式：" + "；".join(self.pattern_hits))
        if self.suspect_hits:
            bits.append("疑似探针：" + "；".join(self.suspect_hits))
        if self.traces:
            bits.append(
                "真实痕迹：" + "；".join(f"[{hit.rule_id}] {hit.detail}" for hit in self.traces)
            )
        if not bits:
            bits.append("未命中任何探针信号")
        return "；".join(bits)


def _preview(text: Optional[str], limit: int = 56) -> str:
    """把长文本压成一行预览（消息内容里有换行，直接打印会把报告撑乱）。"""
    if not text:
        return ""
    flat = re.sub(r"\s+", " ", text).strip()
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def _display_width(text: str) -> int:
    """字符串的**显示宽度**：中文/全角字符占 2 列。

    为什么不用 ``len()``：报告里要让中英文表头与数字列对齐，而 ``len("表名") == 2``
    但终端里它占 4 列（Windows 控制台/等宽字体），用 ``len`` 补齐必然错位。
    """
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in text)


def _pad(text: str, width: int, align: str = "left") -> str:
    """按显示宽度补齐（``align='right'`` 用于数字列）。"""
    spaces = " " * max(0, width - _display_width(text))
    return spaces + text if align == "right" else text + spaces


# 报告里"各表关联行数"的显示顺序：刻意与删除顺序相反 —— 先父表后子表更好读
# （实际 DELETE 仍是子表先于父表，见 _deletion_order）。
# 将来新增的表若不在这个列表里，会排在末尾按名字排序，不会从报告里消失。
_DISPLAY_TABLE_ORDER: Tuple[str, ...] = (
    "users",
    "profiles",
    "profile_tags",
    "test_results",
    "conversations",
    "messages",
    "resumes",
    "interviews",
    "interview_questions",
    "tasks",
    "task_steps",
    "daily_answers",
    "reports",
    "user_badges",
)


def _display_key(name: str) -> Tuple[int, str]:
    try:
        return (_DISPLAY_TABLE_ORDER.index(name), "")
    except ValueError:
        return (len(_DISPLAY_TABLE_ORDER), name)


def _sort_counts(counts: Dict[str, int]) -> Dict[str, int]:
    """按显示顺序重排"各表关联行数"（只影响打印，不影响删除）。"""
    return {name: counts[name] for name in sorted(counts, key=_display_key)}


def _match_patterns(username: str) -> List[str]:
    """命中哪些确证探针模式（返回 ``[模式名] 人话说明``，便于打印依据）。"""
    return [f"[{name}] {desc}" for name, pattern, desc in PROBE_PATTERNS if pattern.match(username)]


def _match_suspects(username: str) -> List[str]:
    """命中哪些"疑似"启发式（**只用于列进需人工决定**，不用于删除）。"""
    hits: List[str] = []
    if _SUSPECT_PREFIX_RE.match(username):
        hits.append("用户名以探针脚本用过的前缀开头，但没有十六进制尾巴（不构成确证）")
    if _SUSPECT_WHITELIST_VARIANT_RE.match(username):
        hits.append("是白名单账号名 + 数字/下划线后缀（可能是冒烟注册的第二个账号，也可能是真人自建）")
    return hits


def _collect_traces(db: Session, user_id: UUID) -> List[TraceHit]:
    """收集"真人痕迹"证据（T1/T2/T3）。

    这三条的取舍标准是"探针脚本**不会**产生这种数据"：
    脚本只会建账号 + 发几条消息 + 生成任务，不会去点"完成任务"、不会手写反馈、
    更不会上传简历/做完整面试。
    """
    hits: List[TraceHit] = []

    done_tasks = db.exec(
        select(Task).where(Task.user_id == user_id, Task.status == TASK_STATUS_DONE)
    ).all()
    if done_tasks:
        hits.append(
            TraceHit("T1", f"{len(done_tasks)} 个「{TASK_STATUS_DONE}」任务（例：{done_tasks[0].title[:24]!r}）")
        )

    feedbacks = db.exec(
        select(TaskStep.feedback)
        .join(Task, TaskStep.task_id == Task.id)
        .where(Task.user_id == user_id, TaskStep.feedback.is_not(None))
    ).all()
    human_feedbacks = [
        text
        for text in feedbacks
        if text and text.strip() and text.strip().lower() not in PROBE_CANNED_FEEDBACK
    ]
    if human_feedbacks:
        hits.append(
            TraceHit("T2", f"{len(human_feedbacks)} 条非模板打卡反馈（例：{_preview(human_feedbacks[0], 30)}）")
        )

    resume_count = int(
        db.execute(
            sa_select(func.count()).select_from(Resume).where(Resume.user_id == user_id)
        ).scalar_one()
    )
    interview_count = int(
        db.execute(
            sa_select(func.count()).select_from(Interview).where(Interview.user_id == user_id)
        ).scalar_one()
    )
    if resume_count or interview_count:
        parts = []
        if resume_count:
            parts.append(f"简历 {resume_count} 份")
        if interview_count:
            parts.append(f"面试 {interview_count} 场")
        hits.append(TraceHit("T3", " / ".join(parts)))

    return hits


def _decide(user: User, pattern_hits: List[str], suspect_hits: List[str], traces: List[TraceHit]) -> Tuple[str, str]:
    """判定优先级：白名单 > 确证模式（+无痕迹） > 有痕迹/疑似 → 人工 > 保留。"""
    if user.username in WHITELIST_USERNAMES:
        return DECISION_KEEP, "白名单硬编码保护（用户本人的真实账号，无论名字多像测试号）"
    if pattern_hits and not traces:
        return DECISION_DELETE, "命中探针模式，且无任何真实痕迹（确证为探针账号）"
    if pattern_hits and traces:
        return DECISION_MANUAL, "命中探针模式，但名下存在真实痕迹 —— 不敢自动删，请人工确认"
    if suspect_hits:
        return DECISION_MANUAL, "名字可疑但没有确证特征（无十六进制尾巴）—— 请人工确认"
    return DECISION_KEEP, "未命中任何探针信号，按真实账号保留"


def classify_accounts(db: Session, users: Sequence[User]) -> List[AccountVerdict]:
    """给每个账号算出判定 + 全部依据 + 各表关联行数。"""
    verdicts: List[AccountVerdict] = []
    for user in users:
        pattern_hits = _match_patterns(user.username)
        # 命中确证模式后就不再报「疑似」：那两句话摆在一起会自相矛盾
        # （"命中十六进制尾巴" 和 "没有十六进制尾巴" 同时出现在一行证据里）。
        suspect_hits = [] if pattern_hits else _match_suspects(user.username)
        traces = _collect_traces(db, user.id)
        decision, reason = _decide(user, pattern_hits, suspect_hits, traces)
        # 各表关联行数：复用同一套删除谓词（含子表），所以数字和真正删除的行数一致
        plan = build_delete_plan(db, [user.id])
        counts: Dict[str, int] = {"users": 1}
        counts.update({name: count for name, count in plan.counts.items() if count and name != "users"})
        verdicts.append(
            AccountVerdict(
                user=user,
                pattern_hits=pattern_hits,
                suspect_hits=suspect_hits,
                traces=traces,
                decision=decision,
                reason=reason,
                counts=_sort_counts(counts),
            )
        )
    return verdicts


def _parse_uuid(raw: str) -> Optional[UUID]:
    """接受带连字符的 UUID 或裸 32 位十六进制（项目里 SQLite 存的是 32 位 hex）。"""
    try:
        return UUID(raw)
    except ValueError:
        pass
    try:
        return UUID(hex=raw)
    except ValueError:
        return None


def _matches_selector(user: User, selector: str) -> bool:
    """``--user`` / ``--include-manual`` 的选择器：username 精确匹配，或 id(UUID/裸 hex)。"""
    if user.username == selector:
        return True
    target_id = _parse_uuid(selector)
    return target_id is not None and user.id == target_id


def promote_manual_verdicts(
    verdicts: Sequence[AccountVerdict],
    selectors: Sequence[str],
) -> List[str]:
    """把 ``--include-manual`` 点名的【需人工决定】账号提升为删除；返回给报告的说明行。

    三条边界（顺序即优先级）：
    1. **白名单先说**：命中 ``wyh`` / ``admin`` 直接抛 ``UserInputError``
       —— 用户明确要求"报错退出而不是静默忽略"，且白名单任何情况下都不能被撬开；
    2. **账号存在但不在【需人工决定】桶里**（既不是人工桶、也不是删除集）也抛错：
       防止"我以为点了它、其实名字写错成另一个真人账号"却仍然继续跑；
    3. **账号根本不存在**时只打印警告、不报错：上一次 ``--apply`` 已经把它删了，
       幂等复跑必须能用同一套参数。这个方向是"少删"（安全侧），配合上面第 2 条
       既挡住了误删存在账号，又不会让复跑卡死。
    """
    notes: List[str] = []
    for raw in selectors:
        selector = raw.strip()
        matched = [verdict for verdict in verdicts if _matches_selector(verdict.user, selector)]
        if not matched:
            notes.append(
                f"⚠️ --include-manual {selector!r} 未匹配到任何账号（若首次运行请检查拼写；"
                "若刚 --apply 过，则它已被删除，属幂等复跑的预期结果）"
            )
            continue
        for verdict in matched:
            if verdict.username in WHITELIST_USERNAMES:
                raise UserInputError(
                    f"--include-manual 拒绝作用于白名单账号 {verdict.username!r}："
                    "白名单（wyh / admin）任何情况下都不能被撬开；本次一个字节都没写。"
                )
            if verdict.decision == DECISION_DELETE:
                notes.append(
                    f"{verdict.username}：本就在【将删除】集合里，--include-manual 是多余的"
                    "（无额外效果）"
                )
                continue
            if verdict.decision != DECISION_MANUAL:
                raise UserInputError(
                    f"--include-manual 拒绝作用于 {verdict.username!r}：它不在【需人工决定】名单里"
                    f"（当前判定依据：{verdict.reason}）。本开关只用于把人工桶里的账号提升为删除。"
                )
            verdict.decision = DECISION_DELETE
            verdict.promoted = True
            verdict.reason = (
                "人工提升（--include-manual，用户明确点名确认可删）："
                f"原判定为【需人工决定】—— {verdict.reason}"
            )
            notes.append(f"{verdict.username}：因 --include-manual 从【需人工决定】提升为【将删除】")
    return notes


@dataclass
class ConversationPlan:
    """``--delete-conversation`` 点名要删的会话（含安全闸统计）。"""

    conversation_id: UUID
    username: str
    title: str
    message_count: int
    user_message_count: int
    role_counts: Dict[str, int] = field(default_factory=dict)

    @property
    def id_text(self) -> str:
        return str(self.conversation_id)


def build_conversation_plans(
    db: Session,
    selectors: Sequence[str],
    *,
    force: bool,
) -> Tuple[List[ConversationPlan], List[str]]:
    """解析 ``--delete-conversation``：跑安全闸 + 统计消息；返回 ``(计划, 说明行)``。

    安全闸为什么卡在 ``role='user'`` 上：只有"用户真的说过话"的会话才可能是真实对话，
    误删不可逆；而纯开场白的空会话（本次要清的 ``admin``『新对话 2』就是这种）
    删掉没有信息损失。所以默认放行空会话、拦下含用户消息的会话，要删必须显式 ``--force``。

    会话 id 找不到时只警告（可能刚被上一次 --apply 删掉，幂等复跑要能用同一套参数），
    但**只要 id 找到了、且含 user 消息，就一定拒绝** —— 这条不因复跑而放宽。
    """
    plans: List[ConversationPlan] = []
    notes: List[str] = []
    for raw in selectors:
        selector = raw.strip()
        conversation_id = _parse_uuid(selector)
        if conversation_id is None:
            raise UserInputError(
                f"--delete-conversation {selector!r} 不是合法 UUID"
                "（要 32 位十六进制或带连字符的形式）"
            )
        conversation = db.exec(
            select(Conversation).where(Conversation.id == conversation_id)
        ).first()
        if conversation is None:
            notes.append(
                f"⚠️ --delete-conversation {selector!r} 未找到该会话（若首次运行请检查 id；"
                "若刚 --apply 过，则它已被删除，属幂等复跑的预期结果）"
            )
            continue

        owner = db.exec(select(User).where(User.id == conversation.user_id)).first()
        rows = db.execute(
            sa_select(Message.role, func.count())
            .where(Message.conversation_id == conversation_id)
            .group_by(Message.role)
        ).all()
        role_counts = {str(role): int(count) for role, count in rows}
        message_count = sum(role_counts.values())
        user_message_count = role_counts.get(MESSAGE_ROLE_USER, 0)
        if user_message_count and not force:
            raise UserInputError(
                f"拒绝删除会话 {conversation_id}（{conversation.title!r}）：它含 "
                f"{user_message_count} 条 {MESSAGE_ROLE_USER!r} 消息，可能是真实对话，"
                "误删不可逆。确认要删请再加 --force。"
            )
        plans.append(
            ConversationPlan(
                conversation_id=conversation_id,
                username=owner.username if owner else "(账号不存在)",
                title=conversation.title,
                message_count=message_count,
                user_message_count=user_message_count,
                role_counts=role_counts,
            )
        )
    return plans, notes


# ---------------------------------------------------------------------------
# 七、只读报告：留真实账号里的 sys:opening 开场白
# ---------------------------------------------------------------------------
def load_opening_messages(db: Session) -> List[Dict[str, Any]]:
    """取全部 ``client_msg_id = 'sys:opening'`` 的消息（连同所属账号与会话）。

    为什么单独报告：开场白是「AI 开场白」功能验收写的探针数据。探针账号整体删掉就没了，
    但**真实账号会话里**可能也留了一条验证残留（例如 ``admin`` 的『新对话 2』）——
    那属于"真实账号里的脏数据"，删不删得由人拍板，脚本只列不删。
    """
    messages = _all_tables()["messages"]
    conversations = _all_tables()["conversations"]
    users = _all_tables()["users"]
    stmt = (
        sa_select(
            messages.c.id,
            messages.c.role,
            messages.c.created_at,
            messages.c.content,
            conversations.c.id.label("conversation_id"),
            conversations.c.title.label("conversation_title"),
            users.c.id.label("user_id"),
            users.c.username,
        )
        .select_from(
            messages.join(conversations, messages.c.conversation_id == conversations.c.id).join(
                users, conversations.c.user_id == users.c.id
            )
        )
        .where(messages.c.client_msg_id == OPENING_CLIENT_MSG_ID)
        .order_by(users.c.username, messages.c.created_at)
    )
    return [dict(row._mapping) for row in db.execute(stmt).all()]


# ---------------------------------------------------------------------------
# 八、打印
# ---------------------------------------------------------------------------
def _print_header(apply: bool, report_only: bool, db_description: str, total_users: int, candidate_count: int) -> None:
    mode = "只读报告 --report" if report_only else ("**落库 --apply**" if apply else "DRY-RUN（默认）")
    print(_RULE_LINE)
    print(f"探针账号清理 —— 模式：{mode}")
    print(_RULE_LINE)
    print(f"  数据库：{db_description}")
    print(f"  users 表共 {total_users} 行；本次候选账号 {candidate_count} 个")
    if not apply:
        print("  本模式**不会写库**（只跑 SELECT，最后显式 rollback）")
    print(flush=True)


def _print_rules() -> None:
    print(_THIN_LINE)
    print("【一】判定规则（本次实际生效的；全部规则都写在脚本里可复查）")
    print(_THIN_LINE)
    print(f"  0) 白名单（硬编码，绝不删）：{' / '.join(WHITELIST_USERNAMES)}")
    print("  1) 确证信号① 探针用户名模式：")
    for name, pattern, desc in PROBE_PATTERNS:
        print(f"       - {name:<12} /{pattern.pattern}/")
        print(f"         {desc}")
    print("  2) 确证信号② 真实痕迹（命中任一 → 不自动删，转人工）：")
    for rule_id, desc in TRACE_RULES:
        print(f"       - {rule_id}: {desc}")
    print("  3) 【需人工决定】= 命中探针模式但有真实痕迹，或名字可疑但无确证特征（默认不删）")
    print("  4) 其余账号一律保留")
    print("  判定优先级：白名单 > （探针模式 ∧ 无痕迹）= 删 > 有痕迹/疑似 = 人工 > 保留")
    print(flush=True)


def _print_verdict_group(title: str, verdicts: Sequence[AccountVerdict], *, with_reason: bool = True) -> None:
    print(_THIN_LINE)
    print(f"{title}（{len(verdicts)} 个）")
    print(_THIN_LINE)
    if not verdicts:
        print("  （无）")
        print(flush=True)
        return
    for index, verdict in enumerate(verdicts, start=1):
        print(f"  {index}) username={verdict.username}")
        print(f"     created_at={verdict.created_at_text}")
        if verdict.promoted:
            print("     ⚠️ 本账号由 --include-manual 从【需人工决定】**人工提升为删除**（用户点名确认）")
        if with_reason:
            print(f"     判定依据：{verdict.reason}")
        print(f"     证据：{verdict.evidence_text}")
        print(f"     关联行数：{verdict.counts_text}")
    print(flush=True)


def _print_plan_totals(plan: DeletePlan, tables: Dict[str, Table], db: Session, *, apply: bool) -> None:
    print(_THIN_LINE)
    verb = "将删除" if not apply else "删除"
    print(f"【五】按表统计：{verb}的行数（先 SELECT COUNT(*) 得到）")
    print(_THIN_LINE)
    print(f"  {_pad('表名', 20)}{_pad('将删除', 8, 'right')}{_pad('现有', 8, 'right')}")
    # 打印按"先父后子"排，实际执行顺序是子表先于父表（内容一样，只是行序不同）
    for name, table, predicate, row_count in sorted(plan.entries, key=lambda entry: _display_key(entry[0])):
        existing = _count_rows_existing(db, table)
        print(f"  {_pad(name, 20)}{_pad(str(row_count), 8, 'right')}{_pad(str(existing), 8, 'right')}")
    print(f"  {_pad('合计', 20)}{_pad(str(plan.total_rows), 8, 'right')}")
    print(f"  实际 DELETE 顺序（子表先于父表）：{' -> '.join(name for name, _, _, _ in plan.entries) or '（无）'}")
    untouched = sorted(set(tables) - {name for name, _, _, _ in plan.entries})
    if untouched:
        print(f"  不涉及（无 user_id、也不是用户表的子表）：{', '.join(untouched)}")
    if plan.skipped:
        for name, row_count in plan.skipped:
            print(
                f"  ⚠️ --skip-task-steps：跳过 {name} 的 {row_count} 行 —— "
                f"这些行会变成**孤儿行**（tasks 已删，task_steps 还在），"
                "请在并发脚本跑完后补跑一次 --apply 收尾"
            )
    print(flush=True)


def _count_rows_existing(db: Session, table: Table) -> int:
    """整表当前行数（只为对照，说明"删完之后还剩多少"）。"""
    return int(db.execute(sa_select(func.count()).select_from(table)).scalar_one())


def _print_manual_notes(title: str, notes: Sequence[str]) -> None:
    """打印 ``--include-manual`` / ``--delete-conversation`` 的处理说明（含提升与豁免）。"""
    print(_THIN_LINE)
    print(title)
    print(_THIN_LINE)
    if not notes:
        print("  （无）")
    for note in notes:
        print(f"  - {note}")
    print(flush=True)


def _print_conversation_plan(plans: Sequence[ConversationPlan], notes: Sequence[str]) -> None:
    """打印显式删会话的计划 + 安全闸结论（用户要看"为什么这条会话被放行"）。"""
    print(_THIN_LINE)
    print(f"【六】显式删除的会话（--delete-conversation，含 user 消息安全闸）（{len(plans)} 个）")
    print(_THIN_LINE)
    for index, plan in enumerate(plans, start=1):
        print(
            f"  {index}) id={plan.id_text}\n"
            f"     账号={plan.username} 标题={plan.title!r} "
            f"消息 {plan.message_count} 条（{plan.role_counts or '无消息'}）"
        )
        if plan.user_message_count:
            print(
                f"     ⚠️ 含 {plan.user_message_count} 条 user 消息，是被 --force 强行放行的"
                "（默认会拒绝）"
            )
        else:
            print("     安全闸：0 条 user 消息 -> 放行（视作空会话/验证残留会话）")
        print(f"     将删除：messages {plan.message_count} 行 + conversations 1 行")
    if not plans:
        print("  （无）")
    for note in notes:
        print(f"  - {note}")
    print(flush=True)


def _print_opening_report(
    opening_rows: Sequence[Dict[str, Any]],
    delete_usernames: Set[str],
    *,
    scoped_by_user: bool = False,
    target_conversation_ids: Optional[Set[UUID]] = None,
) -> None:
    print(_THIN_LINE)
    print(f"【七】只读报告：client_msg_id='{OPENING_CLIENT_MSG_ID}' 的 AI 开场白消息（本脚本不删消息）")
    print(_THIN_LINE)
    if scoped_by_user:
        print("  注意：本次用 --user 限定了范围，**其它探针账号**下的开场白也会出现在 B 类里")
    in_probe = [row for row in opening_rows if row["username"] in delete_usernames]
    in_keep = [row for row in opening_rows if row["username"] not in delete_usernames]

    print(f"  A. 属于【将删除】的探针账号（{len(in_probe)} 条，随账号一并清掉，无需单独处理）：")
    for row in in_probe:
        print(
            f"     - {row['username']} / 会话 {row['conversation_title']!r} / "
            f"{row['created_at']} : {_preview(row['content'])}"
        )
    if not in_probe:
        print("     （无）")

    print(f"  B. **不属于**任何将删除的探针账号（{len(in_keep)} 条，可能是真实账号会话里的验证残留）：")
    if not in_keep:
        print("     （无）")
    targets = target_conversation_ids or set()
    for row in in_keep:
        print(
            f"     - ⚠️ {row['username']} / 会话 {row['conversation_title']!r} / "
            f"role={row['role']} / {row['created_at']}"
        )
        print(f"       内容：{_preview(row['content'], 70)}")
        if row.get("conversation_id") in targets:
            print("       判定：该会话已被 --delete-conversation 点名，**会随整个会话一起删掉**")
        else:
            print("       判定：所属账号不在删除集、会话也没被点名，**本脚本不会动它**，要不要清由人决定")
    print(flush=True)


def _print_summary(
    verdicts: Sequence[AccountVerdict],
    plan: DeletePlan,
    conversation_plans: Sequence[ConversationPlan],
    *,
    apply: bool,
) -> None:
    print(_THIN_LINE)
    print("【八】摘要")
    print(_THIN_LINE)
    counter = {DECISION_DELETE: 0, DECISION_MANUAL: 0, DECISION_KEEP: 0}
    for verdict in verdicts:
        counter[verdict.decision] += 1
    promoted = [v.username for v in verdicts if v.promoted]
    print(
        f"  账号：共 {len(verdicts)} 个 -> "
        f"将删除 {counter[DECISION_DELETE]} 个"
        f"（其中 --include-manual 人工提升 {len(promoted)} 个：{'、'.join(promoted) or '无'}） / "
        f"需人工决定 {counter[DECISION_MANUAL]} 个 / "
        f"保留 {counter[DECISION_KEEP]} 个"
    )
    nonzero = [name for name, _, _, row_count in plan.entries if row_count]
    nonzero.sort(key=_display_key)
    conversation_rows = sum(p.message_count + 1 for p in conversation_plans)
    print(
        f"  将删除的行数合计：{plan.total_rows} 行（账号树；实际有行的表 {len(nonzero)} 张："
        f"{'、'.join(nonzero) or '无'}）"
    )
    if conversation_plans:
        print(
            f"  + 显式删会话 {len(conversation_plans)} 个：{conversation_rows} 行"
            f"（messages {sum(p.message_count for p in conversation_plans)} + "
            f"conversations {len(conversation_plans)}）"
        )
        print(f"  合计将删除：{plan.total_rows + conversation_rows} 行")
    if not apply:
        print("  → DRY-RUN：**没有写入任何字节**（全程只 SELECT，未调用 commit）。")
        print("    确认无误后加 --apply 落库。")
    print(flush=True)


# ---------------------------------------------------------------------------
# 九、落库（只有 --apply 才走到这里）
# ---------------------------------------------------------------------------
def _delete_conversations(db: Session, conversation_plans: Sequence[ConversationPlan]) -> int:
    """删掉点名的会话及其 messages（**只删点名的那些**，别的会话一个字都不碰）。

    顺序同样是子表先于父表：先 messages 再 conversations。
    """
    messages = _all_tables()["messages"]
    conversations = _all_tables()["conversations"]
    total = 0
    for plan in conversation_plans:
        result = db.execute(
            sa_delete(messages).where(messages.c.conversation_id == plan.conversation_id)
        )
        deleted_messages = result.rowcount or 0
        result = db.execute(
            sa_delete(conversations).where(conversations.c.id == plan.conversation_id)
        )
        deleted_conversations = result.rowcount or 0
        total += deleted_messages + deleted_conversations
        print(
            f"  [会话] {plan.id_text} ({plan.username} / {plan.title!r}) "
            f"DELETE messages {deleted_messages} 行 + conversations {deleted_conversations} 行"
        )
    return total


def apply_deletes(
    db: Session,
    plan: DeletePlan,
    conversation_plans: Sequence[ConversationPlan] = (),
) -> int:
    """按计划显式 DELETE（子表先于父表）+ 一次 commit。

    为什么不用 ORM 的级联/删除对象：``ON DELETE CASCADE`` 在本项目模型里没有声明，
    依赖级联不可靠；显式 DELETE 每张表、并打印每张表的实际行数，才是可核对的做法。
    """
    total = 0
    # 点名会话先删：这些会话属于"保留账号"，不在下面的账号树计划里，两者不重叠
    total += _delete_conversations(db, conversation_plans)
    for name, table, predicate, planned in plan.entries:
        if not planned:
            print(f"  {name:<20} 0 行（跳过）")
            continue
        # 落库前再数一次：并发写入（后端在跑）可能让行数变化，
        # 以删除那一刻的 COUNT(*) 为准并打印差值，避免"报告里的数字和实际删的不一致"。
        actual = _count_rows(db, table, predicate)
        if actual != planned:
            print(f"  {name:<20} 复核：计划 {planned} 行 -> 实测 {actual} 行（库被并发写入）")
        result = db.execute(sa_delete(table).where(predicate))
        rows = result.rowcount or 0
        total += rows
        print(f"  {name:<20} DELETE {rows} 行")
    db.commit()
    return total


def _print_integrity_report(db: Session, opening_rows: Sequence[Dict[str, Any]], kept: Sequence[AccountVerdict]) -> None:
    """落库后校验：完整性 / 外键孤儿 / 各表剩余行数 / 剩余开场白 / 保留账号是否完整。

    做成脚本的一部分而不是外部临时脚本：这是"删对了没有"唯一的客观证据，
    以后复用本脚本时也应该在落库后立刻看到它。
    """
    print(_THIN_LINE)
    print("【十】落库后校验")
    print(_THIN_LINE)

    print(f"  PRAGMA integrity_check      : {db.execute(text('PRAGMA integrity_check')).scalar_one()}")
    fk_rows = db.execute(text("PRAGMA foreign_key_check")).all()
    print(f"  PRAGMA foreign_key_check    : {len(fk_rows)} 行孤儿" + (f" -> {fk_rows}" if fk_rows else ""))

    print("  各表剩余行数：")
    for name in sorted(_all_tables()):
        count = _count_rows_existing(db, _all_tables()[name])
        print(f"    {_pad(name, 22)}{_pad(str(count), 8, 'right')}")
    print(f"  剩余 sys:opening 消息      : {len(opening_rows)} 条")

    print("  保留账号完整性（删完之后仍在，且行数/痕迹没变）：")
    if not kept:
        print("    （本次没有保留账号）")
    for verdict in kept:
        flag = "白名单" if verdict.username in WHITELIST_USERNAMES else "保留"
        print(f"    - {verdict.username}（{flag}）：{verdict.counts_text}")
        for hit in verdict.traces:
            print(f"        [{hit.rule_id}] {hit.detail}")
        conversations = db.exec(
            select(Conversation)
            .where(Conversation.user_id == verdict.user.id)
            .order_by(Conversation.created_at)
        ).all()
        for conversation in conversations:
            role_counts = {
                str(role): int(count)
                for role, count in db.execute(
                    sa_select(Message.role, func.count())
                    .where(Message.conversation_id == conversation.id)
                    .group_by(Message.role)
                ).all()
            }
            total_messages = sum(role_counts.values())
            print(
                f"        会话 {conversation.id} {conversation.title!r}："
                f"{total_messages} 条消息 {role_counts}"
            )
    print(flush=True)


# ---------------------------------------------------------------------------
# 十、CLI
# ---------------------------------------------------------------------------
def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python scripts/cleanup_probe_data.py",
        description="清理开发库里的探针/测试账号；默认 dry-run（一个字节都不写），--apply 才落库",
    )
    parser.add_argument("--apply", action="store_true", help="真正 DELETE + commit（默认只打印计划）")
    parser.add_argument(
        "--report",
        action="store_true",
        help=f"只读报告模式：只看 client_msg_id='{OPENING_CLIENT_MSG_ID}' 的开场白残留 + 判定摘要，不写库",
    )
    parser.add_argument(
        "--user",
        default=None,
        help="只处理某个账号，收 username 或 id(UUID，带连字符或裸 32 位十六进制)；"
        "白名单与『需人工决定』规则依然生效",
    )
    parser.add_argument(
        "--skip-task-steps",
        dest="skip_task_steps",
        action="store_true",
        help="不删 task_steps（留给正在并发改它的脚本）；会留下孤儿行，见输出警告",
    )
    parser.add_argument(
        "--include-manual",
        dest="include_manual",
        action="append",
        default=[],
        metavar="账号",
        help="人工提升：把【需人工决定】的账号确认删除，收 username 或 UUID/裸 32 位 hex，"
        "可重复。只能作用于已经列进【需人工决定】的账号；白名单（wyh/admin）会被拒绝并报错退出",
    )
    parser.add_argument(
        "--delete-conversation",
        dest="delete_conversation",
        action="append",
        default=[],
        metavar="会话ID",
        help="显式删除某个会话及其 messages（收 UUID 或裸 32 位 hex，可重复）；"
        "默认拒绝删除含 user 消息的会话（要删必须再加 --force）",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="配合 --delete-conversation：放行『含 user 消息的会话』；没有该参数时这类会话一律拒绝",
    )
    return parser.parse_args(argv)


def _load_users(db: Session, selector: Optional[str]) -> List[User]:
    users = list(db.exec(select(User).order_by(User.created_at, User.username)).all())
    if not selector:
        return users
    return [user for user in users if _matches_selector(user, selector.strip())]


def _scan(
    db: Session,
    args: argparse.Namespace,
) -> Tuple[List[AccountVerdict], DeletePlan, List[Dict[str, Any]], List[ConversationPlan], List[str]]:
    """一次完整扫描（只 SELECT）：账号判定 + 删除计划 + 开场白报告 + 点名会话计划。

    顺序很关键：``--include-manual`` 必须在 ``build_delete_plan`` **之前**跑，
    因为它会把 ``verdict.decision`` 从 manual 改成 delete，删除计划要用改后的结果。
    """
    users = _load_users(db, args.user)
    verdicts = classify_accounts(db, users)
    notes = promote_manual_verdicts(verdicts, args.include_manual)
    conversation_plans, conversation_notes = build_conversation_plans(
        db, args.delete_conversation, force=args.force
    )
    notes.extend(conversation_notes)
    delete_ids = [verdict.user.id for verdict in verdicts if verdict.decision == DECISION_DELETE]
    plan = build_delete_plan(db, delete_ids, skip_task_steps=args.skip_task_steps)
    opening_rows = load_opening_messages(db)
    return verdicts, plan, opening_rows, conversation_plans, notes


def main(argv: Optional[Sequence[str]] = None) -> int:
    configure_logging()  # 复用项目日志配置：顺手把 stdout 切成 UTF-8（Windows 控制台中文）
    args = _parse_args(argv)

    if args.apply and args.report:
        print("[错误] --apply 与 --report 互斥：--report 是只读报告，不会写库。")
        return 2
    if args.force and not args.delete_conversation:
        print("[提示] --force 只在配合 --delete-conversation 时才有意义，本次没有点名会话。")

    with SessionLocal() as db:
        # 参数问题（白名单被撬 / 账号存在但不在人工桶 / 非法 UUID）在**任何写操作之前**整批拒绝
        try:
            verdicts, plan, opening_rows, conversation_plans, notes = _with_lock_retry(
                db, "扫描真实库", lambda: _scan(db, args)
            )
        except UserInputError as exc:
            print(f"\n[错误] {exc}")
            return 2
        except DatabaseBusy as exc:
            print(f"\n[错误] {exc}")
            return 3

        # 先处理"--user 找不到人"：连头都不要打，直接报错退出
        if not verdicts:
            print(f"[错误] 找不到账号：{args.user!r}（--user 收 username 或 UUID）")
            return 2

        all_users = list(db.exec(select(User)).all())
        _print_header(
            args.apply,
            args.report,
            describe_database(),
            len(all_users),
            len(verdicts),
        )

        deleted = [v for v in verdicts if v.decision == DECISION_DELETE]
        manual = [v for v in verdicts if v.decision == DECISION_MANUAL]
        kept = [v for v in verdicts if v.decision == DECISION_KEEP]
        delete_usernames = {v.username for v in deleted}
        target_conversation_ids = {p.conversation_id for p in conversation_plans}

        if args.report:
            # 只读报告：摘要 + 开场白报告，不打印删除计划（避免误读成"报告会删"）
            print(_THIN_LINE)
            print("【只读报告】账号判定摘要")
            print(_THIN_LINE)
            print(
                f"  将删除 {len(deleted)} 个 / 需人工决定 {len(manual)} 个 / 保留 {len(kept)} 个"
                f"（共 {len(verdicts)} 个候选）"
            )
            if manual:
                print("  需人工决定：" + "、".join(v.username for v in manual))
            if notes:
                _print_manual_notes("【参数处理】--include-manual / --delete-conversation", notes)
            _print_opening_report(
                opening_rows,
                delete_usernames,
                scoped_by_user=bool(args.user),
                target_conversation_ids=target_conversation_ids,
            )
            print("  → 本模式全程只 SELECT，**没有写入任何字节**。看完整删除计划请跑默认 dry-run。")
            return 0

        _print_rules()
        _print_verdict_group("【二】将删除的探针账号（确证命中探针模式且无真实痕迹 / 人工提升）", deleted)
        _print_verdict_group("【三】需人工决定（默认不删，请人拍板）", manual)
        _print_verdict_group("【四】保留（真实账号 / 白名单）", kept)
        _print_plan_totals(plan, _all_tables(), db, apply=args.apply)
        if notes or conversation_plans:
            _print_manual_notes("【五之二】参数处理（人工提升 / 显式删会话）", notes)
        _print_conversation_plan(conversation_plans, [])
        _print_opening_report(
            opening_rows,
            delete_usernames,
            scoped_by_user=bool(args.user),
            target_conversation_ids=target_conversation_ids,
        )
        _print_summary(verdicts, plan, conversation_plans, apply=args.apply)

        if not args.apply:
            # 明确收尾只读事务：即使将来有人在上面误加了写操作，dry-run 也不会 commit。
            db.rollback()
            return 0

        # ---------------- 以下只有 --apply 会执行 ----------------
        if (not plan.entries or plan.total_rows == 0) and not conversation_plans:
            print("\n--apply：没有可删除的探针账号 / 会话，未写库（幂等）。")
            db.rollback()
            return 0

        if any(name == "task_steps" for name, _, _, _ in plan.entries):
            print(_THIN_LINE)
            print("⚠️ 注意：本次计划包含 task_steps（另一个 agent 可能也在改这张表，")
            print("   若它还没跑完请改用 --apply --skip-task-steps，会留下孤儿行）。")
            print(_THIN_LINE, flush=True)

        print(_THIN_LINE)
        print("【九】落库（DELETE + commit）")
        print(_THIN_LINE)
        try:
            total = _with_lock_retry(
                db,
                "删除探针数据",
                lambda: apply_deletes(db, plan, conversation_plans),
            )
        except DatabaseBusy as exc:
            db.rollback()
            print(f"\n[错误] {exc}")
            return 3
        print(f"  合计 DELETE {total} 行，已 commit。")
        print("  users 行本身也删了（硬删除）；若想软删除，请改成写 deleted_at（本脚本不做）。")
        logger.info("cleanup_probe_data: DELETE %s 行（%s 个探针账号）", total, len(deleted))

        # 复扫（幂等证据）：第二遍应当没有任何可删账号 / 会话
        try:
            again_verdicts, again_plan, again_opening, again_conversations, _ = _with_lock_retry(
                db, "复扫（幂等证据）", lambda: _scan(db, args)
            )
        except DatabaseBusy as exc:
            print(f"\n[警告] 复扫失败（不影响已完成的删除）：{exc}")
            return 0
        again_deleted = [v for v in again_verdicts if v.decision == DECISION_DELETE]
        print(
            f"  复扫（幂等证据）：仍可删除的探针账号 {len(again_deleted)} 个 / "
            f"计划删除行数 {again_plan.total_rows} 行 / 仍被点名的会话 {len(again_conversations)} 个"
        )
        if again_deleted or again_conversations:
            print("  ⚠️ 复扫仍有可删目标，请把上面输出发出来排查（正常情况下应为 0）。")

        _print_integrity_report(
            db,
            again_opening,
            [v for v in again_verdicts if v.decision != DECISION_DELETE],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
