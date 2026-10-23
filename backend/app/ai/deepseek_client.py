"""DeepSeek 客户端封装（《开发手册》7.1 / 7.2 / 7.3 / 7.6）。

- 7.1 用 httpx 直接调用，不引入 SDK / LangChain（手册 2.5）
- 7.2 流式输出：``stream_chat_events`` 异步生成器，逐块 yield ``thinking`` / ``content``
  （``stream_chat`` 是只吐正文的薄包装，给老调用方用）
- 7.3 结构化输出：``chat_json`` 要求模型返回 JSON 并用 Pydantic 校验
- 7.6 兜底：调用失败不抛错，重试 1 次后返回模板回复 / 默认值

⚠️ **一个模型，思考由调用方声明**（勘误 9.32 / 9.36；以官方文档为准）：
- 全项目统一 ``settings.DEEPSEEK_MODEL``（当前 ``deepseek-flash`` = **DeepSeek-V4.1-Flash-1017**）
  —— 用户拍板"**不要分配模型**"；
- **对话正文**：``thinking=True``（显式发 ``thinking: enabled`` + ``reasoning_effort``，
  默认 low —— 实测 low 已经会认真想，够用）；
- **结构化输出与短任务**（出题 / 抽标签 / 生成任务 / 复盘）：同一个模型但 ``thinking=False``
  —— 这不是"分配模型"，是**关掉思考**：思考会把 JSON 的 max_tokens 挤掉导致解析失败，
  而且那些任务不需要想；
- ⚠️ **别按版本号猜模型名**：官方只认 ``deepseek-flash`` 与 ``deepseek-v4-pro``；
  ``deepseek-v4.1-flash`` 这种名字会 **HTTP 400**（虽然 ``deepseek-flash`` 的底层版本
  确实是 V4.1-Flash-1017）。旧名 ``deepseek-chat`` / ``deepseek-reasoner`` 都指向 flash，
  且前者会关思考 —— 所以**不要按名字猜它思不思考**，一律用 ``thinking=`` 显式声明；
- 思考 token **算在 max_tokens 里**（实测 64 时正文为空）；官方不填时默认 8K/64K，
  太大 —— 项目里的"够用值"是 ``DEEPSEEK_CHAT_MAX_TOKENS``（见勘误 9.36）。
- **思考过程不展示给用户**（用户拍板"不给"）：对话侧走 ``stream_chat``（只取正文），
  不落库、不下发。
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

# 对话正文的思考强度（勘误 9.36）：用户拍板**固定 low**，所以不做成配置项。
# 实测依据（deepseek-flash，同一道复杂题）：low = 490 reasoning tokens / 4.8s，
# high = 930 / 7.5s —— 对话场景 low 够用，再高的档位只是更慢更贵。
CHAT_REASONING_EFFORT = "low"

# 7.1 常量：不写成模块级 f-string，方便测试时改配置后立即生效
def _api_url() -> str:
    return f"{settings.DEEPSEEK_BASE_URL.rstrip('/')}/chat/completions"


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }


def _timeout(thinking: bool = False) -> httpx.Timeout:
    # 流式 / 思考场景下 read 超时放宽：V4 开着思考时先思考再输出，单轮明显更慢，单独一档
    seconds = settings.DEEPSEEK_THINKING_TIMEOUT if thinking else settings.DEEPSEEK_TIMEOUT
    return httpx.Timeout(seconds, connect=10.0, read=seconds)


def _payload(
    messages: List[Dict[str, str]],
    temperature: float,
    stream: bool,
    max_tokens: int,
    json_mode: bool = False,
    model: Optional[str] = None,
    thinking: bool = False,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "model": model or settings.DEEPSEEK_MODEL,
        "messages": messages,
        "stream": stream,
        "max_tokens": max_tokens,
    }
    if thinking:
        # 开着思考（对话正文）：显式声明 enabled + effort（官方默认就是 enabled/high，
        # 但默认值会变，写死更可控）。**不带采样参数** —— thinking 模式下 temperature /
        # top_p / penalty 都不生效（传了不报错，但会被忽略）。
        #
        # ⚠️ 调用方必须把 max_tokens 给足：**思考 token 也算在这份额度里**
        # （实测 max_tokens=64 时正文直接是空字符串）。项目里的"够用值"见
        # ``settings.DEEPSEEK_CHAT_MAX_TOKENS``（实测依据见勘误 9.36）。
        body["thinking"] = {"type": "enabled"}
        body["reasoning_effort"] = CHAT_REASONING_EFFORT
    else:
        # 结构化输出 / 短任务：**显式关掉思考**。关掉才快、才省，
        # 也避免思考把 JSON 的 max_tokens 挤掉导致解析失败。
        body["temperature"] = temperature
        body["thinking"] = {"type": "disabled"}
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
    thinking: bool = False,
) -> httpx.Response:
    """原始调用（7.1）。抛 ``BusinessException(3001)`` 表示 AI 调用失败。

    ``thinking=False``（默认）会显式关掉 V4 的思考 —— 短任务要快、要省，
    也避免思考把 JSON 的 max_tokens 挤掉。对话正文请传 ``thinking=True``。
    """
    try:
        async with httpx.AsyncClient(timeout=_timeout(thinking)) as client:
            resp = await client.post(
                _api_url(),
                headers=_headers(),
                json=_payload(messages, temperature, stream, max_tokens, model=model, thinking=thinking),
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
    thinking: bool = False,
) -> str:
    """非流式取文本；7.6 失败重试 ``DEEPSEEK_MAX_RETRIES`` 次后返回模板回复。

    只返回**正文**：开着思考时那段 ``reasoning_content`` 会被丢掉
    （要把它显示给用户请用 :func:`stream_chat_events`）。
    """
    attempts = (settings.DEEPSEEK_MAX_RETRIES if retries is None else retries) + 1
    last_error: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            resp = await chat(messages, temperature, False, max_tokens, model, thinking)
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

async def stream_chat_events(
    messages: List[Dict[str, str]],
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = 2048,
    model: Optional[str] = None,
    thinking: bool = True,
) -> AsyncGenerator[Dict[str, str], None]:
    """流式生成**事件**（勘误 9.32）：``{"type": "thinking"|"content", "text": ...}``。

    为什么要有这个函数，而不是继续只吐字符串：V4 模型（默认 ``thinking=True``）
    会先输出一段 ``delta.reasoning_content``（思考过程）再输出 ``delta.content``（正文）。
    把它**和正文分开**，调用方才有得选：需要展示思考过程的场景可以单独处理，
    不需要的场景（**当前对话路径就是这种**）用 :func:`stream_chat` 只取正文 ——
    用户拍板过"思考过程不给用户看"，所以对话侧**不展示、也不落库**这段内容。

    约定：
    - ``thinking`` 事件**只是过程**，绝不能进消息正文、不能落库（调用方负责）；
    - ``content`` 事件才是回复正文；
    - 出错按 7.6 兜底：没吐出过任何正文时补一条 ``content`` = 兜底话术，
      已经吐过正文时补一句"网络似乎断了一下" —— 都**不抛异常**
      （SSE 已经开始就无法再返回错误 JSON）。
    """
    emitted_content = False
    try:
        async with httpx.AsyncClient(timeout=_timeout(thinking)) as client:
            async with client.stream(
                "POST",
                _api_url(),
                headers=_headers(),
                json=_payload(messages, temperature, True, max_tokens, model=model, thinking=thinking),
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
                    thought = delta.get("reasoning_content")
                    if thought:
                        yield {"type": "thinking", "text": thought}
                    piece = delta.get("content")
                    if piece:
                        emitted_content = True
                        yield {"type": "content", "text": piece}
    except Exception as exc:  # noqa: BLE001 - 流式过程中任何异常都走兜底
        logger.error("DeepSeek 流式调用失败: %s", sanitize(exc))
        if not emitted_content:
            yield {"type": "content", "text": FALLBACK_CHAT_REPLY}
        else:
            yield {"type": "content", "text": "\n\n（网络似乎断了一下，我们接着聊。）"}


async def stream_chat(
    messages: List[Dict[str, str]],
    temperature: float = DEFAULT_TEMPERATURE,
    max_tokens: int = 2048,
    model: Optional[str] = None,
    thinking: bool = True,
) -> AsyncGenerator[str, None]:
    """流式生成**文本**增量（7.2）—— 只吐正文，丢弃思考过程。

    它是 :func:`stream_chat_events` 的薄包装，保留给"不需要显示思考过程"的调用方。
    对话正文请用 ``stream_chat_events``（那才能把"它在想"显示给用户）。
    """
    async for event in stream_chat_events(messages, temperature, max_tokens, model=model, thinking=thinking):
        if event["type"] == "content":
            yield event["text"]


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

# 结构化输出的预算上限（被截断后"加倍重试"时用；别无限加，防止真的跑飞）
_MAX_JSON_TOKENS = 8192


async def chat_json(
    messages: List[Dict[str, str]],
    schema: Type[TModel],
    default: Optional[TModel] = None,
    temperature: float = 0.2,
    max_tokens: int = 2048,
) -> TModel:
    """要求返回 JSON 并用 Pydantic 校验（7.3）；失败重试 1 次，再失败用默认值（7.6）。

    ⚠️ **截断不等于成功**（勘误 9.37）：``finish_reason == "length"`` 说明额度用完了。
    原先这个信号被完全忽略 —— 截断后的坏 JSON 会被当成"模型不听话"，重试仍是同一份额度，
    两次都白跑，上层拿到默认值后**静默降级**（简历润色原样返回、面试复盘缓存一份空报告）。
    现在把截断单独识别出来：记日志 + **把预算加倍重试一次**，让"额度不够"和"模型给了坏 JSON"
    在日志里能分开。

    ``thinking=False`` 也是**显式**传的：结构化任务一旦被动开了思考，reasoning token
    会把 JSON 的预算吃掉（勘误 9.36），而且这种故障没有任何测试会挡住。
    """
    attempts = settings.DEEPSEEK_MAX_RETRIES + 1
    last_error: Optional[Exception] = None
    budget = max_tokens

    for attempt in range(attempts):
        try:
            resp = await chat(messages, temperature, False, budget, thinking=False)
            data = resp.json()
            choice = data["choices"][0]
            finish = choice.get("finish_reason")
            usage = data.get("usage") or {}
            reasoning_tokens = (usage.get("completion_tokens_details") or {}).get("reasoning_tokens")
            # 留痕：以后"预算该调多少"直接看这行日志，不用再猜
            logger.info(
                "chat_json schema=%s attempt=%s/%s finish=%s completion=%s reasoning=%s budget=%s",
                schema.__name__, attempt + 1, attempts, finish,
                usage.get("completion_tokens"), reasoning_tokens, budget,
            )
            if finish == "length":
                logger.warning(
                    "chat_json 输出被截断（finish=length）schema=%s budget=%s",
                    schema.__name__, budget,
                )
                if attempt + 1 < attempts and budget < _MAX_JSON_TOKENS:
                    budget = min(_MAX_JSON_TOKENS, budget * 2)
                    logger.warning("chat_json 截断后加倍预算重试：-> %s", budget)
                    continue
            content = choice["message"]["content"] or ""
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
    max_tokens: int = 2048,
) -> TModel:
    """从 ``app/ai/prompts/{prompt_name}.txt`` 载入模板并做结构化输出。

    ``max_tokens`` 必须透传给 :func:`chat_json`：面试复盘那种"逐题点评 + 多维评分 + 标签"
    的结构化输出比一般调用长得多，调用方会给到 3000；这个参数**曾经漏在签名外**，
    于是 ``interview_service._build_review`` 的 ``max_tokens=3000`` 直接抛 TypeError，
    ``POST /interview/{id}/finish`` 永远 500、复盘永远生成不出来（见勘误 9.21）。
    """
    template = load_prompt(prompt_name)
    rendered = render_prompt(template, variables)
    messages = build_messages(
        system="你是一个严格输出 JSON 的助手，只输出 JSON，不要任何解释或 Markdown 代码块。",
        user=rendered,
    )
    return await chat_json(
        messages, schema, default=default, temperature=temperature, max_tokens=max_tokens
    )


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
