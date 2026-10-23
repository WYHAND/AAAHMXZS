"""就业内容素材检索（方向 × 内容类型）。

为什么要有这个模块（勘误 9.31 的核心）：

对话模块原先**手里没有任何「就业」内容** —— 关于各方向做什么、门槛在哪、
先学什么，项目里一个字都没有。于是模型能做的只有两类动作：接住用户的话，
再抛一个问题。**「复述 + 问句」是唯一永远不违规的输出**，所以它成了每轮的
默认形态，用户的感觉就是"这个 AI 不思考"。

这个模块跟 ``question_bank_service`` 是**同一味药**：面试模块把出题从
"模型现编"改成"从真题里挑 + 贴合简历改写"，效果立刻不同；对话模块这里是
把"讲就业情况"从"模型现编"改成"从素材里挑 + 按他的专业/年级改写"。

素材是纯数据文件：``app/ai/career_content/*.json``，一个文件一个方向：:

    {
      "id": "software", "name": "计算机 / 软件",
      "aliases": ["计算机", "计科", "软工", ...],
      "sources": [...],
      "items": [
        {"id": "sw-daily-dev", "kind": "daily_work", "title": "...",
         "text": "...", "points": ["...", "..."]}
      ]
    }

- ``kind`` 取值（决定"什么时候该掏哪一条"）：``market``（行业/就业现状：现在校招在要什么、
  筛选怎么前置、实习权重、招聘时间窗）、``map``（这行有哪些路）、``daily_work``（日常到底干什么）、
  ``threshold``（门槛在哪）、``path``（先学什么 / 怎么起步）、``myth``（常见误解）、
  ``reality``（真实的样子）；
- 硬边界与 ``chat_system.txt`` 一致：**只讲方向 / 日常 / 门槛 / 路径 / 误解，
  绝对不写薪资、就业率、招录人数、哪家公司今年缺人** —— 那些没有可靠来源；
- ``general.json``（id=general）不参与方向匹配，任何方向都能配上它。

⚠️ 「挑哪条」不在这里做：这里是**候选池**，抽签权在 ``chat_director``
（那才是"这轮该给什么"的地方，也是随机性的来源）。本模块只负责
"按方向能不能捞出东西 + 把已经给过的剔掉"。
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from app.utils.logger import get_logger

logger = get_logger(__name__)

CONTENT_DIR = Path(__file__).resolve().parent.parent / "ai" / "career_content"

GENERAL_ID = "general"

# ``kind`` 的合法取值（写错的值会被丢掉，避免脏数据流进 prompt）
# ⚠️ 顺序 = 检索时的排序权重（``kind_order`` 直接用它）：``market`` 放最前，
# 因为用户要的第一件事是"**这行现在什么样**"（行业/就业现状），然后才是"有哪些路、日常干什么"。
VALID_KINDS = ("market", "map", "daily_work", "threshold", "path", "myth", "reality")

# 一次给模型看的候选条数上限（多了它就会"每条都念一句"，反而没重点）
CANDIDATE_LIMIT = 4

# 渲染给模型的素材文本里，``points`` 最多带几条
MAX_POINTS = 4

_NORMALIZE_RE = re.compile(r"[\s\-_/·、,，.。()（）【】\[\]|]+")


# ---------------------------------------------------------------------------
# 载入
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_directions() -> List[Dict[str, Any]]:
    """读取素材目录下所有 ``*.json``（带缓存）。坏文件只记日志、不打断启动。"""
    directions: List[Dict[str, Any]] = []
    if not CONTENT_DIR.exists():
        logger.error("就业内容素材目录不存在: %s", CONTENT_DIR)
        return directions

    for path in sorted(CONTENT_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("就业内容素材解析失败 %s: %s", path.name, exc)
            continue

        items: List[Dict[str, Any]] = []
        for raw in data.get("items") or []:
            item_id = str(raw.get("id") or "").strip()
            text = str(raw.get("text") or "").strip()
            kind = str(raw.get("kind") or "").strip()
            if not item_id or not text or kind not in VALID_KINDS:
                # 缺 id / 缺正文 / kind 不认识 —— 这类脏数据进 prompt 只会添乱
                logger.warning("就业内容素材条目被丢弃（%s）: id=%s kind=%s", path.name, item_id, kind)
                continue
            items.append(
                {
                    "id": item_id,
                    "kind": kind,
                    "title": str(raw.get("title") or "").strip(),
                    "text": text,
                    "points": [str(p) for p in (raw.get("points") or []) if str(p).strip()],
                }
            )

        if not items:
            logger.warning("就业内容素材文件没有有效条目，已跳过: %s", path.name)
            continue

        directions.append(
            {
                "id": str(data.get("id") or path.stem),
                "name": str(data.get("name") or path.stem),
                "aliases": [str(a) for a in (data.get("aliases") or [])],
                "items": items,
            }
        )

    logger.info(
        "就业内容素材载入完成：%s 个方向 / %s 条",
        len(directions), sum(len(d["items"]) for d in directions),
    )
    return directions


def reload_content() -> None:
    """清缓存（素材改版后热加载 / 测试用）。"""
    _load_directions.cache_clear()
    _alias_index.cache_clear()


@lru_cache(maxsize=1)
def _alias_index() -> List[tuple]:
    """``(normalized_alias, len, direction)``，按 alias 长度倒序（长别名优先）。"""
    items: List[tuple] = []
    for direction in _load_directions():
        if direction["id"] == GENERAL_ID:
            continue  # 通用素材不参与匹配（它对谁都配上，见 retrieve）
        for alias in [direction["name"], *direction["aliases"]]:
            normalized = _normalize(alias)
            if normalized:
                items.append((normalized, len(normalized), direction))
    items.sort(key=lambda item: item[1], reverse=True)
    return items


def _normalize(text: str) -> str:
    """去空格 / 常见标点并转小写（与 ``question_bank_service`` 同一套口径）。"""
    return _NORMALIZE_RE.sub("", (text or "").lower())


def _direction_by_id(direction_id: str) -> Optional[Dict[str, Any]]:
    for direction in _load_directions():
        if direction["id"] == direction_id:
            return direction
    return None


# ---------------------------------------------------------------------------
# 匹配
# ---------------------------------------------------------------------------

def match_direction(text: Optional[str]) -> Optional[Dict[str, Any]]:
    """从**一段自由文本**（用户说过的话 / 画像标签 / 任务标题）里认方向。

    与面试题库那套规则一致（避免误匹配）：
    - 长别名优先（"软件工程" 先于 "软件" 先于 "cs"）；
    - 非 ASCII（中文）别名或长度 >= 3 的别名用**子串**匹配；
    - 长度 < 3 的纯 ASCII 别名（``cs`` / ``ai``）只在**完全相等**时匹配，
      否则 "redis" 会因为含 ``cs`` 被判成计算机。
    """
    key = _normalize(text or "")
    if not key:
        return None

    for alias, length, direction in _alias_index():
        if not alias:
            continue
        if not alias.isascii() or length >= 3:
            if alias in key:
                return direction
        elif key == alias:
            return direction
    return None


def list_directions() -> List[Dict[str, str]]:
    """方向清单（供调试 / 日志用）。"""
    return [{"id": d["id"], "name": d["name"], "items": len(d["items"])} for d in _load_directions()]


# ---------------------------------------------------------------------------
# 检索
# ---------------------------------------------------------------------------

def _general_items() -> List[Dict[str, Any]]:
    general = _direction_by_id(GENERAL_ID)
    return list(general["items"]) if general else []


def item_probe(item: Dict[str, Any]) -> str:
    """一条素材用于**机械去重**的探针文本。

    ⚠️ 为什么不用 ``title``（这是自检脚本抓出来的真问题）：同一个 ``kind`` 的标题长得太像
    （"开发岗的日常到底在干嘛" / "测试岗的日常到底在干嘛" / "运维 / 基础架构的日常在干嘛"），
    而 ``looks_referenced`` 是"最长公共子串 ≥3 就算提到过"的**宁可多剔**口径 ——
    拿标题当探针，只要 AI 讲过一次开发岗，**整组日常类素材会被一次剔光**，
    接下来的对话就真的没内容可给了。``points`` 是逐条具体、彼此不重样的，
    拿它当探针才既能认出"这条讲过了"，又不会误伤同组其它条。
    """
    points = item.get("points") or []
    if points:
        return "；".join(str(p) for p in points)
    return str(item.get("title") or item.get("id") or "")


def retrieve(
    text: Optional[str],
    exclude_ids: Iterable[str] = (),
    limit: int = CANDIDATE_LIMIT,
) -> Dict[str, Any]:
    """按**方向**捞出候选素材（``general`` 始终预留给它一份名额）。

    返回 ``{"direction": 方向名 | None, "items": [...]}``。

    - ``exclude_ids``：这个会话**已经给过**的条目 —— 直接剔除，保证同一段对话里
      不会把同一件事讲两遍（"换个说法再讲一遍"也是重复）；
    - 匹配不到方向时只给 ``general``，**不会**把别的方向的素材硬塞过来
      （那会让模型说出跟他专业无关的话）；
    - ⚠️ **``general`` 有保底名额**（自检脚本抓出来的）：``general`` 里装的是
      「怎么看就业这件事」（课上学的和招聘要的不是一回事、门槛分两层、方向不是选一次…），
      对**任何**专业都成立 —— 而方向素材动辄十几条，不留名额的话它就永远被挤在 ``limit`` 之外，
      一个计算机专业的学生反而永远听不到这些最该听的通用判断。
      规则：``general`` 至少占 ``limit // 3``（向下取整，最少 1 条），其余给方向素材。
    - 顺序 = ``map / daily_work / threshold / path / myth / reality``（与 ``VALID_KINDS`` 同序，
      即"先让他看见有哪些路，再讲日常和门槛，最后才是方法和误解"）。
    """
    excluded = {str(i) for i in exclude_ids}
    direction = match_direction(text)

    kind_order = {kind: index for index, kind in enumerate(VALID_KINDS)}

    def usable(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        picked = [item for item in items if item["id"] not in excluded]
        return sorted(picked, key=lambda item: kind_order.get(item["kind"], 99))

    general_pool = usable(_general_items())
    direction_pool = usable(direction["items"]) if direction else []

    if not direction_pool:
        # 没认出来方向：全是通用素材，不用分配名额
        picked = general_pool[:limit]
    else:
        general_slots = max(1, limit // 3)
        picked_general = general_pool[:general_slots]
        picked_direction = direction_pool[: max(limit - len(picked_general), 0)]
        # 方向在前面（更贴他的专业），通用认知垫在后面
        picked = [*picked_direction, *picked_general]
        if len(picked) < limit:  # 方向素材被剔空了就把名额还给通用
            picked = [*picked_direction, *general_pool[: limit - len(picked_direction)]]

    seen: set = set()
    items: List[Dict[str, Any]] = []
    for item in picked:
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        items.append(item)

    return {
        "direction": direction["name"] if direction else None,
        "items": items,
    }


def retrieve_for_direction_name(
    direction_name: Optional[str],
    exclude_ids: Iterable[str] = (),
    limit: int = CANDIDATE_LIMIT,
) -> Dict[str, Any]:
    """同 :func:`retrieve`，但方向是**已经认好的名字**（画像 / 任务里已有的结论）。

    用在"用户这轮没说什么专业向的词，但画像里早就写着计算机"的场景 ——
    这时也该按计算机给他讲，而不是退回通用素材。
    """
    return retrieve(direction_name or "", exclude_ids=exclude_ids, limit=limit)


def format_materials(items: List[Dict[str, Any]]) -> str:
    """把候选素材拼成给模型看的文本块（一条一段，带要点）。

    刻意**不**写"第 N 条 / 编号"式的东西给用户看的形式 —— 这是给模型看的，
    它要照着这些**用他自己的话**讲出来，不是念稿。
    """
    lines: List[str] = []
    for item in items:
        head = item.get("title") or item["id"]
        points = "；".join((item.get("points") or [])[:MAX_POINTS])
        block = f"· [{item['kind']}] {head}\n  {item['text']}"
        if points:
            block += f"\n  要点：{points}"
        lines.append(block)
    return "\n".join(lines)


def pick_by_kind(items: List[Dict[str, Any]], kind: str) -> Optional[Dict[str, Any]]:
    """按 ``kind`` 挑一条（给"空转兜底"用：必须给内容时优先给哪类）。"""
    for item in items:
        if item["kind"] == kind:
            return item
    return items[0] if items else None


def content_stats() -> Dict[str, Any]:
    """载入情况（自检 / 日志用）。"""
    directions = _load_directions()
    return {
        "directions": len(directions),
        "items": sum(len(d["items"]) for d in directions),
        "detail": list_directions(),
    }
