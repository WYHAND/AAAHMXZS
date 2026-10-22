"""AI 兜底模板与默认值（《开发手册》7.6 / 7.7）。

7.6 兜底策略：
- DeepSeek 调用失败 -> 返回模板回复，不报错
- 结构化输出解析失败 -> 重试 1 次，仍失败用默认值（默认值定义在 app/ai/schemas.py）
- 用户拒绝回答 -> 跳过，切换话题
- 用户答不上来 -> 给提示思路
"""

from __future__ import annotations

import random
from typing import Final, List, Optional

from app.utils.text import random_transition

# 默认温度（7.1 示例给的是 0.7，结构化输出用 0.2）
DEFAULT_TEMPERATURE: Final[float] = 0.7
STRUCTURED_TEMPERATURE: Final[float] = 0.2

# 7.6：AI 调用失败时的模板回复（不报错，也不让用户干等）
#
# ⚠️ 2026-10 顺语气：这三条原来都是"先安抚一句 + 立刻把话头拽回就业"的顾问腔
# （"先说一句辛苦你了""你最近为了就业做过哪一件具体的事？"），和 chat_system.txt
# 那轮重构发现的问题一样 —— 目的性太露。现在只保留"照实说卡了一下 + 递一个轻的话头"。
FALLBACK_CHAT_REPLY: Final[str] = (
    "刚卡了一下，我缓过来了。\n"
    "要不先随便聊两句 —— 你最近手头在忙些什么？"
)

# 7.6：用户拒绝回答 —— 跳过就真跳过，别马上换个问法接着盘
REFUSAL_REPLY: Final[str] = (
    "没问题，那咱先不聊这个。\n"
    "换个轻松的 —— 你平时不上课的时候一般都在干嘛？"
)

# 7.6：用户答不上来 -> 给提示思路（问的是一件具体的事，不是让他做选择题）
STUCK_REPLY: Final[str] = (
    "想不出来太正常了，别硬想。\n"
    "我换个问法 —— 你平时做小组作业，最愿意主动揽哪一块？"
)

# 7.7：对话结束但信息不足时的结论卡片兜底
FALLBACK_CONCLUSION: Final[dict] = {
    "summary": "这次聊得还比较浅，先记下你提到的一些线索。",
    "pain_points": ["职业方向还不清晰"],
    "suggestions": ["再多聊两轮", "做一次基础测试表"],
    "next_actions": ["完成基础测试表", "再聊 5 分钟你感兴趣的方向"],
}


def transition() -> str:
    """随机取一条过渡语（7.7 本地维护 30 条）。"""
    return random_transition()


def refusal_reply() -> str:
    return f"{transition()}{REFUSAL_REPLY}"


def stuck_reply() -> str:
    return f"{transition()}{STUCK_REPLY}"


def fallback_reply() -> str:
    """AI 调用失败的兜底话术。

    ⚠️ 2026-10：这里**不再**前置 ``transition()``。过渡语是"接用户上一句"的反应句
    （"我大概有感觉了。"），而 AI 失败时并没有一句用户的话可供承接，随机拼上去经常
    文不对题（"这个反差还挺有意思。刚卡了一下…"）。拒绝/答不上来这两条保留过渡语 ——
    那两种场景确实是在回应他刚说的内容。
    """
    return FALLBACK_CHAT_REPLY


def fallback_tags() -> List[dict]:
    """7.6：结构化输出完全失败时的标签默认值（空列表，不做无根据的画像写入）。"""
    return []


# ---------- 新会话「AI 先开口」的模板开场白（7.6 兜底在开场场景的落地） ----------
# 开场白比普通回复更怕模型失败：用户第一眼看到的就是它，
# 所以这里给本地模板，保证 AI 不可用时开场仍然是「像人随口问的一句话」。
#
# ⚠️ 历史（三段，别再退回去）：
# 1. 最早是「A 还没开始 / B 做了一半 / C 已经完成，直接回字母就行」那种**选择题腔**，
#    被用户明确否掉（"这和让用户做选择题有什么区别"）；
# 2. 之后改成"有进行中任务 > 有画像标签 > 全新用户"三档，**引用任务标题/标签**——
#    用户又否掉了这一版：新对话的**第一句话坚决不可以问画像里的东西**
#    （他截图的现场就是「新对话｜你之前说想学ai，这块是怎么来的？」）。
#    原话：「可以问，但是坚决不可以直接在第一句话的时候问」「第一个问题可以随便聊聊天，
#    比如你今年大几了、你今天上的什么课啊」「要重视新对话这个问题」。
# 3. **现在这三条全部是日常搭话**，一个字都不涉及用户的画像/任务/原话（与
#    ``chat_opening.txt`` 同一套约束：一句话、≤60 字、只问一件事、绝不出现选项、不聊职业向话题）。
#    因此 ``opening_fallback()`` 不再接受任何素材参数 —— 开场白本来就没有素材可用。
# 改这里的文案前请先看 app/ai/prompts/chat_opening.txt。

OPENING_FALLBACK_GREETING: Final[str] = "嗨，今天过得咋样？"

OPENING_FALLBACK_CLASS: Final[str] = "你今天上什么课了呀？"

OPENING_FALLBACK_GRADE: Final[str] = "你今年大几啦？"

# 三档 = 三条**等价**的日常开场（选哪条与用户背景无关，只为了让重试/多次兜底不至于一模一样）。
OPENING_FALLBACK_VARIANTS: Final[tuple] = (
    OPENING_FALLBACK_GREETING,
    OPENING_FALLBACK_CLASS,
    OPENING_FALLBACK_GRADE,
)


def opening_fallback(variant: Optional[int] = None) -> str:
    """AI 不可用时的开场白模板（**纯日常搭话**，不含任何画像素材）。

    ⚠️ 刻意**不接受** ``task_title`` / ``tag_label`` 之类的素材参数：
    第一句话不许涉及画像标签、进行中任务、用户原话（见 ``chat_opening.txt``）。
    传进来的素材只会被"顺口念出来"，而那正是用户明确禁止的行为。

    :param variant: 指定第几档（0/1/2，越界取模）；不给就随机选一条 ——
        三条都是等价的日常开场，随机只为让"同一台机器上连开几个新会话"不至于完全相同。
    """
    if variant is None:
        return random.choice(OPENING_FALLBACK_VARIANTS)
    return OPENING_FALLBACK_VARIANTS[variant % len(OPENING_FALLBACK_VARIANTS)]
