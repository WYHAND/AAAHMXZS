"""Voice 路由（面试语音对话：状态 / 转写 / 朗读）。

前缀 ``/api/v1/voice``。三条接口都要求登录：
语音调用是要花钱的外部依赖，不能给匿名请求白用。

接口契约：
- ``GET  /voice/status``      -> {configured, provider, asr_model, tts_model}
- ``POST /voice/transcribe``  -> body 是**原始音频字节**（Content-Type: audio/wav），
                                  返回 {text}
- ``POST /voice/tts``         -> {text}，返回 {audio(base64), mime}

⚠️ 转写接口刻意不用 multipart：前端直接发 ``Blob``，后端 ``request.body()``
读原始字节，少一层 python-multipart 依赖（requirements 里没有它）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.api_response import ApiResponse
from app.core.config import settings
from app.core.deps import get_current_user
from app.core.errors import BusinessException
from app.models.user import User
from app.schemas.voice import (
    VoiceAudioResponse,
    VoiceStatusResponse,
    VoiceTextRequest,
    VoiceTextResponse,
)
from app.services import voice_service

router = APIRouter(prefix="/voice", tags=["Voice 语音"])


@router.get(
    "/status",
    response_model=ApiResponse[VoiceStatusResponse],
    summary="语音服务状态",
)
async def status(
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[VoiceStatusResponse]:
    """前端据此决定是否展示麦克风/语音通话入口。

    **不返回 key、base_url**；只回答"能不能用"。
    """
    return ApiResponse.ok(VoiceStatusResponse(**voice_service.status()))


@router.post(
    "/transcribe",
    response_model=ApiResponse[VoiceTextResponse],
    summary="录音转文字",
)
async def transcribe(
    request: Request,
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[VoiceTextResponse]:
    """接收一段原始音频，转成文字。

    前端在"用户说完 + 静音"后上传 16k 单声道 WAV（一次回答通常 10-60 秒）。
    音频只在内存里经过，不落盘、不写库。
    """
    audio = await request.body()
    if not audio:
        raise BusinessException.param_error("没有收到录音")
    if len(audio) > settings.VOICE_MAX_AUDIO_BYTES:
        raise BusinessException.param_error("这段录音太长了，请分几次说")

    text = await voice_service.transcribe(audio, request.headers.get("content-type", ""))
    return ApiResponse.ok(VoiceTextResponse(text=text))


@router.post(
    "/tts",
    response_model=ApiResponse[VoiceAudioResponse],
    summary="文字转语音",
)
async def tts(
    payload: VoiceTextRequest,
    _current_user: User = Depends(get_current_user),
) -> ApiResponse[VoiceAudioResponse]:
    """把面试官要说的文字合成语音（base64 MP3）。

    前端在"接通"按钮的点击里先 unlock AudioContext，再请求这里，
    避免浏览器把自动播放拦掉。
    """
    audio, mime = await voice_service.synthesize(payload.text)
    return ApiResponse.ok(VoiceAudioResponse(audio=audio, mime=mime))
