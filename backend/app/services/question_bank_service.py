"""真实面试题库检索（岗位方向 × 场景）。

为什么要有这个模块：模拟面试原先由 DeepSeek **凭空出题**（见
``ai/prompts/interview_question.txt`` 的旧版），题面又空又泛。现在改成
**先从本题库按「目标岗位 -> 方向」捞出真实候选题**，再交给模型挑选、
贴合简历改写（题目骨架是真的，个性化交给 AI）。

题库是纯数据文件：``app/ai/question_bank/*.json``，每个文件一个方向：:

    {
      "id": "frontend", "name": "前端",
      "aliases": ["前端", "vue", "react", ...],
      "sources": ["haizlin/fe-interview", ...],
      "questions": [
        {"id": "fe-tech-01", "scene": "技术", "level": "基础",
         "question": "...", "intent": "...", "reference_points": ["..."]}
      ]
    }

- 题目为社区公开面经/八股的**事实性问题引用**，考察点与参考要点为本项目自写；
- ``scene`` 取值与既有约定一致：``HR`` / ``项目`` / ``技术``；
- ``general.json``（id=general）不参与方向匹配，只在对应场景下作补充。
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.utils.logger import get_logger

logger = get_logger(__name__)

BANK_DIR = Path(__file__).resolve().parent.parent / "ai" / "question_bank"

GENERAL_ID = "general"

VALID_SCENES = ("HR", "项目", "技术")

# 出题时给模型的候选池大小（远大于实际题数，留给模型挑选空间）
CANDIDATE_LIMIT = 20

_NORMALIZE_RE = re.compile(r"[\s\-_/·、,，.。()（）【】\[\]|]+")


# ---------------------------------------------------------------------------
# 载入
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_directions() -> List[Dict[str, Any]]:
    """读取题库目录下所有 ``*.json``（带缓存）。坏文件只记日志、不打断启动。"""
    directions: List[Dict[str, Any]] = []
    if not BANK_DIR.exists():
        logger.error("面试题库目录不存在: %s", BANK_DIR)
        return directions

    for path in sorted(BANK_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("面试题库文件解析失败 %s: %s", path.name, exc)
            continue

        questions = [q for q in (data.get("questions") or []) if q.get("question")]
        if not questions:
            logger.warning("面试题库文件没有有效题目，已跳过: %s", path.name)
            continue

        directions.append(
            {
                "id": str(data.get("id") or path.stem),
                "name": str(data.get("name") or path.stem),
                "aliases": [str(a) for a in (data.get("aliases") or [])],
                "questions": questions,
            }
        )

    logger.info("面试题库载入完成：%s 个方向 / %s 道题",
                len(directions), sum(len(d["questions"]) for d in directions))
    return directions


def reload_bank() -> None:
    """清缓存（题库改版后热加载 / 测试用）。"""
    _load_directions.cache_clear()
    _alias_index.cache_clear()


@lru_cache(maxsize=1)
def _alias_index() -> List[tuple]:
    """``(normalized_alias, len, direction)``，按 alias 长度倒序（长别名优先）。"""
    items: List[tuple] = []
    for direction in _load_directions():
        if direction["id"] == GENERAL_ID:
            continue  # 通用库不参与匹配
        for alias in [direction["name"], *direction["aliases"]]:
            normalized = _normalize(alias)
            if normalized:
                items.append((normalized, len(normalized), direction))
    items.sort(key=lambda item: item[1], reverse=True)
    return items


def _normalize(text: str) -> str:
    """去空格/常见标点并转小写，便于“前端开发工程师”匹配到别名“前端开发”。"""
    return _NORMALIZE_RE.sub("", (text or "").lower())


def _direction_by_id(direction_id: str) -> Optional[Dict[str, Any]]:
    for direction in _load_directions():
        if direction["id"] == direction_id:
            return direction
    return None


# ---------------------------------------------------------------------------
# 匹配
# ---------------------------------------------------------------------------

def match_direction(target_job: Optional[str]) -> Optional[Dict[str, Any]]:
    """把用户**自由填写**的职位映射到题库方向；匹配不到返回 ``None``。

    规则（避免误匹配）：
    - 长别名优先（“大模型算法”先于“大模型”先于“算法”）；
    - 非 ASCII（中文）别名或长度 >= 3 的别名用**子串**匹配；
    - 长度 < 3 的纯 ASCII 别名（如 ``pm`` / ``ai`` / ``bi``）只在**完全相等**时匹配，
      否则 "mobile developer" 会因为含 ``bi`` 被误判成数据分析。
    """
    key = _normalize(target_job or "")
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
    """方向清单（供调试 / 未来做界面下拉用）。"""
    return [{"id": d["id"], "name": d["name"]} for d in _load_directions()]


# ---------------------------------------------------------------------------
# 检索
# ---------------------------------------------------------------------------

def _by_scene(direction: Dict[str, Any], scene: str) -> List[Dict[str, Any]]:
    """取某方向某场景的题，并按「基础/进阶交替」排列，保证候选池难度分布。"""
    questions = [q for q in direction["questions"] if q.get("scene") == scene]
    basic = [q for q in questions if q.get("level") != "进阶"]
    advanced = [q for q in questions if q.get("level") == "进阶"]
    ordered: List[Dict[str, Any]] = []
    for index in range(max(len(basic), len(advanced))):
        if index < len(basic):
            ordered.append(basic[index])
        if index < len(advanced):
            ordered.append(advanced[index])
    return ordered


def retrieve(target_job: Optional[str], scene: str, limit: int = CANDIDATE_LIMIT) -> Dict[str, Any]:
    """按「目标岗位 + 场景」检索候选真题。

    返回 ``{"direction": 方向名 | None, "questions": [...]}``。
    匹配不到方向时退化为通用题库，**不会**把无关方向的题硬塞进来。
    """
    if scene not in VALID_SCENES:
        scene = "HR"

    direction = match_direction(target_job)
    general = _direction_by_id(GENERAL_ID)

    pool: List[Dict[str, Any]] = []
    seen = set()

    def add(questions: List[Dict[str, Any]]) -> None:
        for question in questions:
            qid = question.get("id")
            if not qid or qid in seen:
                continue
            seen.add(qid)
            pool.append(question)

    if direction:
        add(_by_scene(direction, scene))
    if general:
        add(_by_scene(general, scene))

    if not pool and general:
        # 该方向在这个场景下没有题（如"运营"没有技术题）——退到通用的全部场景
        add(general["questions"])

    if not pool:
        # 完全没有候选（题库缺失）——最后手段：所有方向的该场景题
        for item in _load_directions():
            add(_by_scene(item, scene))

    return {
        "direction": direction["name"] if direction else None,
        "questions": pool[:limit],
    }


def format_candidates(questions: List[Dict[str, Any]]) -> str:
    """把候选题拼成给模型看的文本（一问一行，带考察点与参考要点）。"""
    lines: List[str] = []
    for index, question in enumerate(questions, start=1):
        points = "；".join(str(p) for p in (question.get("reference_points") or []))
        lines.append(
            f"{index}. [{question.get('level', '')}·{question.get('scene', '')}] "
            f"{question.get('question', '')}\n"
            f"   考察点：{question.get('intent', '')}\n"
            f"   参考要点：{points}"
        )
    return "\n".join(lines)


def pick_fallback(target_job: Optional[str], scene: str, count: int) -> List[Dict[str, Any]]:
    """AI 出题失败时的**真实题库兜底**（优于原先的通用兜底题）。

    返回 ``InterviewQuestionItem`` 能直接校验的 dict 列表。
    """
    result = retrieve(target_job, scene, limit=max(count, 1))
    items: List[Dict[str, Any]] = []
    for index, question in enumerate(result["questions"][:count], start=1):
        items.append(
            {
                "order": index,
                "content": question.get("question", ""),
                "intent": question.get("intent", ""),
                "reference_points": list(question.get("reference_points") or []),
            }
        )
    return items
