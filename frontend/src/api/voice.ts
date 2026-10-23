/**
 * 语音接口 —— 路径对齐后端 app/api/v1/voice.py（prefix="/voice"）
 *
 *   GET  /voice/status        -> { configured, provider, asr_model, tts_model }
 *   POST /voice/transcribe    -> body 是**原始音频字节**（Content-Type: audio/wav），返回 { text }
 *   POST /voice/tts           -> { text }，返回 { audio(base64), mime }
 *
 * 安全边界：
 * - 阿里百炼的 API Key 只存在后端环境变量里，前端**不接触**；
 * - 前端只调本地后端，不会把 key/Base URL 打进 bundle。
 *
 * 三条都带 `silent: true`：语音是增强能力，失败时由调用方静默降级到
 * 浏览器 speechSynthesis，不应该给用户弹全局错误 toast。
 *
 * ⚠️ `/voice/transcribe` 刻意不用 multipart：直接发 Blob 原始字节，
 * 与后端 `request.body()` 的读法一致（见 voice.py 顶部注释）。
 */

import { client, get, post } from '@/api/client'

/** GET /voice/status：只回答“能不能用”，不含任何密钥 */
export interface VoiceStatus {
  configured: boolean
  provider: string
  asr_model: string
  tts_model: string
}

/** POST /voice/tts：base64 音频 + MIME（通常是 audio/mpeg） */
export interface VoiceAudio {
  audio: string
  mime: string
}

/** POST /voice/transcribe */
export interface VoiceText {
  text: string
}

/**
 * `/voice/status` 在页面里会被 TTS、全真通话、语音输入多处同时请求；
 * 共享一个短缓存，避免一次进入页面打出 5、6 个重复请求。
 * 30 秒内复用同一个 Promise；失败时清掉，下一次重新探活。
 */
let statusCache: { at: number; promise: Promise<VoiceStatus> } | null = null
const STATUS_CACHE_MS = 30_000

export const voiceApi = {
  /** 语音服务状态；失败（未登录/未配置/网络）由调用方静默处理 */
  status: (): Promise<VoiceStatus> => {
    const now = Date.now()
    if (statusCache && now - statusCache.at < STATUS_CACHE_MS) {
      return statusCache.promise
    }
    const promise = get<VoiceStatus>('/voice/status', {
      silent: true,
      timeout: 10000,
    }).catch((error: unknown) => {
      statusCache = null
      throw error
    })
    statusCache = { at: now, promise }
    return promise
  },

  /**
   * 文字转语音。
   *
   * 合成要走云端，偶尔比普通接口慢；默认 20 秒容易把长题掐断，给 45 秒。
   * 失败仍然 reject（ApiError），由 useSpeechSynthesis 决定回退浏览器音色。
   */
  tts: (text: string) =>
    post<VoiceAudio>(
      '/voice/tts',
      { text },
      {
        silent: true,
        timeout: 45000,
      },
    ),

  /**
   * 录音转文字（本任务暂未接入：语音识别仍走浏览器 SpeechRecognition）。
   *
   * 保留在这里是为了让前端与后端契约一一对应；接入时直接把
   * MediaRecorder 产出的 Blob 传进来即可。
   */
  transcribe: async (audio: Blob): Promise<VoiceText> => {
    const data = await client.post('/voice/transcribe', audio, {
      silent: true,
      timeout: 60000,
      headers: { 'Content-Type': audio.type || 'audio/wav' },
    })
    return data as unknown as VoiceText
  },
}
