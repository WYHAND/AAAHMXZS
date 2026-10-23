"""文本处理工具。

- 6.6 语境：字数控制（7.7 输出上限，见下面 ``MAX_ASSISTANT_CHARS``）
- 7.7：过渡语模板本地维护 30 条，随机选择（⚠️ 当前无调用方，见该常量上方说明）
"""

from __future__ import annotations

import random
import re
import unicodedata
from typing import Iterable, List, Optional

# 助手回复的**硬上限**（字符）。
#
# ⚠️ 2026-11（勘误 9.31 / 9.32 / 9.35）：
# - 原值 **300** → 9.32 因"讲就业情况"放开到 **1500**；
# - 9.35 用户又反馈「说的有点多了……要提炼重点说」→ 收到 **800**。
# 现在的口径：**默认短**（prompt 里要求一般 3-4 句、约 200 字以内），
# 800 只是"防止跑飞"的硬闸；他明确要求「详细讲讲」时也够用。
MAX_ASSISTANT_CHARS = 800

# 7.7 对话超过 5 轮无新信息时切换挖掘维度（口径由 chat_system.txt 的规则落地，本常量仅备注）
MAX_ROUNDS_WITHOUT_NEW_INFO = 5


def truncate(text: str, limit: int = MAX_ASSISTANT_CHARS, suffix: str = "……") -> str:
    """按字数截断（中文按字符计），尽量在句末断开。"""
    if not text:
        return ""
    text = text.strip()
    if len(text) <= limit:
        return text
    window = text[: max(0, limit - len(suffix))]
    # 找最后一个句末标点，避免截到半个句子
    for idx in range(len(window) - 1, max(0, len(window) - 40), -1):
        if window[idx] in "。！？!?；;\n":
            return window[: idx + 1]
    return window + suffix


def clean_whitespace(text: str) -> str:
    """压缩多余空白，去掉首尾空行。"""
    if not text:
        return ""
    text = re.sub(r"[ \t\u3000]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def count_chinese_chars(text: str) -> int:
    """统计汉字数量（画像抽取时判断信息量用）。"""
    return len(re.findall(r"[\u4e00-\u9fff]", text or ""))


# ⚠️ 2026-11（勘误 9.31）：这里原先还有 ``looks_like_refusal()`` / ``looks_like_stuck()``
# 两个判据，配合 ``chat_service._shortcut_reply()`` 让"拒绝回答 / 答不上来"**不调模型**、
# 直接回本地模板。那两个模板已删（同一句话会一字不差地重复，而且把手册规则 11
# "答不上来就给具体台阶"变成了"换一道题再问"）—— 现在这两类输入**一律交回模型**，
# 判据也随之删除，避免留下"看着像在用、其实没人调"的死代码。
# （对话路径现在只在"整段回复又短又只是个问句"时做一次空转校验，
# 那件事在 ``chat_director.looks_like_empty_turn``，与本文件无关。）


# 过渡语模板 30 条（7.7）
#
# ⚠️ 2026-10 顺语气：清掉了原先几条"教练腔/系统腔"（"谢谢你说得这么具体。"
# "我想确认一下我的理解。" "先夸一句，这个思路不错。" "好，我们进入下一步。"），
# 换成更像随口接话的说法；条数保持 30（手册 7.7 写的就是 30 条）。
#
# ⚠️ 2026-11（勘误 9.31）：**本池子当前没有任何调用方**。它原先只服务
# ``fallbacks.refusal_reply()`` / ``stuck_reply()``（"拒绝回答 / 答不上来"的本地模板），
# 那两个模板已删。池子按手册 7.7"本地维护 30 条"的要求**保留**，不删；
# 但它不是"可以随手拼进 AI 回复"的素材 —— 过渡语是"接用户上一句"的反应句，
# AI 失败时没有那一句可接，硬拼会文不对题（勘误 9.27 已实测过这个错配）。
TRANSITION_PHRASES: List[str] = [
    "嗯，我听着呢。",
    "这个点挺关键的。",
    "听起来你其实想过一些了。",
    "行，那咱顺着这条线再聊两句。",
    "有意思，我还想多问一句。",
    "明白了，那换个角度看看。",
    "这块很多人都会卡，正常。",
    "你这么说我就懂了。",
    "我大概有感觉了。",
    "这个可以再往深了聊一点。",
    "嗯嗯，然后呢？",
    "先不急着下结论。",
    "你这段经历其实挺有用。",
    "我有点好奇你当时的感受。",
    "那把这个拆开说说。",
    "我留意到一个细节。",
    "这个思路我觉得挺行。",
    "明白，这个顾虑挺真实的。",
    "要不从另一头想想。",
    "好，我记下了。",
    "这个方向可以接着聊。",
    "你说到点子上了。",
    "我换个问法试试。",
    "嗯，先放这儿。",
    "那咱稍微跳一下话题。",
    "这个跟前面聊的能接上。",
    "慢慢来，不着急。",
    "我捋一下，看理解得对不对。",
    "这个反差还挺有意思。",
    "行，那接着往下说。",
]


def random_transition(exclude: Optional[str] = None) -> str:
    """随机取一条过渡语（7.7）。"""
    pool = [p for p in TRANSITION_PHRASES if p != exclude] or TRANSITION_PHRASES
    return random.choice(pool)


def normalize_for_match(text: str) -> str:
    """把文本压成"只留内容"的形式，用于**宽松但机械**的子串比对。

    做三件事（都是实测必需的，不是洁癖）：
    1. **去所有空白**：用户写"我其实会 java 和 C 语言"、模型抄成"我其实会java和C语言"，
       只差空格；模型改写时几乎一定会动空白。
    2. **全角 -> 半角**（NFKC）：用户/模型混用全角英数与标点（"ＡＩ" / "AI"、"１" / "1"）。
    3. **小写化**：ASCII 大小写不该影响命中（实测有用户两次分别写"ai"和"AI"）。

    ⚠️ 只做这层归一化，**不做**同义改写/分词/编辑距离 —— 本函数的所有调用点都用来判断
    "这段文本到底有没有原样出现过"，模糊化会直接把"没说过"判成"说过"。
    """
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKC", str(text))
    normalized = re.sub(r"\s+", "", normalized)
    return normalized.lower()


def contains_text(haystack: str, needle: str) -> bool:
    """``needle`` 是否**原样出现**在 ``haystack`` 里（按 :func:`normalize_for_match` 归一化）。

    用于两处方向相反的判断：
    - 证据归属：用户原话（needle）是否出现在某条用户消息（haystack）里；
    - 开场白/对话校验：素材（needle）是否出现在模型写的那句话（haystack）里。
    """
    key = normalize_for_match(needle)
    if not key:
        return False
    return key in normalize_for_match(haystack)


def build_history_text(messages: Iterable[object], limit: int = 20) -> str:
    """把消息列表拼成纯文本，供画像抽取 Prompt 使用。

    ``messages.content`` 只存纯原话（幂等 id 在 ``Message.client_msg_id`` 列上），
    因此这里**不需要任何 strip**。
    """
    lines: List[str] = []
    for msg in list(messages)[-limit:]:
        role = getattr(msg, "role", "user")
        content = getattr(msg, "content", "")
        speaker = {"user": "学生", "assistant": "AI", "system": "系统"}.get(role, role)
        lines.append(f"{speaker}：{clean_whitespace(content)}")
    return "\n".join(lines)
