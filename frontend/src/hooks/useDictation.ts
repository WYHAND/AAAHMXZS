import { useEffect, useRef, useState } from 'react'

import {
  DICTATION_MAX_LISTEN_MS,
  DICTATION_SILENCE_MS,
} from '@/constants/voice'
import { useVoiceInput } from '@/hooks/useVoiceInput'

/**
 * 小测试的“语音输入”。
 *
 * 和全真通话的区别：
 * - 不自动读题、不自动提交；
 * - 说完只把文字交给输入框，用户可以继续改；
 * - 识别失败只给一句提示，不打断页面。
 */

export type DictationState = 'idle' | 'listening' | 'processing' | 'error'

export interface UseDictationOptions {
  onText: (text: string) => void
}

export interface DictationApi {
  supported: boolean
  state: DictationState
  listening: boolean
  processing: boolean
  interim: string
  error: string | null
  start: () => void
  finish: () => void
  toggle: () => void
  cancel: () => void
  clearError: () => void
}

export function useDictation(options: UseDictationOptions): DictationApi {
  const [state, setState] = useState<DictationState>('idle')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)

  const stateRef = useRef<DictationState>('idle')
  const silenceTimerRef = useRef<number | null>(null)
  const maxTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)
  const onTextRef = useRef(options.onText)
  onTextRef.current = options.onText

  const recognition = useVoiceInput({
    onInterim: (text) => {
      if (stateRef.current !== 'listening') return
      setInterim(text)
      setError(null)
      scheduleSilence(DICTATION_SILENCE_MS + 400)
    },
    onFinal: (text) => {
      if (stateRef.current !== 'listening') return
      setInterim(text)
      scheduleSilence(DICTATION_SILENCE_MS + 400)
    },
    onSpeechEnd: () => {
      if (stateRef.current !== 'listening') return
      scheduleSilence(DICTATION_SILENCE_MS)
    },
    onError: (message, code) => {
      if (code === 'no-speech') {
        setError(message)
        return
      }
      setError(message)
      if (
        code === 'network' ||
        code === 'not-allowed' ||
        code === 'service-not-allowed' ||
        code === 'audio-capture'
      ) {
        clearTimers()
        setStateBoth('error')
      }
    },
  })
  const recognitionRef = useRef(recognition)
  recognitionRef.current = recognition

  function setStateBoth(next: DictationState) {
    stateRef.current = next
    if (mountedRef.current) setState(next)
  }

  function clearTimers() {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current)
      maxTimerRef.current = null
    }
  }

  function scheduleSilence(ms: number) {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
    }
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null
      finish()
    }, ms)
  }

  function finish() {
    if (stateRef.current !== 'listening') return
    clearTimers()
    setStateBoth('processing')

    void (async () => {
      const text = (await recognitionRef.current.stopAndWait()).trim()
      if (!mountedRef.current) return
      setInterim('')
      if (!text) {
        setError('没听清，再说一次？')
        setStateBoth('idle')
        return
      }
      onTextRef.current(text)
      setStateBoth('idle')
    })()
  }

  function start() {
    if (stateRef.current === 'processing' || stateRef.current === 'listening') return
    if (!recognitionRef.current.supported) {
      setError('当前浏览器不支持语音输入，直接打字就好。')
      setStateBoth('error')
      return
    }
    clearTimers()
    setError(null)
    setInterim('')
    recognitionRef.current.reset()
    setStateBoth('listening')
    const ok = recognitionRef.current.start()
    if (!ok) {
      setError('语音输入没有启动，直接打字就好。')
      setStateBoth('error')
      return
    }
    maxTimerRef.current = window.setTimeout(() => {
      maxTimerRef.current = null
      finish()
    }, DICTATION_MAX_LISTEN_MS)
  }

  function toggle() {
    if (stateRef.current === 'processing') return
    if (stateRef.current === 'listening') {
      finish()
      return
    }
    start()
  }

  function cancel() {
    clearTimers()
    recognitionRef.current.abort()
    setInterim('')
    setStateBoth('idle')
  }

  function clearError() {
    if (mountedRef.current) setError(null)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimers()
      recognitionRef.current.abort()
    }
    // 只在卸载时清理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    supported: recognition.supported,
    state,
    listening: state === 'listening',
    processing: state === 'processing',
    interim,
    error,
    start,
    finish,
    toggle,
    cancel,
    clearError,
  }
}
