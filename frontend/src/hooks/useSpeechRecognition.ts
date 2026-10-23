import { useCallback, useEffect, useRef, useState } from 'react'

import { joinTranscript } from '@/constants/voice'
import {
  getSpeechRecognitionCtor,
  speechErrorMessage,
  type AicareerSpeechRecognition,
  type AicareerSpeechErrorEvent,
  type AicareerSpeechResultEvent,
} from '@/voice/speech'

/**
 * 浏览器语音识别（ASR）。
 *
 * 设计目标：
 * - 能连续听：Chrome 的 continuous 模式仍可能自己结束，所以 `onend` 时如果
 *   调用方还想听，就自动重启；
 * - 能拿到“中间字幕”和“最终文字”：interimResults 打开；
 * - 失败必须可降级：不支持 / 没权限 / 断网 -> 返回错误文案，调用方切文字。
 *
 * 注意：这个能力依赖浏览器厂商的识别服务。国内 Chrome 可能因为连不上
 * Google 而报 network；Electron 一般没有识别。所以**不能把语音当成唯一入口**。
 */

export interface SpeechRecognitionOptions {
  lang?: string
  continuous?: boolean
  interimResults?: boolean
  /** 中间结果（含已确认的最终文字），用于实时字幕 */
  onInterim?: (text: string) => void
  /** 最终文字（累计），用于提交 */
  onFinal?: (text: string) => void
  /** 浏览器认为“用户说完了一句” */
  onSpeechEnd?: () => void
  onError?: (message: string, code: string) => void
  /** 真正停止（不是自动重启）时回调 */
  onEnd?: () => void
}

export interface SpeechRecognitionState {
  supported: boolean
  listening: boolean
  interim: string
  finalText: string
  error: string | null
  start: () => boolean
  stop: () => void
  abort: () => void
  reset: () => void
  clearError: () => void
  getTranscript: () => string
}

const MAX_RESTARTS = 6

export function useSpeechRecognition(
  options: SpeechRecognitionOptions = {},
): SpeechRecognitionState {
  const [supported] = useState(() => getSpeechRecognitionCtor() !== null)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [finalText, setFinalText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const optionsRef = useRef(options)
  const recognitionRef = useRef<AicareerSpeechRecognition | null>(null)
  const wantRef = useRef(false)
  const manualStopRef = useRef(false)
  const restartTimerRef = useRef<number | null>(null)
  const restartCountRef = useRef(0)
  const finalRef = useRef('')
  const interimRef = useRef('')
  const mountedRef = useRef(true)

  // 保持回调最新；放在 effect 里，避免在 render 阶段写 ref（React Compiler 会跳过优化）
  useEffect(() => {
    optionsRef.current = options
  })

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
  }, [])

  const createRecognition = useCallback((): AicareerSpeechRecognition | null => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return null
    const recognition = new Ctor()
    recognition.lang = optionsRef.current.lang ?? 'zh-CN'
    recognition.continuous = optionsRef.current.continuous ?? true
    recognition.interimResults = optionsRef.current.interimResults ?? true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      if (!mountedRef.current) return
      setListening(true)
      setError(null)
    }

    recognition.onresult = (event: AicareerSpeechResultEvent) => {
      restartCountRef.current = 0
      let nextInterim = ''
      let hasFinal = false

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          finalRef.current = joinTranscript(finalRef.current, text)
          hasFinal = true
        } else {
          nextInterim += text
        }
      }

      if (hasFinal) {
        if (mountedRef.current) setFinalText(finalRef.current)
        optionsRef.current.onFinal?.(finalRef.current)
      }

      interimRef.current = nextInterim
      if (mountedRef.current) setInterim(nextInterim)

      const current = joinTranscript(finalRef.current, nextInterim)
      if (current) optionsRef.current.onInterim?.(current)
    }

    recognition.onspeechend = () => {
      optionsRef.current.onSpeechEnd?.()
    }

    recognition.onerror = (event: AicareerSpeechErrorEvent) => {
      const code = event.error
      if (code === 'aborted') return
      const message = speechErrorMessage(code)
      if (message && mountedRef.current) setError(message)
      if (message) optionsRef.current.onError?.(message, code)

      // 这些错误重试也没用：立刻停掉自动重启，交给调用方降级文字
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        wantRef.current = false
        manualStopRef.current = true
        if (mountedRef.current) setListening(false)
      }
    }

    recognition.onnomatch = () => {
      if (mountedRef.current) setError('没听清，再说一次？')
    }

    recognition.onend = () => {
      // 连续模式被浏览器自己结束：只要调用方还想听，就自动重启
      if (wantRef.current && !manualStopRef.current) {
        if (restartCountRef.current >= MAX_RESTARTS) {
          wantRef.current = false
          if (mountedRef.current) {
            setListening(false)
            setError('语音识别反复中断，可以改用文字回答。')
          }
          return
        }
        restartCountRef.current += 1
        clearRestartTimer()
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null
          if (!wantRef.current || manualStopRef.current) return
          try {
            recognitionRef.current?.start()
          } catch {
            // 有些浏览器在旧实例 end 之前不允许 start；下一轮 onend 不再触发时
            // 调用方会通过静音计时器收尾，这里不额外抛错。
          }
        }, 220)
        return
      }

      if (mountedRef.current) setListening(false)
      optionsRef.current.onEnd?.()
    }

    return recognition
  }, [clearRestartTimer])

  const start = useCallback((): boolean => {
    if (!supported) return false
    if (wantRef.current) return true

    if (!recognitionRef.current) {
      recognitionRef.current = createRecognition()
    }
    const recognition = recognitionRef.current
    if (!recognition) return false

    wantRef.current = true
    manualStopRef.current = false
    restartCountRef.current = 0
    finalRef.current = ''
    interimRef.current = ''
    if (mountedRef.current) {
      setFinalText('')
      setInterim('')
      setError(null)
      setListening(true)
    }

    try {
      recognition.start()
      return true
    } catch {
      // InvalidStateError：上一次还没完全结束。保持 listening，等 onend 重启。
      return true
    }
  }, [createRecognition, supported])

  const stop = useCallback(() => {
    wantRef.current = false
    manualStopRef.current = true
    clearRestartTimer()
    try {
      recognitionRef.current?.stop()
    } catch {
      // 已经停了
    }
    if (mountedRef.current) setListening(false)
  }, [clearRestartTimer])

  const abort = useCallback(() => {
    wantRef.current = false
    manualStopRef.current = true
    clearRestartTimer()
    try {
      recognitionRef.current?.abort()
    } catch {
      // 已经停了
    }
    if (mountedRef.current) setListening(false)
  }, [clearRestartTimer])

  const reset = useCallback(() => {
    finalRef.current = ''
    interimRef.current = ''
    if (mountedRef.current) {
      setFinalText('')
      setInterim('')
      setError(null)
    }
  }, [])

  const clearError = useCallback(() => {
    if (mountedRef.current) setError(null)
  }, [])

  const getTranscript = useCallback(
    () => joinTranscript(finalRef.current, interimRef.current).trim(),
    [],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      wantRef.current = false
      manualStopRef.current = true
      clearRestartTimer()
      try {
        recognitionRef.current?.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
  }, [clearRestartTimer])

  return {
    supported,
    listening,
    interim,
    finalText,
    error,
    start,
    stop,
    abort,
    reset,
    clearError,
    getTranscript,
  }
}
