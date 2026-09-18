"""DeepSeek 客户端封装（《开发手册》7.1 / 7.2 / 7.3 / 7.6）。

- 7.1 用 httpx 直接调用，不引入 SDK / LangChain（手册 2.5）
- 7.2 流式输出：``stream_chat`` 异步生成器，逐块 yield 文本增量
- 7.3 结构化输出：``chat_json`` 要求模型返回 JSON 并用 Pydantic 校验
- 7.6 兜底：调用失败不抛错，重试 1 次后返回模板回复 / 默认值
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator, Dict, List, Optional, Type, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.ai.fallbacks import FALLBACK_CHAT_REPLY, DEFAULT_TEMPERATURE
from app.ai.parser import extract_json, load_prompt
from app.core.config import settings
from app.core.errors import BusinessException, ErrorCode
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

TModel = TypeVar("TModel", bound=BaseModel)

# 7.1 常量：不写成模块级 f-string，方便测试时改配置后立即生效
def _api_url() -> str:
    return f"{settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }


def _timeout() -> httpx.Timeout:
    # 流式场景下 read 超时放宽
    return httpx.Timeout(settings.DEEPSEEK_TIMEOUT, connect=10.0, read=settings.DEEPSEEK_TIMEOUT)


def _payload(
    messages: List[Dict[str, str]],
    temperature: float,
    stream: bool,
    max_tokens: int,
    json_mode: bool = False,
    model: Optional[str] = None,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "model": model or settings.DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": temperature,
        "stream": stream,
        "max_tokens": max_tokens,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    return body


def build_messages(system: str, user: str, history: Optional[List[Dict[str, str]]] = None) -> List[Dict[str, str]]:
    """组装 messages（14.7：系统 Prompt 与用户输入分离）。"""
    messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user})
    return messages


# ---------------- 7.1 基础调用 ----------------

async def chat(
    messages: List[Dict[str, str]],
    temperature: float = DEFAULT_TEMPERATURE,
    stream: bool = False,
    max_tokens: int = 2048,
    model: Optional[str] = None,
) -> httpx.Response:
    """原始调用（7.1）。抛 ``BusinessException(3001)`` 表示 AI 调用失败。"""
    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            resp = await client.post(
                _api_url(),
                headers=_headers(),
                json=_payload(messages, temperature, stream, max_tokens, model=model),
            )
            resp.raise_for_status()
            return resp
    except httpx.HTTPStatusError as exc:
        logger.error("DeepSeek HTTP 错误 status=%s body=%s",
                     exc.response.status_code, sanitize(exc.response.text[:500]))
        raise BusinessException(ErrorCode.AI_ERROR, "AI 服务返回错误") from exc
    except httpx.HTTPError as exc:
        logger.error("DeepSeek 调用失败: %s", sanitize(exc))
        raise BusinessException(ErrorCode.AI_ERROR, "AI 服务不可用") from exc


async def chat_text(
    messages: List[Dict[str, str]],
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = 2048,
    model: Optional[str] = None,
    retries: Optional[int] = None,
) -> str:
    """非流式取文本；7.6 失败重试 ``DEEPSEEK_MAX_RETRIES`` 次后返回模板回复。"""
    attempts = (settings.DEEPSEEK_MAX_RETRIES if retries is None else retries) + 1
    last_error: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            resp = await chat(messages, temperature, False, max_tokens, model)
            data = resp.json()
            return data["choices"][0]["message"]["content"] or ""
        except (BusinessException, KeyError, IndexError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            logger.warning("chat_text 第 %s/%s 次失败: %s", attempt + 1, attempts, sanitize(exc))
            if attempt + 1 < attempts:
                await asyncio.sleep(0.5 * (attempt + 1))
    logger.error("chat_text 全部重试失败，使用兜底模板回复: %s", sanitize(last_error))
    return FALLBACK_CHAT_REPLY


# ---------------- 7.2 流式输出 ----------------

async def stream_chat(
    messages: List[Dict[str, str]],
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = 2048,
    model: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """流式生成文本增量（7.2）。

    逐块 yield ``choices[0].delta.content``；出错时按 7.6 yield 兜底模板并结束，
    不向调用方抛异常（SSE 已经开始就无法再返回错误 JSON）。
    """
    full: List[str] = []
    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            async with client.stream(
                "POST",
                _api_url(),
                headers=_headers(),
                json=_payload(messages, temperature, True, max_tokens, model=model),
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    chunk = line[5:].strip()
                    if not chunk or chunk == "[DONE]":
                        if chunk == "[DONE]":
                            break
                        continue
                    try:
                        payload = json.loads(chunk)
                    except json.JSONDecodeError:
                        logger.debug("跳过非 JSON 流片段: %s", chunk[:120])
                        continue
                    choices = payload.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        full.append(piece)
                        yield piece
    except Exception as exc:  # noqa: BLE001 - 流式过程中任何异常都走兜底
        logger.error("DeepSeek 流式调用失败: %s", sanitize(exc))
        if not full:
            yield FALLBACK_CHAT_REPLY
        else:
            yield "\n\n（网络似乎断了一下，我们接着聊。）"


async def stream_sse(
    messages: List[Dict[str, str]],
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = 2048,
) -> AsyncGenerator[Dict[str, Any], None]:
    """把流式文本包装成结构化事件字典，供上层转成 SSE 文本。

    yield 形如 ``{"type": "delta", "content": "..."}``。
    """
    async for piece in stream_chat(messages, temperature, max_tokens):
        yield {"type": "delta", "content": piece}


# ---------------- 7.3 结构化输出 ----------------

async def chat_json(
    messages: List[Dict[str, str]],
    schema: Type[TModel],
    default: Optional[TModel] = None,
    temperature: float = 0.2,
    max_tokens: int = 2048,
) -> TModel:
    """要求返回 JSON 并用 Pydantic 校验（7.3）；失败重试 1 次，再失败用默认值（7.6）。"""
    attempts = settings.DEEPSEEK_MAX_RETRIES + 1
    last_error: Optional[Exception] = None

    for attempt in range(attempts):
        try:
            resp = await chat(messages, temperature, False, max_tokens)
            content = resp.json()["choices"][0]["message"]["content"] or ""
            payload = extract_json(content)
            return schema.model_validate(payload)
        except (BusinessException, KeyError, IndexError, ValueError, ValidationError) as exc:
            last_error = exc
            logger.warning("chat_json 第 %s/%s 次解析失败: %s", attempt + 1, attempts, sanitize(exc))
            if attempt + 1 < attempts:
                await asyncio.sleep(0.5)

    logger.error("chat_json 全部失败 schema=%s err=%s", schema.__name__, sanitize(last_error))
    if default is not None:
        return default
    raise BusinessException(ErrorCode.AI_ERROR, "AI 结构化输出解析失败")


async def chat_prompt_json(
    prompt_name: str,
    variables: Dict[str, Any],
    schema: Type[TModel],
    default: Optional[TModel] = None,
    temperature: float = 0.2,
) -> TModel:
    """从 ``app/ai/prompts/{prompt_name}.txt`` 载入模板并做结构化输出。"""
    template = load_prompt(prompt_name)
    rendered = render_prompt(template, variables)
    messages = build_messages(
        system="你是一个严格输出 JSON 的助手，只输出 JSON，不要任何解释或 Markdown 代码块。",
        user=rendered,
    )
    return await chat_json(messages, schema, default=default, temperature=temperature)


async def chat_prompt_text(
    prompt_name: str,
    variables: Dict[str, Any],
    system: str = "",
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = 2048,
) -> str:
    """从 Prompt 模板渲染后取纯文本。"""
    template = load_prompt(prompt_name)
    rendered = render_prompt(template, variables)
    messages = build_messages(system=system or "你是一名专业、亲切的高校就业指导助手。", user=rendered)
    return await chat_text(messages, temperature=temperature, max_tokens=max_tokens)


def render_prompt(template: str, variables: Dict[str, Any]) -> str:
    """简单 ``{name}`` 占位符替换；缺失变量原样保留，不抛 KeyError。

    用 str.replace 而不是 str.format，避免 Prompt 里的 JSON 花括号被当成占位符。
    """
    rendered = template
    for key, value in (variables or {}).items():
        if value is None:
            value = ""
        if not isinstance(value, str):
            value = json.dumps(value, ensure_ascii=False, default=str)
        rendered = rendered.replace("{" + key + "}", value)
    return rendered
