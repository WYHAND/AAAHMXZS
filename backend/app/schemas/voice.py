"""语音接口出入参（面试语音对话）。

设计边界：
- 语音只做「音频 -> 文字」和「文字 -> 音频」，**不落库、不保存录音**；
- 转写出来的文字仍由前端走 ``POST /interview/{id}/answer``，
  复盘、评分、追问逻辑完全复用，语音不参与业务状态；
- TTS 返回 base64 而不是裸二进制：保持全项目 ``{code,message,data}`` 信封，
  前端也能沿用现有的错码处理（裸 blob 错误会被 axios 当成音频，很难排查）。
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class VoiceTextRequest(BaseModel):
    """POST /voice/tts：要朗读的文字。"""

    # 一道面试题 + 一句口头衔接最多两三百字；1000 字足够，且能挡住滥用
    text: str = Field(min_length=1, max_length=1000)


class VoiceTextResponse(BaseModel):
    """POST /voice/transcribe：识别出来的文字。"""

    text: str


class VoiceAudioResponse(BaseModel):
    """POST /voice/tts：base64 音频。"""

    audio: str = Field(description="base64 编码的音频数据")
    mime: str = Field(default="audio/mpeg", description="音频 MIME，前端据此解码")


class VoiceStatusResponse(BaseModel):
    """GET /voice/status：前端据此决定是否展示语音入口。

    只暴露"有没有配置"和模型名，**绝不返回 key / base_url**。
    """

    configured: bool
    provider: str
    asr_model: str
    tts_model: str
