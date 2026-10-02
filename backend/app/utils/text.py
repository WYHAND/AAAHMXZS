"""文本处理工具。

- 6.6 语境：字数控制（7.7 输出 ≤300 字）
- 7.7：过渡语模板本地维护 30 条，随机选择
"""

from __future__ import annotations

import random
import re
import unicodedata
from typing import Iterable, List, Optional

# 7.7 输出 ≤300 字：后端兜底截断
MAX_ASSISTANT_CHARS = 300

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


def looks_like_refusal(text: str) -> bool:
    """7.6：用户拒绝回答时跳过并切换话题。"""
    if not text:
        return False
    keywords = ("不想说", "不想回答", "跳过", "换个话题", "不方便", "没什么好说", "下一个")
    return any(k in text for k in keywords)


def looks_like_stuck(text: str) -> bool:
    """7.6：用户答不上来时给提示思路。"""
    if not text:
        return True
    keywords = ("不知道", "不清楚", "没想过", "答不上", "不会", "说不好")
    stripped = text.strip()
    return any(k in stripped for k in keywords) and len(stripped) <= 20


def top_keywords(text: str, top_n: int = 10, vocabulary: Optional[Iterable[str]] = None) -> List[str]:
    """极简关键词命中（11.8 ATS 评分的规则部分，附录F 岗位关键词库）。

    只做“词表逐个 in 判断”，不做分词——手册 2.5 明确不引入额外 NLP 依赖。
    """
    if not text or not vocabulary:
        return []
    hits = [word for word in vocabulary if word and word.lower() in text.lower()]
    return hits[:top_n]


# 过渡语模板 30 条（7.7）
TRANSITION_PHRASES: List[str] = [
    "嗯，我理解了。",
    "这个点挺关键的。",
    "听起来你已经想过一些了。",
    "好，我们顺着这条线再聊聊。",
    "有意思，我想多问一句。",
    "明白了，那我们换个角度看看。",
    "这点很多人都会卡住，很正常。",
    "谢谢你说得这么具体。",
    "我大概有感觉了。",
    "这块可以再深一点。",
    "嗯嗯，然后呢？",
    "我们先不急着下结论。",
    "你这个经历其实挺有用。",
    "有点好奇你当时的感受。",
    "那我们把这个拆开说说。",
    "我注意到一个细节。",
    "先夸一句，这个思路不错。",
    "明白，这个顾虑很真实。",
    "我们试试从另一头想。",
    "好，我记得了。",
    "这个方向我们可以继续。",
    "你说到点子上了。",
    "我换个问法试试。",
    "嗯，先记下来。",
    "那我们稍微跳一下话题。",
    "这点和你之前说的能对上。",
    "慢慢来，不着急。",
    "我想确认一下我的理解。",
    "这个反差挺有意思。",
    "好，我们进入下一步。",
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
