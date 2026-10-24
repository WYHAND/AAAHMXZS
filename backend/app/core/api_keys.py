"""请求级 API Key 覆盖（评委在前端「API 设置」里填自己的 Key）。

为什么需要：
- 评分环境不应该依赖作者的 Key；评委可以用自己的 Key 打开完整 AI/语音能力；
- Key 只在**当前请求**的上下文里生效，不写数据库、不写日志、不落盘。

实现要点：
- 用纯 ASGI 中间件设置 ``ContextVar``，而不是 ``@app.middleware("http")``：
  SSE 是流式响应，BaseHTTPMiddleware 会在响应体还没发完时就把上下文重置掉，
  导致流式对话拿不到评委填的 Key。
- 请求头为空时自动回落到 ``settings``（本地 ``backend/.env``），
  所以作者演示时仍然用自己的 Key，评委不填也能走兜底。
"""

from __future__ import annotations

from contextvars import ContextVar

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings

# 空字符串 = 本次请求没有覆盖，使用服务器配置
_DEEPSEEK_KEY: ContextVar[str] = ContextVar("deepseek_key_override", default="")
_DASHSCOPE_KEY: ContextVar[str] = ContextVar("dashscope_key_override", default="")

_HEADER_DEEPSEEK = "x-deepseek-key"
_HEADER_DASHSCOPE = "x-dashscope-key"

# 防止误把 .env 里的占位符当成 Key；也挡住明显异常的超长输入
_PLACEHOLDERS = ("sk-xxxxxxxx", "your-", "change-me", "xxx")


def _clean(value: str | None) -> str:
    """请求头里的 Key 只做最小清洗；不校验格式（各家 Key 前缀可能变）。"""
    text = (value or "").strip()
    if not text or len(text) > 512:
        return ""
    lowered = text.lower()
    if any(token in lowered for token in _PLACEHOLDERS):
        return ""
    return text


def get_deepseek_key() -> str:
    """当前请求实际使用的 DeepSeek Key；没有覆盖时回落到 .env。"""
    return _DEEPSEEK_KEY.get() or (settings.DEEPSEEK_API_KEY or "").strip()


def get_dashscope_key() -> str:
    """当前请求实际使用的百炼语音 Key；没有覆盖时回落到 .env。"""
    return _DASHSCOPE_KEY.get() or settings.voice_api_key


class ApiKeyHeaderMiddleware:
    """把 ``X-DeepSeek-Key`` / ``X-DashScope-Key`` 放进请求上下文。

    纯 ASGI 写法保证上下文覆盖整个请求生命周期，包括 SSE 流式响应体。
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        token_deepseek = _DEEPSEEK_KEY.set(_clean(headers.get(_HEADER_DEEPSEEK)))
        token_dashscope = _DASHSCOPE_KEY.set(_clean(headers.get(_HEADER_DASHSCOPE)))
        try:
            await self.app(scope, receive, send)
        finally:
            _DASHSCOPE_KEY.reset(token_dashscope)
            _DEEPSEEK_KEY.reset(token_deepseek)


__all__ = [
    "ApiKeyHeaderMiddleware",
    "get_deepseek_key",
    "get_dashscope_key",
]
