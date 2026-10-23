import { useEffect, useRef, useState } from 'react'

import {
  estimateReadMs,
  joinTranscript,
  VOICE_MAX_LISTEN_MS,
  VOICE_NO_SPEECH_HINT_MS,
  VOICE_REVIEW_MS,
  VOICE_SILENCE_MS,
  withBridge,
  type VoiceBridgeKind,
} from '@/constants/voice'
import { INTERVIEW_SKIP_ANSWER } from '@/constants/interview'
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis'
import { useVoiceInput } from '@/hooks/useVoiceInput'

/**
 * 全真模拟的“通话状态机”。
 *
 * 流程：
 *   speaking  —— TTS 读题/追问
 *   listening —— 自动开麦，实时字幕
 *   reviewing —— 说完后留 2 秒“继续补充”，超时自动提交
 *   thinking  —— 调现有 answer 接口，等追问/下一题
 *   回到 speaking 或 finished
 *
 * 这里**不生成任何题目**：下一句文字完全来自页面传入的 onAnswer（现有题库/追问模块）。
 * 语音层只负责“读出来”和“听进去”。
 */

export type VoiceCallState =
  | 'idle'
  | 'speaking'
  | 'listening'
  | 'reviewing'
  | 'thinking'
  | 'finished'
  | 'error'

export interface VoiceTurnResult {
  /** 下一句要读的文字（追问或下一题）；为空表示流程结束 */
  nextText?: string | null
  /** 下一句的口头衔接类型 */
  nextKind?: VoiceBridgeKind
  /** 整场结束 */
  done?: boolean
  /** 结束前朗读的告别语 */
  closing?: string
  /** 结束动作（生成复盘并跳转） */
  onDone?: () => Promise<void> | void
  error?: string
}

export interface UseVoiceCallOptions {
  onAnswer: (text: string) => Promise<VoiceTurnResult>
}

export interface VoiceCallApi {
  state: VoiceCallState
  caption: string
  transcript: string
  interim: string
  error: string | null
  hint: string | null
  asrSupported: boolean
  ttsSupported: boolean
  startTurn: (text: string, kind?: VoiceBridgeKind) => void
  stopListening: () => void
  continueSpeaking: () => void
  commitNow: () => void
  replay: () => void
  bargeIn: () => void
  skip: () => void
  switchToText: () => Promise<string>
  retry: () => void
  stop: () => void
  clearError: () => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function useVoiceCall(options: UseVoiceCallOptions): VoiceCallApi {
  const synth = useSpeechSynthesis()
  const [state, setState] = useState<VoiceCallState>('idle')
  const [caption, setCaption] = useState('')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const stateRef = useRef<VoiceCallState>('idle')
  const captionRef = useRef('')
  const speakTextRef = useRef('')
  const transcriptRef = useRef('')
  const baseTranscriptRef = useRef('')
  const turnRef = useRef(0)
  const listenTurnRef = useRef(0)
  const retryCountRef = useRef(0)
  const reviewTimerRef = useRef<number | null>(null)
  const silenceTimerRef = useRef<number | null>(null)
  const noSpeechTimerRef = useRef<number | null>(null)
  const maxListenTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const onAnswerRef = useRef(options.onAnswer)
  onAnswerRef.current = options.onAnswer

  const synthRef = useRef(synth)
  synthRef.current = synth

  const recognition = useVoiceInput({
    onInterim: (text) => {
      if (stateRef.current !== 'listening') return
      setInterim(text)
      setHint(null)
      setError(null)
      scheduleSilence(VOICE_SILENCE_MS + 400)
    },
    onFinal: (text) => {
      if (stateRef.current !== 'listening') return
      setInterim(text)
      scheduleSilence(VOICE_SILENCE_MS + 400)
    },
    onSpeechEnd: () => {
      if (stateRef.current !== 'listening') return
      scheduleSilence(VOICE_SILENCE_MS)
    },
    onError: (message, code) => {
      if (stateRef.current !== 'listening') return
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

  /**
   * 这些函数互相调用（finalize -> beginListening，commit -> startTurn），
   * 用 ref 打破循环；每次 render 后把最新实现写进去。
   */
  const actionsRef = useRef({
    beginListening: (_base?: string) => {},
    finalize: () => {},
    commit: (_text?: string) => {},
    startTurn: (_text: string, _kind?: VoiceBridgeKind) => {},
  })

  function setStateBoth(next: VoiceCallState) {
    stateRef.current = next
    if (mountedRef.current) setState(next)
  }

  function setTranscriptBoth(next: string) {
    transcriptRef.current = next
    if (mountedRef.current) setTranscript(next)
  }

  function clearTimers() {
    if (reviewTimerRef.current !== null) {
      window.clearTimeout(reviewTimerRef.current)
      reviewTimerRef.current = null
    }
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
    if (noSpeechTimerRef.current !== null) {
      window.clearTimeout(noSpeechTimerRef.current)
      noSpeechTimerRef.current = null
    }
    if (maxListenTimerRef.current !== null) {
      window.clearTimeout(maxListenTimerRef.current)
      maxListenTimerRef.current = null
    }
  }

  function scheduleSilence(ms: number) {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current)
    }
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null
      actionsRef.current.finalize()
    }, ms)
  }

  function beginListening(base = '') {
    clearTimers()
    const turn = turnRef.current + 1
    turnRef.current = turn
    listenTurnRef.current = turn
    baseTranscriptRef.current = base
    setInterim('')
    setError(null)
    setHint(null)

    if (!recognitionRef.current.supported) {
      setError('当前浏览器不支持语音识别，请改用文字作答。')
      setStateBoth('error')
      return
    }

    setStateBoth('listening')
    const ok = recognitionRef.current.start()
    if (!ok) {
      setError('语音识别没有启动，可以改用文字作答。')
      setStateBoth('error')
      return
    }

    noSpeechTimerRef.current = window.setTimeout(() => {
      noSpeechTimerRef.current = null
      if (stateRef.current === 'listening' && listenTurnRef.current === turn) {
        setHint('没听到声音，不着急，想到什么就说什么。')
      }
    }, VOICE_NO_SPEECH_HINT_MS)

    maxListenTimerRef.current = window.setTimeout(() => {
      maxListenTimerRef.current = null
      if (stateRef.current === 'listening' && listenTurnRef.current === turn) {
        actionsRef.current.finalize()
      }
    }, VOICE_MAX_LISTEN_MS)
  }

  function finalize() {
    if (stateRef.current !== 'listening') return
    const turn = listenTurnRef.current
    clearTimers()
    setStateBoth('reviewing')

    // 浏览器要等最终结果，云端要等上传+转写，统一走 stopAndWait
    void (async () => {
      const latest = (await recognitionRef.current.stopAndWait()).trim()
      if (!mountedRef.current || turn !== listenTurnRef.current) return
      const merged = joinTranscript(baseTranscriptRef.current, latest).trim()

      if (!merged) {
        retryCountRef.current += 1
        if (retryCountRef.current <= 1) {
          setHint('没听清，再说一次？')
          setStateBoth('idle')
          window.setTimeout(() => {
            if (mountedRef.current && stateRef.current === 'idle') {
              actionsRef.current.beginListening(baseTranscriptRef.current)
            }
          }, 500)
        } else {
          setError('没听到声音，可以改用文字回答。')
          setStateBoth('error')
        }
        return
      }

      retryCountRef.current = 0
      setTranscriptBoth(merged)
      setStateBoth('reviewing')
      reviewTimerRef.current = window.setTimeout(() => {
        reviewTimerRef.current = null
        actionsRef.current.commit(merged)
      }, VOICE_REVIEW_MS)
    })()
  }

  async function applyResult(result: VoiceTurnResult, turn: number) {
    if (!mountedRef.current || turn !== turnRef.current) return
    if (result.error) {
      setError(result.error)
      setStateBoth('error')
      return
    }
    if (result.done) {
      if (result.closing) {
        setStateBoth('speaking')
        await synthRef.current.speak(result.closing)
        if (!mountedRef.current || turn !== turnRef.current) return
      }
      if (result.onDone) await result.onDone()
      if (mountedRef.current) setStateBoth('finished')
      return
    }
    if (result.nextText) {
      actionsRef.current.startTurn(result.nextText, result.nextKind ?? 'none')
      return
    }
    setStateBoth('idle')
  }

  function commit(text?: string) {
    if (stateRef.current !== 'reviewing') return
    const clean = (text ?? transcriptRef.current).trim()
    if (!clean) {
      actionsRef.current.beginListening(baseTranscriptRef.current)
      return
    }
    clearTimers()
    const turn = turnRef.current
    setStateBoth('thinking')
    void (async () => {
      try {
        const result = await onAnswerRef.current(clean)
        await applyResult(result, turn)
      } catch {
        if (!mountedRef.current) return
        setError('提交失败，可以改用文字继续。')
        setStateBoth('error')
      }
    })()
  }

  function startTurn(text: string, kind: VoiceBridgeKind = 'none') {
    const clean = text.trim()
    if (!clean) return
    const turn = turnRef.current + 1
    turnRef.current = turn
    clearTimers()
    recognitionRef.current.abort()
    synthRef.current.cancel()
    retryCountRef.current = 0
    baseTranscriptRef.current = ''
    setTranscriptBoth('')
    setInterim('')
    setError(null)
    setHint(null)
    captionRef.current = clean
    if (mountedRef.current) setCaption(clean)
    speakTextRef.current = withBridge(kind, clean)
    setStateBoth('speaking')

    void (async () => {
      const ok = await synthRef.current.speak(speakTextRef.current)
      if (!mountedRef.current || turn !== turnRef.current) return
      if (stateRef.current !== 'speaking') return
      if (!ok) {
        // TTS 不支持/失败：按题目长度留出阅读时间，再开麦，流程不中断
        await sleep(estimateReadMs(clean))
        if (!mountedRef.current || turn !== turnRef.current) return
        if (stateRef.current !== 'speaking') return
      }
      actionsRef.current.beginListening()
    })()
  }

  function replay() {
    if (!speakTextRef.current) return
    if (stateRef.current === 'thinking' || stateRef.current === 'finished') return
    const turn = turnRef.current + 1
    turnRef.current = turn
    clearTimers()
    recognitionRef.current.abort()
    synthRef.current.cancel()
    setTranscriptBoth('')
    setInterim('')
    setError(null)
    setHint(null)
    setStateBoth('speaking')

    void (async () => {
      const ok = await synthRef.current.speak(speakTextRef.current)
      if (!mountedRef.current || turn !== turnRef.current) return
      if (stateRef.current !== 'speaking') return
      if (!ok) {
        await sleep(estimateReadMs(captionRef.current))
        if (!mountedRef.current || turn !== turnRef.current) return
        if (stateRef.current !== 'speaking') return
      }
      actionsRef.current.beginListening()
    })()
  }

  function continueSpeaking() {
    if (stateRef.current !== 'reviewing' || !transcriptRef.current) return
    clearTimers()
    baseTranscriptRef.current = transcriptRef.current
    actionsRef.current.beginListening(transcriptRef.current)
  }

  function commitNow() {
    if (stateRef.current !== 'reviewing' || !transcriptRef.current) return
    clearTimers()
    actionsRef.current.commit(transcriptRef.current)
  }

  function stopListening() {
    actionsRef.current.finalize()
  }

  function bargeIn() {
    if (stateRef.current !== 'speaking') return
    // cancel 会让 startTurn 里的 speak Promise 结束；随后我们主动开麦
    synthRef.current.cancel()
    actionsRef.current.beginListening()
  }

  function skip() {
    const turn = turnRef.current + 1
    turnRef.current = turn
    clearTimers()
    recognitionRef.current.abort()
    synthRef.current.cancel()
    setInterim('')
    setError(null)
    setHint(null)
    setStateBoth('thinking')

    void (async () => {
      try {
        const result = await onAnswerRef.current(INTERVIEW_SKIP_ANSWER)
        await applyResult(result, turn)
      } catch {
        if (!mountedRef.current) return
        setError('跳过失败，可以改用文字继续。')
        setStateBoth('error')
      }
    })()
  }

  async function switchToText(): Promise<string> {
    const turn = turnRef.current + 1
    turnRef.current = turn
    clearTimers()
    let text = transcriptRef.current
    if (stateRef.current === 'listening') {
      const latest = await recognitionRef.current.stopAndWait()
      if (mountedRef.current && turn === turnRef.current) {
        text = joinTranscript(baseTranscriptRef.current, latest.trim())
      }
    }
    recognitionRef.current.abort()
    synthRef.current.cancel()
    setInterim('')
    setStateBoth('idle')
    return text.trim()
  }

  function retry() {
    if (stateRef.current !== 'error') return
    setError(null)
    if (transcriptRef.current) {
      setStateBoth('reviewing')
      actionsRef.current.commit(transcriptRef.current)
      return
    }
    actionsRef.current.beginListening(baseTranscriptRef.current)
  }

  function stop() {
    turnRef.current += 1
    clearTimers()
    recognitionRef.current.abort()
    synthRef.current.cancel()
    setInterim('')
    setHint(null)
    setStateBoth('idle')
  }

  function clearError() {
    if (mountedRef.current) setError(null)
  }

  actionsRef.current = {
    beginListening,
    finalize,
    commit,
    startTurn,
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimers()
      recognitionRef.current.abort()
      synthRef.current.cancel()
    }
    // 只在卸载时清理；内部函数通过 ref 读取最新值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    state,
    caption,
    transcript,
    interim,
    error,
    hint,
    asrSupported: recognition.supported,
    ttsSupported: synth.supported,
    startTurn,
    stopListening,
    continueSpeaking,
    commitNow,
    replay,
    bargeIn,
    skip,
    switchToText,
    retry,
    stop,
    clearError,
  }
}
