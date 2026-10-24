"""AI 兜底与默认值。

原则（2026-11 用户拍板）：
- **模型挂了就说模型挂了。** 不再用"嗨，今天过得咋样？"这类假开场、假闲聊糊弄用户 ——
  那会让用户以为 AI 还在正常工作，实际只是在念模板。
- 对话正文的兜底只保留一句**如实说明服务不可用**的话；开场白生成失败直接返回错误，
  由前端提示"稍后重试"。
- 结构化输出解析失败仍然用 ``app/ai/schemas.py`` 里的默认值（那是数据层，不是假对话）。
"""

from __future__ import annotations

from typing import Final, List

# 默认温度（7.1 示例给的是 0.7，结构化输出用 0.2）
DEFAULT_TEMPERATURE: Final[float] = 0.7
STRUCTURED_TEMPERATURE: Final[float] = 0.2

# 模型真的不可用时的唯一一条本地话术。
# 它必须**明说这是服务问题**，不能伪装成 AI 的自然回复。
FALLBACK_CHAT_REPLY: Final[str] = (
    "AI 服务这会儿没连上，这条没回成。\n"
    "你稍后再发一次，或者刷新一下页面。"
)


def fallback_reply() -> str:
    """模型不可用时返回的如实说明（不再假装闲聊）。"""
    return FALLBACK_CHAT_REPLY


def fallback_tags() -> List[dict]:
    """结构化输出完全失败时的标签默认值（空列表，不做无根据的画像写入）。"""
    return []
