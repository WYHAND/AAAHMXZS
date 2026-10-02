# -*- coding: utf-8 -*-
"""清理「内容重叠的重复成长任务」。

## 为什么需要它
`POST /task/generate` 现在已有服务端去重（标题相似度命中「进行中」任务就复用、不新建），
但**历史遗留**的重复任务仍然躺在库里（实测 admin 名下 7 个「进行中」任务里有 2 对是同题，
都是去重上线前点出来的），而且"标题相似但用户真的想留两条"这类边界情况也需要人工过一眼。
这些重复任务会同时污染三个地方：
任务页、AI 的开场白素材（它总挑最近更新的那一条问）、以及养成任务的观感。
所以去重是**入口拦截**，本脚本是**存量清理**，两者共用
`app/utils/similarity.py` 的同一套判定口径（详见该模块 docstring）。

## 安全边界（比"删干净"更重要）
1. **有打卡的任务一律不删**：`action_score` 是按 `task_steps.completed` 计数的
   （分数 = 证据），删掉一条已完成步骤的任务等于凭空扣用户的分数。
   `status != 进行中` 的任务（已完成 / 已放弃）同样一律不删 —— 它们是用户的经历。
2. 只删 `task_steps` 里 **0 条 completed** 的「进行中」任务。
3. 探针账号（`前缀_6~8位十六进制`）默认跳过：那些是验证脚本的夹具，
   由 `cleanup_probe_data.py` 整体清理，这里不要抢着删（可能还有脚本在用）。
4. 默认 dry-run，`--apply` 才写库。

用法：
    .\\venv\\Scripts\\python.exe scripts\\cleanup_duplicate_tasks.py            # dry-run
    .\\venv\\Scripts\\python.exe scripts\\cleanup_duplicate_tasks.py --apply
    .\\venv\\Scripts\\python.exe scripts\\cleanup_duplicate_tasks.py --user admin
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

# 以 `python scripts/xxx.py` 直接运行时，sys.path[0] 是 scripts/ 而不是 backend/，
# 于是 `import app...` 会 ModuleNotFoundError。把 backend/ 显式加进来。
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete as sa_delete  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.db.session import SessionLocal
from app.models.task import Task, TaskStep
from app.models.user import User

# 相似度判定**只有一份实现**（app/utils/similarity.py）：``POST /task/generate``
# 的服务端去重与本脚本的清理判定必须同口径，否则会出现"接口继续生成、脚本判定重复"
# 的自相矛盾。判定一律走 ``is_similar``（它内部是"Jaccard + 最长公共子串 + 短标题包含判定
# + 保护词（主题词『只在一侧即冲突』/ 语言名『两侧都有且无共同语言才冲突』）"的完整口径，
# 见该模块 docstring），**严禁在本文件里再拼一套**（两份实现必然漂移）。
# ⚠️ 注意别再用 ``similarity(...) >= CANDIDATE_SIMILARITY_THRESHOLD``：那只是第一条，
# 单用它会让脚本删掉接口认为不该合并的任务（改规则时踩过）。
from app.utils.similarity import is_similar, normalize  # noqa: E402

# 与 cleanup_probe_data.py 同一套探针命名模式（这里只用来"跳过"）
PROBE_RE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*_[0-9a-f]{6,8}$")
U_NUMBER_RE = re.compile(r"^u\d+(?:_[0-9a-f]{6,8})?$")


def completed_steps(db: Session, task_id) -> int:
    rows = db.exec(select(TaskStep).where(TaskStep.task_id == task_id)).all()
    return sum(1 for step in rows if step.completed)


def is_probe_name(username: str) -> bool:
    return bool(PROBE_RE.match(username) or U_NUMBER_RE.match(username))


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description="清理内容重叠的重复成长任务（默认 dry-run）")
    parser.add_argument("--apply", action="store_true", help="真正写入并 commit（默认只打印）")
    parser.add_argument("--user", action="append", default=None, help="只处理指定 username，可重复")
    parser.add_argument("--include-probe", action="store_true", help="连探针账号一起处理（默认跳过）")
    args = parser.parse_args(argv)

    db = SessionLocal()
    try:
        users = db.exec(select(User)).all()
        if args.user:
            wanted = {name.lower() for name in args.user}
            users = [u for u in users if u.username.lower() in wanted]
            if not users:
                print(f"[错误] --user 没匹配到任何账号：{args.user}")
                return 2

        print("=" * 78)
        print(f"重复任务清理 [{'APPLY（写库）' if args.apply else 'DRY-RUN（不写库）'}]")
        print("=" * 78)

        groups_to_delete: List[Tuple[User, Task, List[Task]]] = []
        protected: List[Tuple[User, Task, str]] = []
        skipped_probe: List[str] = []

        for user in users:
            if is_probe_name(user.username) and not args.include_probe:
                skipped_probe.append(user.username)
                continue

            tasks = db.exec(select(Task).where(Task.user_id == user.id)).all()
            buckets: Dict[str, List[Task]] = defaultdict(list)
            for task in tasks:
                buckets[normalize(task.title)].append(task)

            # 组内再用完整判定两两合并（标题不完全相同但主题一样的情况）。
            # 这里比的是**归一化后的 key**（buckets 的 key），而 is_similar 接受原始标题也行 ——
            # 归一化是幂等的，传 key 与传原始标题结果一致，且省一次归一化。
            # ⚠️ 唯一的例外是 C 家族语言名：normalize() 会把 'C++'/'C#' 压成 'C'，
            # 传 key 进去就分不清「用 C 做…」与「用 C++ 做…」—— 不过这两条的 key 本来就同桶
            # （改前也一样），所以这不构成本脚本相对改前的行为变化。
            keys = list(buckets)
            merged: List[List[Task]] = []
            for key in keys:
                placed = False
                for group in merged:
                    if is_similar(key, normalize(group[0].title)):
                        group.extend(buckets[key])
                        placed = True
                        break
                if not placed:
                    merged.append(list(buckets[key]))

            for group in merged:
                if len(group) < 2:
                    continue
                # 受保护的（有打卡 / 非进行中）永远留在库里，不参与"保留哪一条"的竞争
                live = [
                    t for t in group
                    if t.status == "进行中" and completed_steps(db, t.id) == 0
                ]
                for task in group:
                    if task in live:
                        continue
                    if completed_steps(db, task.id) > 0:
                        protected.append((user, task, "有打卡记录"))
                    elif task.status != "进行中":
                        protected.append((user, task, f"状态={task.status}"))
                if len(live) < 2:
                    continue
                # 保留最新的一条：用户最近看到的那条，最可能就是他正在做的
                live.sort(key=lambda t: t.created_at)
                keeper, dups = live[-1], live[:-1]
                groups_to_delete.append((user, keeper, dups))

        # ---------- 报告 ----------
        total_dups = sum(len(dups) for _, _, dups in groups_to_delete)
        print(f"\n【一】重复组（保留最新一条，其余候选删除）")
        if not groups_to_delete:
            print("  （无）")
        for user, keeper, dups in groups_to_delete:
            print(f"\n  user={user.username}  主题：{keeper.title}")
            print(f"    ✅ 保留  {keeper.created_at:%Y-%m-%d %H:%M:%S}  {keeper.title}（steps=0 completed）")
            for dup in dups:
                print(f"    ❌ 删除  {dup.created_at:%Y-%m-%d %H:%M:%S}  {dup.title}  id={dup.id}")

        print(f"\n【二】受保护（不删）")
        if not protected:
            print("  （无）")
        for user, task, why in protected:
            print(f"  🔒 user={user.username}  「{task.title}」  {why}")

        print(f"\n【三】跳过的探针账号（交由 cleanup_probe_data.py 处理）")
        print("  " + ("、".join(skipped_probe) if skipped_probe else "（无）"))

        print(f"\n【四】摘要")
        print(f"  重复组 {len(groups_to_delete)} 组；将删除任务 {total_dups} 条"
              f"（连带其 task_steps {sum(len(db.exec(select(TaskStep).where(TaskStep.task_id == d.id)).all()) for _, _, dups in groups_to_delete for d in dups)} 条）")
        print(f"  受保护任务 {len(protected)} 条；跳过探针账号 {len(skipped_probe)} 个")

        if not args.apply:
            print("\n  → DRY-RUN：**没有写入任何字节**。确认无误后加 --apply 落库。")
            return 0

        # ---------- 落库 ----------
        print("\n【五】落库")
        deleted_steps = 0
        for user, _keeper, dups in groups_to_delete:
            for dup in dups:
                steps = db.exec(select(TaskStep).where(TaskStep.task_id == dup.id)).all()
                # ⚠️ 这里**必须**用 Core 的 delete() 显式按"子表先于父表"发语句，
                # 不能用 ORM 的 db.delete(obj)：SQLModel 的 Task / TaskStep 之间
                # **没有配 relationship()**，SQLAlchemy 的工作单元因此不知道两张表的
                # 依赖顺序，会把 `DELETE FROM tasks` 排到 `DELETE FROM task_steps` 之前，
                # 直接撞 `FOREIGN KEY constraint failed`（实测踩过，事务已回滚、
                # 库里一条没少）。显式发语句才是确定的顺序。
                db.execute(sa_delete(TaskStep).where(TaskStep.task_id == dup.id))
                db.execute(sa_delete(Task).where(Task.id == dup.id))
                deleted_steps += len(steps)
                print(f"  DELETE task 「{dup.title}」(user={user.username}) + task_steps {len(steps)} 条")
        db.commit()
        print(f"  合计：DELETE 任务 {total_dups} 条 / task_steps {deleted_steps} 条，已 commit。")
        print("  未改动：users / profiles / profile_tags / conversations / messages / "
              "tasks.status / task_steps.completed / feedback / completed_at")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
