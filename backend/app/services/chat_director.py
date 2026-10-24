"""对话"供料层"：给模型递素材、告诉它走到哪一步、划三条硬边界。

## 它是干什么的（以及不再是干什么的）

2026-11 用户拍板原话：「我只要活人感，要有思考，要给用户分析就业情况，要引导用户选择他要学什么，
**约束不要太多**」；同时他对"本轮该怎么走"的指令式设计说了「**删**」。

所以这个模块**从"导演"降级为"供料"**。现在只做三件事：

1. **供料**：按方向（他的专业 / 画像）捞就业内容素材，并**机械剔掉这个会话已经讲过的那几条**
   （判据与开场白去重、任务主题剔除共用 ``looks_referenced``，见 ``reference_match``）；
2. **报路况**：告诉他这段对话**已经走到哪一步**（认识 → 专业 → 画面 → 想要什么 → 方案），
   以及**目的地**是什么 —— 但**不规定这一轮该说哪句话**；
3. **划底线**（只有三条）：不许编数字、讲过的不再讲、不许只复述他的话再抛一个问题。

⚠️ **已经删掉的东西，别再往回加**（那是"机器人感"的来源）：
- 每轮指定 ``intent``（"这轮必须给内容"/"这轮只能提问"）；
- 每轮抽签 ``angle``（"先说结论再解释"这种形式指令）；
- 按轮次强制的频次硬闸（"连续两轮只问就必须给内容"）。

理由：这些都在**替模型决定怎么说话**，而措辞自由度恰恰是"活人感"的唯一来源。
现在的分工是 —— **服务端保证"有料可用、别重复、别编"，模型负责"怎么说、说什么、怎么顺着他说"**。

## 随机性还在吗

在，但只剩一处、也是该有的那一处：**素材抽样**。同一个会话里，模型每次拿到的候选是
从"还没讲过的"里随机抽的（``random.sample``），所以两段对话的讲法不会一模一样。
至于"每轮是不是又变成了同一个句式"，交给模型自己 —— 它换了更强的模型（``deepseek-v4-pro``）
并开着思考，这件事本来就该是它的活。
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.services import career_content_service
from app.utils.logger import get_logger
from app.utils.reference_match import drop_referenced, looks_referenced

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# 判据词表（都是"用户真的这么说过"的形态，不是设计想象）
# ---------------------------------------------------------------------------

# 明确不想聊这件事：这只用来**告诉模型他现在是什么状态**（别硬追），不再触发任何脚本
_REFUSAL_HINTS = (
    "不想说", "不想回答", "不想聊", "跳过", "换个话题", "换一个话题", "不方便",
    "没什么好说", "没什么好聊", "别问了", "下一个", "算了",
)

_EMOTION_HINTS = (
    "焦虑", "烦", "压力", "迷茫", "害怕", "难受", "崩溃", "慌", "没底",
    "担心", "不知道怎么办", "顶不住", "累",
)

_STUCK_HINTS = ("不知道", "不清楚", "没想过", "答不上", "不会", "说不好", "没想法", "没概念", "想不出来")

_ASK_HINTS = (
    "?", "？", "怎么", "为什么", "有什么用", "到底", "该学", "学什么", "能干嘛",
    "能干什么", "是什么", "讲讲", "说说", "教我", "怎么样", "好不好", "值不值",
)

# 他在说"想要什么"（推进到第四步的信号）
_GOAL_HINTS = (
    "赚钱", "钱多", "稳定", "考公", "考研", "考编", "回家", "老家", "躺", "兴趣",
    "喜欢", "想做出", "创业", "加班", "体制", "编制", "出国", "读研",
)

# 两条硬边界（服务端唯一的"不许"，写在这里是为了让它漏不进 Prompt）
HARD_LINES = [
    "素材里没有的数字（薪资、就业率、招多少人、哪家公司缺人）一个字都不许说。",
    "讲过的不再讲第二遍 —— 换个说法重讲一遍也算重复。",
]

# 每轮最多给几条素材（多了模型就会"每条念一句"，反而没重点）
# ⚠️ 2026-11（勘误 9.35）：3 → **2**。用户反馈"说得有点多，要提炼重点"，而素材条数是
# 最直接的杠杆：给 3 条它就忍不住各讲一句，给 2 条才容易只挑一个点说。
MATERIAL_LIMIT = 2


@dataclass
class TurnBrief:
    """这一轮给模型的"料"（纯数据：要跨 Session 传，不能带 ORM 对象）。

    ⚠️ 刻意**不含** "这轮该说哪句话" 之类的指令 —— 那部分已按用户要求删掉。
    """

    step: str
    user_state: str
    direction: Optional[str] = None
    materials: List[Dict[str, Any]] = field(default_factory=list)
    given_rounds: int = 0
    reason: str = ""

    def as_prompt_block(self) -> str:
        """渲染成注入 system 的块：只给素材和两条事实底线，不规定怎么说。"""
        lines = [
            "【这一轮你手边有什么（服务端给的料，不是命令）】",
        ]
        if self.materials:
            lines.append(
                "· 可以用的素材（⚠️ **是给你自己看的提纲，不是稿子**：挑不挑、挑几条、怎么讲，"
                "都由你判断；整段搬 = 一次说太多）："
            )
            lines.append(career_content_service.format_materials(self.materials))
        else:
            lines.append(
                "· 这个方向的素材他基本都听过了：你可以照自己对这个方向的了解讲，"
                "也可以顺着他的话聊别的，别把讲过的东西再讲一遍。"
            )
        lines.append("· 只有这两条是硬的：")
        lines.extend(f"  {index}. {text}" for index, text in enumerate(HARD_LINES, start=1))
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# 状态 / 进度（只用于"报路况"，不再驱动任何脚本）
# ---------------------------------------------------------------------------

def user_state(text: str) -> str:
    """他这句话是什么状态（顺序即优先级，别调换）。"""
    stripped = (text or "").strip()
    if not stripped:
        return "敷衍"
    if any(hint in stripped for hint in _REFUSAL_HINTS):
        return "拒绝"
    if any(hint in stripped for hint in _EMOTION_HINTS):
        return "情绪"
    if any(hint in stripped for hint in _STUCK_HINTS) and len(stripped) <= 20:
        return "卡住"
    if any(hint in stripped for hint in _ASK_HINTS):
        return "要东西"
    if len(stripped) <= 6:
        return "敷衍"
    return "在讲具体的事"


def _direction_name(profile_text: str, user_texts: Sequence[str]) -> Optional[str]:
    """认出方向：**先看画像/任务**（已经沉淀的结论），再看他说过的话。

    先看画像的理由：他这轮可能只说"还行"+一个方向词都没有，但画像里早就写着"计算机"
    —— 那时也该按计算机给他讲，而不是退回通用素材。
    """
    matched = career_content_service.match_direction(profile_text)
    if matched:
        return matched["name"]
    for text in reversed(list(user_texts)):  # 从最新的话往回找
        matched = career_content_service.match_direction(text)
        if matched:
            return matched["name"]
    return None


def _content_rounds(direction_name: Optional[str], assistant_texts: Sequence[str]) -> int:
    """本会话**已经讲过的素材条数**（机械反推，不用加表/加列）。

    判据与开场白去重、任务主题剔除**共用** ``looks_referenced``，但探针用
    ``career_content_service.item_probe()``（要点串）而**不是标题** —— 同组标题长得太像，
    拿标题当探针会把整组素材一次剔光（自检脚本抓出来的真问题）。
    """
    pool = career_content_service.retrieve(direction_name or "", limit=999)["items"]
    given = {
        item["id"]
        for item in pool
        if any(looks_referenced(career_content_service.item_probe(item), t) for t in assistant_texts)
    }
    return len(given)


def _knows_goal(user_texts: Sequence[str], profile_text: str) -> bool:
    joined = " ".join([*user_texts, profile_text])
    return any(hint in joined for hint in _GOAL_HINTS)


def _step(has_direction: bool, turn_index: int, content_rounds: int, knows_goal: bool) -> str:
    """对话走到弧线的第几步（服务端推的，用来"报路况"）。

    弧线就四步（``chat_system.txt`` 顶部）：认识这个人 → 摸清专业 →
    让他看清这条路什么样 → 摸清他想要什么 → 给"接下来学什么"。
    """
    if not has_direction:
        return "认识" if turn_index <= 1 else "专业"
    if content_rounds == 0:
        return "画面"
    if content_rounds == 1:
        return "画面（加深）"
    if not knows_goal:
        return "想要什么"
    return "方案"


# ---------------------------------------------------------------------------
# 供料
# ---------------------------------------------------------------------------

def brief_turn(
    user_message: str,
    history: Sequence[Tuple[str, str]],
    profile_text: str = "",
    *,
    rng: Optional[random.Random] = None,
) -> TurnBrief:
    """算出这一轮的"料"（纯函数：同样输入 + 同样 rng = 同样结果）。

    :param user_message: 用户这轮说的话
    :param history: ``(role, content)`` 序列（按时间正序，含这轮用户消息）
    :param profile_text: 画像/任务里能用来认方向的文本（标签 label + 用户原话证据 + 任务标题）
    """
    picker = rng or random
    state = user_state(user_message)

    user_texts = [content for role, content in history if role == "user"]
    assistant_texts = [content for role, content in history if role == "assistant"]
    turn_index = len(assistant_texts)

    direction_name = _direction_name(profile_text, user_texts)
    rounds = _content_rounds(direction_name, assistant_texts)
    step = _step(bool(direction_name), turn_index, rounds, _knows_goal(user_texts, profile_text))

    # 素材：先按"讲过没有"机械剔除，再随机抽几条（这就是保留的那一处随机性）
    pool = career_content_service.retrieve(direction_name or "", limit=999)["items"]
    probes = [career_content_service.item_probe(item) for item in pool]
    kept_probes, dropped_probes = drop_referenced(probes, assistant_texts)
    kept = [item for item in pool if career_content_service.item_probe(item) in set(kept_probes)]
    materials = picker.sample(kept, min(MATERIAL_LIMIT, len(kept))) if kept else []

    brief = TurnBrief(
        step=step,
        user_state=state,
        direction=direction_name,
        materials=materials,
        given_rounds=rounds,
        reason=f"状态={state}；步骤={step}；已讲={rounds}条；剔除={len(dropped_probes)}条",
    )
    logger.info(
        "对话供料 brief：step=%s state=%s direction=%s materials=%s | %s",
        brief.step, brief.user_state, brief.direction,
        [item["id"] for item in brief.materials], brief.reason,
    )
    return brief


def content_stats_hint() -> str:
    """给日志 / 自检用的一句话（当前素材库规模）。"""
    stats = career_content_service.content_stats()
    return f"就业内容素材：{stats['directions']} 个方向 / {stats['items']} 条"


__all__ = [
    "TurnBrief",
    "brief_turn",
    "user_state",
    "content_stats_hint",
    "HARD_LINES",
]
