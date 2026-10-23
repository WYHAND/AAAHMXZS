"""云端语音服务（面试语音对话，阿里云百炼 DashScope）。

职责只有两个：
1. ``transcribe``：录音 -> 文字（ASR，paraformer-realtime-v2）
2. ``synthesize``：文字 -> 音频（TTS，cosyvoice-v3-flash）

为什么是"录完一段再转写"而不是流式：
- 一期交互是**回合制**：前端用 VAD 判断"说完了"，再上传一段音频；
- 转写只做一次请求，路由契约简单；以后要"边说边出字"，换实现即可。

为什么走 DashScope SDK 而不是自己拼 WebSocket：
- 百炼的实时语音是 WebSocket + 二进制帧协议，自己实现容易在
  task-started / result-generated / task-finished 的状态机上出错；
- ``dashscope`` 已在 requirements 中锁定版本，封装好了鉴权、重连前的
  错误码和一问一答的收帧逻辑。

隐私与日志：
- 音频只在内存里经过；ASR SDK 只接受文件路径，所以会写一个临时文件，
  **识别完立刻删除**，不落库、不长期保留；
- 日志只记录字节数 / 字符数 / 格式，不记录音频内容，也不记录转写原文
  （面试回答属于用户隐私，复盘里已经有必要的留存）；
- 日志中的异常文本统一走 ``sanitize``，不会出现 Key / Authorization。

关于鉴权地址：
- 标准 Key 直接用 ``wss://dashscope.aliyuncs.com/api-ws/v1/inference``；
- ``sk-ws-`` 开头的是**工作空间 Key**，个别账号只在带工作空间子域名的
  MaaS 地址上可用，因此配置了 ``VOICE_WORKSPACE_ID`` 时，默认地址失败后
  会再试一次 ``wss://{workspace}.{region}.maas.aliyuncs.com/api-ws/v1/inference``。
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import re
import tempfile
from typing import Dict, List, Optional, Tuple

import dashscope
from dashscope.audio.asr import Recognition, RecognitionCallback
from dashscope.audio.tts_v2 import AudioFormat, SpeechSynthesizer

from app.core.config import settings
from app.core.errors import BusinessException
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

# 面试语音目前只接阿里云百炼；``dashscope`` / ``bailian`` 是同义写法，
# 方便沿用旧 .env 的手写值。硅基流动的 HTTP 实现已下线。
SUPPORTED_PROVIDERS = {"aliyun", "dashscope", "bailian"}

# 工作空间 ID / Region 会拼进域名，必须先做 host 标签校验，避免被 .env
# 里的异常值带到别的地址上（与 dashscope SDK 的校验规则保持一致）。
_WORKSPACE_ID_RE = re.compile(r"\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
_REGION_RE = re.compile(r"\A[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")

# 24kHz MP3：面试官声音用这个档位足够清楚，体积也适合前端塞进 base64。
_TTS_AUDIO_FORMAT = AudioFormat.MP3_24000HZ_MONO_256KBPS
_TTS_MIME = "audio/mpeg"

# 请求头 / 文件头 -> ASR 需要的音频格式名（paraformer-realtime-v2 的 format 参数）。
# webm 不在支持列表里：前端主链路会先解码成 16k WAV，只有解码失败才会发 webm，
# 这种情况给用户一条能执行的提示，而不是把二进制丢给服务端报一个看不懂的错。
_ASR_FORMAT_BY_MIME: Dict[str, str] = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/vnd.wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/ogg": "opus",
    "audio/opus": "opus",
    "application/octet-stream": "wav",
}

# SDK 默认只等 5s 建连；跨公网 TLS 握手偶尔会超过这个值（实测 1-15s），
# 直接失败会让"第一次说话"经常没声音。这里按 15s 放宽，接口行为不变。
_TTS_CONNECT_TIMEOUT_S = 15

# 一次 3 分钟的回答在慢网络下也可能要几十秒才能收完；SDK 默认 300s 太久，
# 这里给一个"足够但不至于挂死"的上限。
_ASR_REQUEST_TIMEOUT_S = 120

# SDK 的 DEBUG 日志会打印 WebSocket 请求头（含 Authorization），必须压掉。
logging.getLogger("dashscope").setLevel(logging.WARNING)
logging.getLogger("websocket").setLevel(logging.WARNING)


class _RelaxedConnectSynthesizer(SpeechSynthesizer):
    """把 SDK 内部 5s 的建连等待放宽到 ``_TTS_CONNECT_TIMEOUT_S``。

    只覆盖私有方法 ``__connect`` 的超时参数，其余行为完全沿用 SDK；
    升级 dashscope 时需要复核该方法名是否还在（当前锁定 2.0.1）。
    """

    def _SpeechSynthesizer__connect(self, timeout_seconds: float = 5) -> None:  # noqa: N802
        super()._SpeechSynthesizer__connect(
            max(timeout_seconds, _TTS_CONNECT_TIMEOUT_S)
        )


def _api_key() -> str:
    """优先 ``DASHSCOPE_API_KEY``，兼容旧的 ``VOICE_API_KEY``。"""
    return settings.voice_api_key


def is_configured() -> bool:
    """是否具备调用云端语音的条件（key + 受支持的 provider）。"""
    return settings.voice_configured


def status() -> Dict[str, object]:
    """给前端的最小状态：只回答"能不能用"，不泄露任何凭据。"""
    return {
        "configured": is_configured(),
        "provider": settings.VOICE_PROVIDER,
        "asr_model": settings.VOICE_ASR_MODEL,
        "tts_model": settings.VOICE_TTS_MODEL,
    }


def _require_configured() -> None:
    """未配置时给一条**能指导用户下一步**的错误，而不是笼统的 500。"""
    provider = settings.VOICE_PROVIDER.strip().lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise BusinessException.ai_error(
            "语音服务配置有误：VOICE_PROVIDER 目前只支持 aliyun（阿里云百炼）"
        )
    if not _api_key():
        raise BusinessException.ai_error(
            "语音服务还没配置：请在 backend/.env 填写 DASHSCOPE_API_KEY"
            "（阿里云百炼控制台可创建）"
        )


def _workspace_id() -> str:
    return settings.VOICE_WORKSPACE_ID.strip()


def _workspace_ws_url() -> Optional[str]:
    """工作空间专属的 WebSocket 地址；没配置或格式非法时返回 None。"""
    workspace = _workspace_id()
    if not workspace:
        return None
    if not _WORKSPACE_ID_RE.fullmatch(workspace):
        logger.warning("VOICE_WORKSPACE_ID 格式不合法，已忽略工作空间地址")
        return None
    region = settings.VOICE_REGION.strip() or "cn-beijing"
    if not _REGION_RE.fullmatch(region):
        logger.warning("VOICE_REGION 格式不合法，已回退 cn-beijing")
        region = "cn-beijing"
    return f"wss://{workspace}.{region}.maas.aliyuncs.com/api-ws/v1/inference"


def _candidate_ws_urls() -> List[Optional[str]]:
    """按顺序返回要尝试的 WebSocket 地址；None 表示 SDK 默认地址。

    只有 ``sk-ws-`` 开头的工作空间 Key 且配置了 workspace id 时才追加
    工作空间地址，普通 Key 不该被带到别的域名上。
    """
    urls: List[Optional[str]] = [None]
    if _api_key().startswith("sk-ws-"):
        workspace_url = _workspace_ws_url()
        if workspace_url:
            urls.append(workspace_url)
    return urls


def _configure_sdk() -> None:
    """每次调用前同步 Key；SDK 从模块级变量取默认 Key。"""
    dashscope.api_key = _api_key()


def _safe_error(exc: BaseException) -> str:
    """异常文本脱敏后返回，只用于日志 / 内部判断。"""
    return sanitize(f"{type(exc).__name__}: {exc}", extra_secrets=(_api_key(),))


def _mp3_sample_rate(audio: bytes) -> int:
    """从 MP3 帧头读采样率；读不出来返回 0。

    ASR 服务会校验 ``sample_rate`` 与音频真实采样率是否一致（不一致直接
    返回 AUDIO_DECODE_ERROR），而 MP3 没有 WAV 那样的固定头，只能解析帧头。
    """
    offset = 0
    if audio[:3] == b"ID3" and len(audio) >= 10:
        size = (
            ((audio[6] & 0x7F) << 21)
            | ((audio[7] & 0x7F) << 14)
            | ((audio[8] & 0x7F) << 7)
            | (audio[9] & 0x7F)
        )
        offset = 10 + size

    for index in range(offset, min(len(audio) - 4, offset + 8192)):
        if audio[index] != 0xFF or (audio[index + 1] & 0xE0) != 0xE0:
            continue
        version_bits = (audio[index + 1] >> 3) & 0x03
        layer_bits = (audio[index + 1] >> 1) & 0x03
        rate_index = (audio[index + 2] >> 2) & 0x03
        if version_bits == 1 or layer_bits == 0 or rate_index == 3:
            continue
        if version_bits == 3:  # MPEG 1
            table = (44100, 48000, 32000)
        elif version_bits == 2:  # MPEG 2
            table = (22050, 24000, 16000)
        else:  # MPEG 2.5
            table = (11025, 12000, 8000)
        return table[rate_index]
    return 0


def _audio_request(content_type: str, audio: bytes) -> Tuple[str, int]:
    """把请求头和文件头收敛成 (ASR format, 采样率)。

    优先用文件头判断（浏览器偶尔会把 WAV 标成 octet-stream），
    判断不出来再退回 Content-Type；都不认识时按 WAV 试一次。
    """
    mime = (content_type or "").split(";", 1)[0].strip().lower()

    if audio[:4] == b"RIFF" and audio[8:12] == b"WAVE":
        audio_format = "wav"
    elif audio[:3] == b"ID3" or (
        len(audio) > 1 and audio[0] == 0xFF and (audio[1] & 0xE0) == 0xE0
    ):
        audio_format = "mp3"
    elif audio[:4] == b"OggS":
        audio_format = "opus"
    elif audio[:4] == b"\x1aE\xdf\xa3":
        # EBML：webm / mkv，paraformer-realtime-v2 不支持
        raise BusinessException.ai_error(
            "这段录音的格式暂时无法识别，请重试；如果一直失败，可以先用文字作答"
        )
    else:
        audio_format = _ASR_FORMAT_BY_MIME.get(mime, "")

    if not audio_format:
        # 认不出来时按 WAV 再试一次：比直接拒绝更有机会成功
        logger.info("语音转写：无法判断音频格式（mime=%s），按 wav 尝试", mime or "(空)")
        audio_format = "wav"

    if audio_format == "wav" and len(audio) >= 28:
        # WAV header: sample rate 在偏移 24，小端 4 字节
        rate = int.from_bytes(audio[24:28], "little")
        sample_rate = rate if 8000 <= rate <= 48000 else 16000
    elif audio_format == "mp3":
        sample_rate = _mp3_sample_rate(audio) or 16000
    elif audio_format == "opus":
        # Ogg Opus 解码后固定 48kHz
        sample_rate = 48000
    else:
        sample_rate = 16000

    return audio_format, sample_rate


def _result_text(result: object) -> str:
    """从 RecognitionResult 里拼出最终文本（忽略空句 / 心跳包）。"""
    getter = getattr(result, "get_sentence", None)
    sentence = getter() if callable(getter) else None
    if isinstance(sentence, dict):
        sentences: List[object] = [sentence]
    elif isinstance(sentence, list):
        sentences = sentence
    else:
        sentences = []

    parts: List[str] = []
    for item in sentences:
        if isinstance(item, dict):
            text = str(item.get("text") or "").strip()
            if text:
                parts.append(text)
    return "".join(parts).strip()


def _transcribe_blocking(audio: bytes, audio_format: str, sample_rate: int) -> str:
    """线程里跑的同步实现：临时文件 -> Recognition.call -> 删除文件。"""
    _configure_sdk()

    for ws_url in _candidate_ws_urls():
        fd, path = tempfile.mkstemp(prefix="aicareer-asr-", suffix=f".{audio_format}")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(audio)

            kwargs: Dict[str, object] = {
                "model": settings.VOICE_ASR_MODEL,
                "format": audio_format,
                "sample_rate": sample_rate,
                "callback": RecognitionCallback(),
                "request_timeout": _ASR_REQUEST_TIMEOUT_S,
            }
            workspace = _workspace_id()
            if workspace:
                kwargs["workspace"] = workspace
            if ws_url:
                kwargs["base_address"] = ws_url

            recognition = Recognition(**kwargs)  # type: ignore[arg-type]
            result = recognition.call(path)

            status_code = int(getattr(result, "status_code", 0) or 0)
            if status_code == 200:
                return _result_text(result)

            code = getattr(result, "code", None) or status_code
            message = getattr(result, "message", None) or ""
            logger.warning(
                "语音转写返回失败：%s（地址=%s）",
                sanitize(
                    f"status={status_code} code={code} message={message}",
                    extra_secrets=(_api_key(),),
                ),
                ws_url or "默认",
            )
        except BusinessException:
            raise
        except Exception as exc:  # noqa: BLE001 - 统一转成 3001 给前端降级
            logger.warning(
                "语音转写请求失败：%s（地址=%s）", _safe_error(exc), ws_url or "默认"
            )
        finally:
            try:
                os.remove(path)
            except OSError:
                pass

    raise BusinessException.ai_error("语音识别暂时不可用，请再说一次或改用文字作答")


async def transcribe(audio: bytes, content_type: str) -> str:
    """POST /voice/transcribe 的实现：音频 -> 文字。

    失败一律转成 ``3001 AI_ERROR``：对用户是"语音识别暂时不可用，再说一次 /
    改用文字"，对前端是一个可以降级的分支，而不是整页 500。
    """
    _require_configured()
    if not audio:
        raise BusinessException.param_error("没有收到录音")

    audio_format, sample_rate = _audio_request(content_type, audio)
    logger.info(
        "语音转写开始：%s bytes，format=%s，rate=%s",
        len(audio),
        audio_format,
        sample_rate,
    )

    try:
        text = await asyncio.to_thread(
            _transcribe_blocking, audio, audio_format, sample_rate
        )
    except BusinessException:
        raise
    except Exception as exc:  # noqa: BLE001 - 兜底，别把 SDK 异常漏成 500
        logger.warning("语音转写异常：%s", _safe_error(exc))
        raise BusinessException.ai_error(
            "语音识别暂时不可用，请再说一次或改用文字作答"
        ) from exc

    logger.info("语音转写完成：%s bytes -> %s 字", len(audio), len(text))
    return text


def _synthesize_blocking(text: str) -> bytes:
    """线程里跑的同步实现：返回 MP3 字节。"""
    _configure_sdk()

    workspace = _workspace_id() or None
    timeout_ms = max(60, int(settings.VOICE_TIMEOUT)) * 1000

    # 默认地址在弱网下 TLS 握手偶发超时，多给一次机会；
    # 工作空间地址只在特殊账号上用，失败就没必要再来一轮。
    attempts: List[Optional[str]] = []
    for ws_url in _candidate_ws_urls():
        attempts.append(ws_url)
        if ws_url is None:
            attempts.append(None)

    for attempt_index, ws_url in enumerate(attempts, start=1):
        synthesizer = None
        try:
            kwargs: Dict[str, object] = {
                "model": settings.VOICE_TTS_MODEL,
                "voice": settings.VOICE_TTS_VOICE,
                "format": _TTS_AUDIO_FORMAT,
                "workspace": workspace,
            }
            if ws_url:
                kwargs["url"] = ws_url
            synthesizer = _RelaxedConnectSynthesizer(**kwargs)  # type: ignore[arg-type]
            audio = synthesizer.call(text, timeout_millis=timeout_ms)
            if audio:
                return bytes(audio)
            logger.warning("语音合成返回空音频（地址=%s）", ws_url or "默认")
        except Exception as exc:  # noqa: BLE001 - 统一转成 3001 给前端降级
            logger.warning(
                "语音合成请求失败（第 %s/%s 次，地址=%s）：%s",
                attempt_index,
                len(attempts),
                ws_url or "默认",
                _safe_error(exc),
            )
        finally:
            if synthesizer is not None:
                try:
                    synthesizer.close()
                except Exception:  # noqa: BLE001 - 关闭失败不影响结果
                    pass

    raise BusinessException.ai_error("语音朗读暂时不可用，请稍后再试")


async def synthesize(text: str) -> Tuple[str, str]:
    """POST /voice/tts 的实现：文字 -> (base64 音频, MIME)。

    返回 base64 而不是 ``Response(content=bytes)``：
    - 全项目统一信封，前端拦截器能按 3001/1001 正常提示；
    - 裸 blob 请求失败时 axios 拿到的是"一个装着 JSON 的 Blob"，
      很容易被误当成音频播出去，排查成本高。
    """
    _require_configured()
    clean = text.strip()
    if not clean:
        raise BusinessException.param_error("没有要朗读的文字")

    logger.info("语音合成开始：%s 字", len(clean))

    try:
        audio_bytes = await asyncio.to_thread(_synthesize_blocking, clean)
    except BusinessException:
        raise
    except Exception as exc:  # noqa: BLE001 - 兜底，别把 SDK 异常漏成 500
        logger.warning("语音合成异常：%s", _safe_error(exc))
        raise BusinessException.ai_error("语音朗读暂时不可用，请稍后再试") from exc

    if not audio_bytes:
        logger.warning("语音合成没有返回音频")
        raise BusinessException.ai_error("语音朗读返回格式异常，请稍后再试")

    audio = base64.b64encode(audio_bytes).decode("ascii")
    logger.info("语音合成完成：%s 字 -> %s bytes", len(clean), len(audio_bytes))
    return audio, _TTS_MIME
