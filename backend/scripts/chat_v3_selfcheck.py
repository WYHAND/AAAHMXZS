"""对话 v3 自检：就业内容素材库 + 对话导演层（不连数据库、不需要 API Key）。

只测两个已经存在的纯服务端模块，直接 import 就能跑：

- ``app.services.career_content_service``：素材载入 / 方向匹配 / 检索与剔除；
- ``app.services.chat_director``（**已从"导演"降级为"供料"**，见勘误 9.31）：状态与进度判定、
  素材去重（按要点判、且不许误伤同组）、空转校验、兜底文案；
  以及一条**反向回归**：TurnBrief 里**不该再出现** intent / angle / must_deliver 这类指令式字段。

用法（必须用 venv 的解释器；脚本自己把 ``backend/`` 插进 sys.path）::

    cd backend
    venv\\Scripts\\python.exe scripts\\chat_v3_selfcheck.py

如果控制台把中文显示成乱码（Windows 控制台默认 GBK），先 ``chcp 65001`` 再跑；
或者直接 ``venv\\Scripts\\python.exe -X utf8 scripts\\chat_v3_selfcheck.py``（不要再用
PowerShell 管道二次转码，否则仍可能乱码）。脚本内部也会尝试把 stdout 切到 utf-8。

退出码：0 = 全部通过；1 = 有断言失败（失败项会打印"期望 / 实际"）。
"""

from __future__ import annotations

import random
import sys
from collections import Counter
from pathlib import Path

# 脚本在 backend/scripts/ 下：把 backend/ 插到 sys.path 最前面，app.* 才能 import
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

try:  # Windows 控制台默认 GBK，中文 + 符号会炸/乱码
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001 —— 老解释器没有 reconfigure 就算了
    pass

from app.services import career_content_service as content  # noqa: E402
from app.services import chat_director as director  # noqa: E402


results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    """记录并打印一项断言。detail 一律放**实际值**，失败时不用再猜。"""
    results.append((name, ok, detail))
    print(f"{'通过' if ok else '失败'} | {name}" + (f" | {detail}" if detail else ""))


def ids_of(items: list[dict]) -> list[str]:
    return [str(item.get("id")) for item in items]


def main() -> int:
    print(f"== 对话 v3 自检（backend={BACKEND_DIR}）==\n")

    # ------------------------------------------------------------------
    # 1. 素材库载入
    # ------------------------------------------------------------------
    stats = content.content_stats()
    directions = content._load_directions()  # 自检要看 kind，_load_directions 是唯一真源
    loaded = {d["id"]: d for d in directions}
    per_direction = "，".join(f"{d['name']}={len(d['items'])}" for d in directions)
    bad_kinds = [
        (d["id"], item["id"], item["kind"])
        for d in directions
        for item in d["items"]
        if item["kind"] not in content.VALID_KINDS
    ]
    thin = [d["id"] for d in directions if len(d["items"]) < 3]

    check(
        "1.1 素材库方向数 / 条目数",
        stats["directions"] == 2 and stats["items"] > 0,
        f"directions={stats['directions']}（期望 2），items={stats['items']}，明细：{per_direction}",
    )
    check(
        "1.2 每个方向至少 3 条",
        bool(directions) and not thin,
        f"各方向条数：{per_direction}；不足 3 条的方向={thin or '无'}",
    )
    check(
        "1.3 所有条目的 kind 都在 VALID_KINDS 里",
        not bad_kinds,
        f"VALID_KINDS={list(content.VALID_KINDS)}；非法条目={bad_kinds or '无'}",
    )
    print()

    # ------------------------------------------------------------------
    # 2. 方向匹配
    # ------------------------------------------------------------------
    m_cs = content.match_direction("计算机科学与技术")
    m_se = content.match_direction("软件工程")
    m_redis = content.match_direction("redis")
    m_empty = content.match_direction("")

    check(
        "2.1 match_direction('计算机科学与技术') → 计算机 / 软件",
        bool(m_cs) and ("计算机" in m_cs["name"] or "软件" in m_cs["name"]),
        f"命中={m_cs['name'] if m_cs else None}（期望含“计算机”或“软件”）",
    )
    check(
        "2.2 match_direction('软件工程') → 命中",
        m_se is not None,
        f"命中={m_se['name'] if m_se else None}",
    )
    check(
        "2.3 match_direction('redis') → None（<3 位纯 ASCII 别名只精确匹配）",
        m_redis is None,
        f"实际={m_redis['name'] if m_redis else None}（期望 None）",
    )
    check(
        "2.4 match_direction('') → None",
        m_empty is None,
        f"实际={m_empty['name'] if m_empty else None}（期望 None）",
    )
    print()

    # ------------------------------------------------------------------
    # 3. 检索与剔除
    # ------------------------------------------------------------------
    general_ids = set(ids_of(loaded[content.GENERAL_ID]["items"])) if content.GENERAL_ID in loaded else set()
    r1 = content.retrieve("计算机", limit=3)
    got1 = r1["items"]
    has_general = any(item["id"] in general_ids for item in got1)

    check(
        "3.1 retrieve('计算机', limit=3) → ≤3 条",
        len(got1) <= 3,
        f"返回 {len(got1)} 条：{[(i['id'], i['kind']) for i in got1]}",
    )
    check(
        "3.2 retrieve('计算机', limit=3) → 至少含一条 general 条目",
        has_general,
        f"direction={r1['direction']}；ids={ids_of(got1)}；其中 general={[i for i in ids_of(got1) if i in general_ids]}",
    )

    first_id = got1[0]["id"] if got1 else "<空>"
    r2 = content.retrieve("计算机", limit=3, exclude_ids=[first_id])
    ids2 = ids_of(r2["items"])
    check(
        "3.3 exclude_ids 把第一条剔掉后不再出现",
        bool(got1) and first_id not in ids2,
        f"first_id={first_id}；再查 ids={ids2}（不应含 {first_id}）",
    )
    print()

    # ------------------------------------------------------------------
    # 4. 供料层：卡住时手边必须有料（这是"答不上来别再丢一道题"的物料保障）
    # ------------------------------------------------------------------
    stuck_history = [("assistant", "嗨，今天过得咋样？"), ("user", "我不知道")]
    brief_stuck = director.brief_turn("我不知道", stuck_history, profile_text="计算机")

    check(
        "4.1 卡住 → user_state=卡住",
        brief_stuck.user_state == "卡住",
        f"state={brief_stuck.user_state}；step={brief_stuck.step}",
    )
    check(
        "4.2 卡住 → 手边有料（materials 非空）",
        bool(brief_stuck.materials),
        f"materials={ids_of(brief_stuck.materials)}",
    )
    check(
        "4.3 卡住 → step=画面",
        brief_stuck.step == "画面",
        f"step={brief_stuck.step}（期望 画面）",
    )
    block_stuck = brief_stuck.as_prompt_block()
    check(
        "4.4 供料块带三条硬边界 + 目的地",
        "只有这三条是硬的" in block_stuck and "目的地" in block_stuck,
        f"块内是否含'只有这三条是硬的'={'只有这三条是硬的' in block_stuck}；"
        f"是否含'目的地'={'目的地' in block_stuck}",
    )
    print()

    # ------------------------------------------------------------------
    # 5. 导演层已降级（用户拍板"约束不要太多"）：不再产出指令式字段
    # ------------------------------------------------------------------
    ask_history = [
        ("assistant", "嗨，今天过得咋样？"),
        ("assistant", "那你平时都干嘛？"),
        ("assistant", "你觉得自己哪方面强一点？"),
        ("user", "还行"),
    ]
    brief_ask = director.brief_turn("还行", ask_history, profile_text="计算机")
    forbidden_attrs = [attr for attr in ("intent", "angle", "must_deliver") if hasattr(brief_ask, attr)]
    check(
        "5.1 TurnBrief 不再有 intent / angle / must_deliver（指令式设计已删）",
        not forbidden_attrs,
        f"仍然存在的指令式字段={forbidden_attrs or '无'}",
    )
    instr_words = [w for w in ("必须给内容", "这轮你要做的事", "从哪个角度说") if w in brief_ask.as_prompt_block()]
    check(
        "5.2 供料块里没有'必须/你要做的事/从哪个角度说'这类指令语",
        not instr_words,
        f"命中的指令语={instr_words or '无'}",
    )
    print()

    # ------------------------------------------------------------------
    # 6. 拒绝 → 供料层如实报状态（不再脚本化地"换切口"）
    # ------------------------------------------------------------------
    refuse_history = [("assistant", "嗨，今天过得咋样？"), ("user", "不想聊这个")]
    brief_refuse = director.brief_turn("不想聊这个", refuse_history, profile_text="计算机")
    check(
        "6 拒绝 → user_state=拒绝",
        brief_refuse.user_state == "拒绝",
        f"state={brief_refuse.user_state}；reason={brief_refuse.reason}",
    )
    print()

    # ------------------------------------------------------------------
    # 7. 素材不重复（按要点判），且**不许**误伤同组素材
    # ------------------------------------------------------------------
    pool = content.retrieve("计算机", limit=999)["items"]
    target = next((item for item in pool if item["kind"] == "daily_work"), pool[0])
    probe = content.item_probe(target)
    said_probe_history = [
        ("assistant", f"我先跟你说个具体的：{probe}。"),
        ("user", "我不知道"),
    ]
    brief_dedup = director.brief_turn("我不知道", said_probe_history, profile_text="计算机")
    dedup_ids = ids_of(brief_dedup.materials)
    check(
        "7.1 讲过的那条（按要点判）不再出现在 materials 里",
        target["id"] not in dedup_ids,
        f"已讲={target['id']}；本轮 materials={dedup_ids}；reason={brief_dedup.reason}",
    )

    # ⚠️ 回归：同组标题长得太像（"开发岗的日常到底在干嘛" / "测试岗的日常到底在干嘛"），
    # 拿标题当去重探针会把整组素材一次剔光 —— 那正是自检脚本抓出来的真问题。
    title_only_history = [
        ("assistant", f"我刚说的是「{target.get('title')}」这条。"),
        ("user", "我不知道"),
    ]
    brief_title = director.brief_turn("我不知道", title_only_history, profile_text="计算机")
    check(
        "7.2 只提到标题不该误伤同组素材（候选仍 ≥2 条）",
        len(brief_title.materials) >= 2,
        f"materials={ids_of(brief_title.materials)}（期望 ≥2 条）",
    )
    print()

    # ------------------------------------------------------------------
    # 8. 空转判定
    # ------------------------------------------------------------------
    empty_materials = content.retrieve("计算机", limit=3)["items"]
    ask_text = "那你平时做小组作业，最愿意主动揽哪一块？"
    empty_flag = director.looks_like_empty_turn(ask_text, empty_materials)

    anchor = empty_materials[0]
    long_reply = (
        f"关于「{anchor['title']}」，先说我的看法：{anchor['text']}"
        "你不用一下子把它想明白，挑一个最小的切口先动手做出来，"
        "做完再回头看：卡在哪、为什么卡、后来怎么绕过去的，这三件事比进度条重要。"
    )
    long_flag = director.looks_like_empty_turn(long_reply, empty_materials)

    check(
        "8.1 纯提问（没沾素材）→ 空转 True",
        empty_flag is True,
        f"looks_like_empty_turn={empty_flag}；文本长 {len(ask_text)} 字；"
        f"materials={ids_of(empty_materials)}",
    )
    check(
        "8.2 沾了素材要点的长回复（≥100 字）→ 空转 False",
        len(long_reply) >= 100 and long_flag is False,
        f"looks_like_empty_turn={long_flag}；文本长 {len(long_reply)} 字（要求 ≥100）",
    )
    print()

    # ------------------------------------------------------------------
    # 9. 随机性确实存在（同一个输入 30 次真随机 → 抽到的素材组合 ≥2 种）
    # ------------------------------------------------------------------
    combos: set = set()
    for _ in range(30):
        b = director.brief_turn("我不知道", [("assistant", "嗨，今天过得咋样？"), ("user", "我不知道")], profile_text="计算机")
        combos.add(tuple(sorted(i["id"] for i in b.materials)))
    check(
        "9 同一输入 30 次真随机 → 素材组合 ≥2 种",
        len(combos) >= 2,
        f"组合种类={len(combos)}；示例={sorted(combos)[:2]}",
    )
    print()

    # ------------------------------------------------------------------
    # 10. 兜底文案非空、无数字型薪资 / 就业率字样
    # ------------------------------------------------------------------
    fallback = director.material_fallback_text(brief_stuck.materials)
    banned = [token for token in ("%", "薪资", "万") if token in fallback]
    check(
        "10.1 兜底文案非空",
        bool(fallback and fallback.strip()),
        f"长度={len(fallback)}；开头={fallback[:60]!r}",
    )
    check(
        "10.2 兜底文案不含 % / 薪资 / 万",
        not banned,
        f"命中禁词={banned or '无'}；全文={fallback}",
    )
    print()

    # ------------------------------------------------------------------
    # 11. 行业/就业现状（market）：检索里有、供料会强制带、讲完就退场（勘误 9.40）
    # ------------------------------------------------------------------
    market_pool = [i for i in content.retrieve("计算机", limit=999)["items"] if i["kind"] == "market"]
    check(
        "11.1 素材库里 market（行业现状）能被载入（不是被当脏数据丢掉）",
        len(market_pool) >= 1,
        f"market 条数={len(market_pool)}；ids={[i['id'] for i in market_pool][:4]}",
    )

    fresh_brief = director.brief_turn(
        "我不知道", [("assistant", "嗨，今天过得咋样？"), ("user", "我不知道")], profile_text="计算机"
    )
    check(
        "11.2 方向已知 + 没讲过 → 本轮素材里必须有 market",
        any(i["kind"] == "market" for i in fresh_brief.materials),
        f"materials={[(i['id'], i['kind']) for i in fresh_brief.materials]}",
    )

    all_market_probes = "；".join(content.item_probe(i) for i in market_pool)
    said_history = [("assistant", f"我之前跟你说过：{all_market_probes}"), ("user", "我不知道")]
    after_brief = director.brief_turn("我不知道", said_history, profile_text="计算机")
    check(
        "11.3 market 全讲过后不再硬塞（不会每轮都念行业现状）",
        not any(i["kind"] == "market" for i in after_brief.materials),
        f"materials={[(i['id'], i['kind']) for i in after_brief.materials]}",
    )
    print()

    # ------------------------------------------------------------------
    # 汇总
    # ------------------------------------------------------------------
    passed = sum(1 for _, ok, _ in results if ok)
    failed = len(results) - passed
    print("=" * 70)
    print(f"通过 {passed} / 失败 {failed}")
    if failed:
        print("失败项：")
        for name, ok, detail in results:
            if not ok:
                print(f"  - {name} | {detail}")
    print("=" * 70)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
