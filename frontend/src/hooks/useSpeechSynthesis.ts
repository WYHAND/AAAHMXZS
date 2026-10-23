import { useCallback, useEffect, useRef, useState } from 'react'

import { voiceApi } from '@/api/voice'

/**
 * 语音朗读（TTS）：优先阿里百炼云端音色，失败/未配置时回退浏览器 speechSynthesis。
 *
 * 为什么保留浏览器兜底：
 * - 云端 TTS 依赖后端与外部服务，未配置、断网、额度用尽时都会失败；
 * - 浏览器系统中文音色通常离线可用，至少能保证面试流程不中断；
 * - 云端失败不弹全局错误，本次朗读直接换浏览器音色，用户感知不到。
 *
 * 浏览器 speechSynthesis 的两个坑仍然要处理：
 * 1. `getVoices()` 首次可能为空，要等 `voiceschanged`；
 * 2. Chrome 朗读很长的文本可能在 15 秒左右自己停，所以按句切开、逐句朗读，
 *    并给每一句加一个看门狗（onend 不触发时继续下一句）。
 *
 * 云端音频用 HTMLAudioElement 播放：
 * - 不引入 Web Audio 的 decodeAudioData，MP3 直接交给 <audio> 更省事；
 * - `play()` 返回的 Promise 在自动播放被拦时会 reject，这里接住并回退，
 *   绝不让异常冒到控制台。
 */

export interface SpeakOptions {
  rate?: number
  pitch?: number
  volume?: number
}

export interface SpeechSynthesisState {
  supported: boolean
  speaking: boolean
  voiceName: string | null
  /** 朗读一段文字；被 cancel/打断时 resolve(false) */
  speak: (text: string, options?: SpeakOptions) => Promise<boolean>
  cancel: () => void
}

/** 云端 TTS 单次请求的后端上限是 1000 字，留一点余量并在前端先切好 */
const CLOUD_MAX_CHARS = 900

/** 同一次会话里最多缓存多少段音频（重听同一句不再请求） */
const CLOUD_CACHE_MAX = 40

/** 按中文标点切句；单句过长再按逗号切，避免 Chrome 长文本卡住 */
function splitForSpeech(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^。！？!?；;\n]+[。！？!?；;\n]?/g) ?? [clean]
  const chunks: string[] = []
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    if (trimmed.length <= 80) {
      chunks.push(trimmed)
      continue
    }
    // 长句按逗号/顿号再切，保证每段不超过 ~80 字
    const parts = trimmed.split(/(?<=[，,、])/)
    let buffer = ''
    for (const part of parts) {
      if ((buffer + part).length > 80 && buffer) {
        chunks.push(buffer)
        buffer = part
      } else {
        buffer += part
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim())
  }
  return chunks
}

/** 把文本切成若干段，每段不超过云端接口上限 */
function splitForCloud(text: string): string[] {
  const pieces: string[] = []
  for (const sentence of splitForSpeech(text)) {
    if (sentence.length <= CLOUD_MAX_CHARS) {
      pieces.push(sentence)
      continue
    }
    // 极端情况：整句没有标点，硬切
    for (let i = 0; i < sentence.length; i += CLOUD_MAX_CHARS) {
      pieces.push(sentence.slice(i, i + CLOUD_MAX_CHARS))
    }
  }

  const parts: string[] = []
  let buffer = ''
  for (const piece of pieces) {
    if (buffer && buffer.length + piece.length > CLOUD_MAX_CHARS) {
      parts.push(buffer)
      buffer = piece
    } else {
      buffer += piece
    }
  }
  if (buffer.trim()) parts.push(buffer.trim())
  return parts.length ? parts : [text.trim()]
}

/** 系统里挑一个最像“面试官”的中文音色 */
function pickChineseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const chinese = voices.filter((voice) => voice.lang.toLowerCase().startsWith('zh'))
  if (!chinese.length) return null
  const preferred = [
    /Xiaoxiao/i,
    /Huihui/i,
    /Yaoyao/i,
    /Kangkang/i,
    /Ting-?Ting/i,
    /Google.*(普通话|Chinese)/i,
    /Chinese/i,
  ]
  for (const pattern of preferred) {
    const found = chinese.find((voice) => pattern.test(voice.name))
    if (found) return found
  }
  return chinese[0]
}

/** 后端给的是裸 base64（也可能带 data URI 前缀），统一转成 Blob */
function base64ToBlob(base64: string, mime: string): Blob {
  const comma = base64.indexOf(',')
  const raw = base64.startsWith('data:') && comma >= 0 ? base64.slice(comma + 1) : base64
  const binary = atob(raw)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime || 'audio/mpeg' })
}

interface CachedAudio {
  blob: Blob
  mime: string
}

export function useSpeechSynthesis(): SpeechSynthesisState {
  const [browserSupported] = useState(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window,
  )
  const [cloudEnabled, setCloudEnabled] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voiceName, setVoiceName] = useState<string | null>(null)

  const browserSupportedRef = useRef(browserSupported)
  const cloudEnabledRef = useRef(false)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const tokenRef = useRef(0)
  const watchdogRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  /** 当前云端音频元素与 object URL，cancel 时要停掉并释放 */
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioUrlRef = useRef<string | null>(null)
  /** 让挂起的云端播放 Promise 立刻 resolve(false) */
  const stopAudioRef = useRef<(() => void) | null>(null)
  /** 按文本缓存 Blob，最多 CLOUD_CACHE_MAX 条（Map 保持插入顺序，用于淘汰最旧） */
  const cacheRef = useRef<Map<string, CachedAudio>>(new Map())

  const supported = cloudEnabled || browserSupported

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  /** 停掉云端音频、让正在等待的 play Promise 结束，并释放 URL */
  const stopCloudAudio = useCallback(() => {
    const stop = stopAudioRef.current
    stopAudioRef.current = null
    if (stop) stop()

    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      try {
        audio.pause()
      } catch {
        /* 某些浏览器在空 src 上 pause 会抛，忽略 */
      }
      audio.removeAttribute('src')
      try {
        audio.load()
      } catch {
        /* 忽略：只是为了尽早释放解码资源 */
      }
    }

    const url = audioUrlRef.current
    audioUrlRef.current = null
    if (url) URL.revokeObjectURL(url)
  }, [])

  const cancel = useCallback(() => {
    tokenRef.current += 1
    clearWatchdog()
    stopCloudAudio()
    if (browserSupportedRef.current) {
      window.speechSynthesis.cancel()
    }
    if (mountedRef.current) setSpeaking(false)
  }, [clearWatchdog, stopCloudAudio])

  /* ------------------------- 挂载 / 卸载生命周期 ------------------------- */

  useEffect(() => {
    mountedRef.current = true
    const canUseBrowser = browserSupportedRef.current
    return () => {
      mountedRef.current = false
      tokenRef.current += 1
      clearWatchdog()
      stopCloudAudio()
      if (canUseBrowser) {
        window.speechSynthesis.cancel()
      }
    }
  }, [clearWatchdog, stopCloudAudio])

  /* ------------------------- 云端状态：是否启用 ------------------------- */

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const status = await voiceApi.status()
        if (cancelled || !mountedRef.current) return
        // 目前只适配阿里百炼；以后接别的厂商时在这里加分支
        if (status.configured && status.provider === 'aliyun') {
          const model = status.tts_model?.trim()
          cloudEnabledRef.current = true
          setCloudEnabled(true)
          setVoiceName(model ? `阿里百炼 · ${model}` : '阿里百炼')
        }
      } catch {
        // 未配置 / 未登录 / 网络失败：静默继续用浏览器音色
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  /* ------------------------- 浏览器音色：名称与刷新 ------------------------- */

  useEffect(() => {
    if (!browserSupported) return
    const synth = window.speechSynthesis

    const refreshVoices = () => {
      const voice = pickChineseVoice(synth.getVoices())
      voiceRef.current = voice
      // 云端模式下 voiceName 显示模型名，不要被系统音色覆盖
      if (mountedRef.current && !cloudEnabledRef.current) {
        setVoiceName(voice?.name ?? null)
      }
    }

    refreshVoices()
    // 部分浏览器只提供 onvoiceschanged，没有 addEventListener
    synth.onvoiceschanged = refreshVoices

    return () => {
      synth.onvoiceschanged = null
    }
  }, [browserSupported])

  /* ------------------------- 云端音频：缓存 + 播放 ------------------------- */

  const getCloudAudio = useCallback(async (text: string): Promise<CachedAudio> => {
    const cached = cacheRef.current.get(text)
    if (cached) {
      // 命中后挪到末尾：最近用过的最后淘汰
      cacheRef.current.delete(text)
      cacheRef.current.set(text, cached)
      return cached
    }

    const data = await voiceApi.tts(text)
    const mime = data.mime || 'audio/mpeg'
    const blob = base64ToBlob(data.audio, mime)
    if (!blob.size) throw new Error('云端返回了空音频')

    const entry: CachedAudio = { blob, mime }
    cacheRef.current.set(text, entry)
    while (cacheRef.current.size > CLOUD_CACHE_MAX) {
      const oldest = cacheRef.current.keys().next().value
      if (oldest === undefined) break
      cacheRef.current.delete(oldest)
    }
    return entry
  }, [])

  const playCloudBlob = useCallback(
    (blob: Blob, token: number): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.preload = 'auto'
        audioRef.current = audio
        audioUrlRef.current = url

        let settled = false
        const finish = (ok: boolean) => {
          if (settled) return
          settled = true
          audio.onended = null
          audio.onerror = null
          if (stopAudioRef.current === stop) stopAudioRef.current = null
          if (audioRef.current === audio) audioRef.current = null
          if (audioUrlRef.current === url) {
            audioUrlRef.current = null
            URL.revokeObjectURL(url)
          }
          // cancel / 被新朗读接管时，即使 audio 触发了 ended 也算失败
          resolve(token === tokenRef.current ? ok : false)
        }
        const stop = () => finish(false)
        stopAudioRef.current = stop

        audio.onended = () => finish(true)
        audio.onerror = () => finish(false)

        try {
          const played = audio.play()
          if (played && typeof played.catch === 'function') {
            // 自动播放被拦（NotAllowedError）或解码失败：回退浏览器 TTS
            played.catch(() => finish(false))
          }
        } catch {
          // 老浏览器 play() 不返回 Promise，直接抛
          finish(false)
        }
      }),
    [],
  )

  /** 依次播放各段云端音频；任何一段失败都返回 false，由上层决定是否回退 */
  const speakCloud = useCallback(
    async (text: string, token: number): Promise<boolean> => {
      for (const part of splitForCloud(text)) {
        if (token !== tokenRef.current) return false

        let media: CachedAudio
        try {
          media = await getCloudAudio(part)
        } catch {
          return false
        }

        if (token !== tokenRef.current) return false
        const ok = await playCloudBlob(media.blob, token)
        if (!ok) return false
        if (token !== tokenRef.current) return false
      }
      return true
    },
    [getCloudAudio, playCloudBlob],
  )

  /* ------------------------- 浏览器朗读（兜底） ------------------------- */

  const speakWithBrowser = useCallback(
    (text: string, options: SpeakOptions | undefined, token: number): Promise<boolean> => {
      if (!browserSupportedRef.current) return Promise.resolve(false)
      const synth = window.speechSynthesis
      const chunks = splitForSpeech(text)
      if (!chunks.length) return Promise.resolve(false)

      const wasBusy = synth.speaking || synth.pending
      synth.cancel()

      return new Promise<boolean>((resolve) => {
        let index = 0
        let settled = false

        const finish = (ok: boolean) => {
          if (settled) return
          settled = true
          clearWatchdog()
          if (mountedRef.current && token === tokenRef.current) setSpeaking(false)
          resolve(ok)
        }

        const speakNext = () => {
          if (settled) return
          if (token !== tokenRef.current) {
            finish(false)
            return
          }
          if (index >= chunks.length) {
            finish(true)
            return
          }

          const chunk = chunks[index]
          index += 1
          const utterance = new SpeechSynthesisUtterance(chunk)
          utterance.lang = 'zh-CN'
          utterance.rate = options?.rate ?? 1
          utterance.pitch = options?.pitch ?? 1
          utterance.volume = options?.volume ?? 1
          if (voiceRef.current) utterance.voice = voiceRef.current

          utterance.onend = () => {
            clearWatchdog()
            speakNext()
          }
          utterance.onerror = () => {
            clearWatchdog()
            finish(false)
          }

          // 看门狗：onend 不触发时继续下一句，避免整个通话卡死
          clearWatchdog()
          watchdogRef.current = window.setTimeout(
            () => {
              watchdogRef.current = null
              speakNext()
            },
            Math.min(20000, Math.max(4000, chunk.length * 260 + 2500)),
          )

          try {
            synth.speak(utterance)
          } catch {
            clearWatchdog()
            finish(false)
          }
        }

        // Chrome 在 cancel() 后立刻 speak 偶尔会吞掉第一句；上一段还在播时稍等一拍
        if (wasBusy) {
          window.setTimeout(speakNext, 80)
        } else {
          speakNext()
        }
      })
    },
    [clearWatchdog],
  )

  /* ------------------------------- speak ------------------------------- */

  const speak = useCallback(
    (text: string, options?: SpeakOptions): Promise<boolean> => {
      const clean = text.replace(/\s+/g, ' ').trim()
      if (!clean) return Promise.resolve(false)

      const browserOk = browserSupportedRef.current
      const useCloud = cloudEnabledRef.current
      if (!useCloud && !browserOk) return Promise.resolve(false)

      // 新的朗读开始：取消上一段（云端 + 浏览器），并让上一段的 Promise 走 false
      tokenRef.current += 1
      const token = tokenRef.current
      clearWatchdog()
      stopCloudAudio()
      if (browserOk) window.speechSynthesis.cancel()
      if (mountedRef.current) setSpeaking(true)

      if (!useCloud) {
        return speakWithBrowser(clean, options, token)
      }

      return speakCloud(clean, token).then((ok) => {
        if (ok) {
          if (mountedRef.current && token === tokenRef.current) setSpeaking(false)
          return true
        }

        // 被 cancel / 新的朗读接管：不要再用浏览器把上一段念一遍
        if (token !== tokenRef.current) return false

        if (!browserOk) {
          if (mountedRef.current) setSpeaking(false)
          return false
        }

        // 云端失败（含自动播放被拦）：本次朗读静默回退浏览器音色
        return speakWithBrowser(clean, options, token)
      })
    },
    [clearWatchdog, speakCloud, speakWithBrowser, stopCloudAudio],
  )

  return { supported, speaking, voiceName, speak, cancel }
}
