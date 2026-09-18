"""阶段判定与画像分数计算（手册 1.3 / 11.3 / 附录B）。

- total = 0.4*clarity + 0.35*action + 0.25*resume
- 0-30 探索期，31-65 准备期，66-100 冲刺期
"""

from __future__ import annotations

from typing import Dict, Optional, Tuple

WEIGHT_CLARITY = 0.40
WEIGHT_ACTION = 0.35
WEIGHT_RESUME = 0.25

STAGE_EXPLORE = "探索期"
STAGE_PREPARE = "准备期"
STAGE_SPRINT = "冲刺期"

STAGE_BOUNDARIES: Tuple[Tuple[float, float, str], ...] = (
    (0.0, 30.0, STAGE_EXPLORE),
    (30.000001, 65.0, STAGE_PREPARE),
    (65.000001, 100.0, STAGE_SPRINT),
)


def clamp_score(value: float, low: float = 0.0, high: float = 100.0) -> float:
    """分数收敛到 [0,100]。"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return low
    return max(low, min(high, number))


def calc_total_score(clarity: float, action: float, resume: float) -> float:
    """附录B 加权总分。"""
    total = WEIGHT_CLARITY * clamp_score(clarity) + WEIGHT_ACTION * clamp_score(action) \
        + WEIGHT_RESUME * clamp_score(resume)
    return round(clamp_score(total), 2)


def calc_stage(total_score: float) -> str:
    """附录B 阶段判定（含年级辅助修正 ≤10%，此处只做分区间判定）。"""
    score = clamp_score(total_score)
    for low, high, stage in STAGE_BOUNDARIES:
        if low <= score <= high:
            return stage
    return STAGE_SPRINT if score > 65 else STAGE_EXPLORE


def calc_profile_scores(clarity: float, action: float, resume: float) -> Dict[str, object]:
    """一次算出总分与阶段，返回可直接写库的字典。"""
    total = calc_total_score(clarity, action, resume)
    return {
        "clarity_score": clamp_score(clarity),
        "action_score": clamp_score(action),
        "resume_score": clamp_score(resume),
        "total_score": total,
        "stage": calc_stage(total),
    }


# ---------------------------------------------------------------------------
# 阶段 slug（前端契约用）
# ---------------------------------------------------------------------------
# 数据库里存的是中文阶段名（手册 5.3：探索期/准备期/冲刺期），
# 前端路由与样式用小写英文 slug，这里做一层唯一映射，避免前端各自硬编码。
STAGE_SLUGS: Dict[str, str] = {
    STAGE_EXPLORE: "explore",
    STAGE_PREPARE: "prepare",
    STAGE_SPRINT: "sprint",
}

STAGE_LABELS: Dict[str, str] = {
    "explore": STAGE_EXPLORE,
    "prepare": STAGE_PREPARE,
    "sprint": STAGE_SPRINT,
}


def to_stage_slug(stage: Optional[str]) -> str:
    """中文阶段 -> ``explore`` / ``prepare`` / ``sprint``。

    未知值一律返回 ``explore``（与"新用户默认探索期"一致，保证前端永远拿到合法 slug）。
    """
    if not stage:
        return "explore"
    if stage in STAGE_SLUGS:
        return STAGE_SLUGS[stage]
    lowered = str(stage).strip().lower()
    return lowered if lowered in STAGE_LABELS else "explore"


def to_stage_label(slug: Optional[str]) -> str:
    """slug -> 中文阶段名（反向，供需要展示中文的场景）。"""
    if not slug:
        return STAGE_EXPLORE
    return STAGE_LABELS.get(str(slug).strip().lower(), STAGE_EXPLORE)
