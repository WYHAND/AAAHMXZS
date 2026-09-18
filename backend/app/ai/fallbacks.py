"""AI 兜底模板与默认值（《开发手册》7.6 / 7.7）。

7.6 兜底策略：
- DeepSeek 调用失败 -> 返回模板回复，不报错
- 结构化输出解析失败 -> 重试 1 次，仍失败用默认值（默认值定义在 app/ai/schemas.py）
- 用户拒绝回答 -> 跳过，切换话题
- 用户答不上来 -> 给提示思路
"""

from __future__ import annotations

from typing import Final, List

from app.utils.text import random_transition

# 默认温度（7.1 示例给的是 0.7，结构化输出用 0.2）
DEFAULT_TEMPERATURE: Final[float] = 0.7
STRUCTURED_TEMPERATURE: Final[float] = 0.2

# 7.6：AI 调用失败时的模板回复（不报错，也不让用户干等）
FALLBACK_CHAT_REPLY: Final[str] = (
    "我这边刚刚卡了一下，先说一句辛苦你了。\n"
    "我们可以先聊点具体的：你最近为了就业做过哪一件具体的事？"
    "哪怕只是改了一次简历、问过一个人，都算。"
)

# 7.6：用户拒绝回答
REFUSAL_REPLY: Final[str] = (
    "没问题，这个我们先跳过。\n"
    "换个轻松的：如果完全不考虑能不能做到，你最想试试哪种工作？"
)

# 7.6：用户答不上来 -> 给提示思路
STUCK_REPLY: Final[str] = (
    "想不出来很正常，我换个问法：\n"
    "不用给结论，只说你平时做小组作业时，最愿意主动接手哪部分？"
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
    return f"{transition()}{FALLBACK_CHAT_REPLY}"


def fallback_tags() -> List[dict]:
    """7.6：结构化输出完全失败时的标签默认值（空列表，不做无根据的画像写入）。"""
    return []
