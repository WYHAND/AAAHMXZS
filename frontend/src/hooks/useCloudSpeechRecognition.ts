import { useCallback, useEffect, useRef, useState } from 'react'

import { transcribeAudio } from '@/api/voiceTranscribe'
import {
  VOICE_MAX_LISTEN_MS,
  VOICE_SILENCE_MS,
} from '@/constants/voice'
import { isCloudRecordingSupported } from '@/voice/audio'
import { VoiceRecorder } from '@/voice/recorder'
import type {
  SpeechRecognitionOptions,
  SpeechRecognitionState,
} from '@/hooks/useSpeechRecognition'

/**
 * 云端 ASR（阿里百炼）实现，接口与 useSpeechRecognition 对齐。
 *
 * 与浏览器识别的区别：
 * - 没有中间字幕：录音结束后整段上传，后端返回最终文字；
 * - 有真正的音频 VAD：按音量判断“说完了”，不依赖浏览器事件；
 * - 用户点“我说完了”时，会立刻收尾并上传。
 *
 * 调用方通过 useVoiceInput 在“云端 / 浏览器”之间选择，
 * 页面和通话状态机不需要知道用的是哪一种。
 */

export interface CloudSpeechRecognitionState extends SpeechRecognitionState {
  /** 停止录音并等待转写结果；重复调用返回同一个 Promise */
  stopAndWait: () => Promise<string>
}

type InternalState = 'idle' | 'listening' | 'processing'

export function useCloudSpeechRecognition(
  options: SpeechRecognitionOptions = {},
): CloudSpeechRecognitionState {
  const [supported] = useState(() => isCloudRecordingSupported())
  const [listening, setListening] = useState(false)
  const [interim] = useState('')
  const [finalText, setFinalText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const optionsRef = useRef(options)
  const stateRef = useRef<InternalState>('idle')
  const recorderRef = useRef<VoiceRecorder | null>(null)
  const vadTimerRef = useRef<number | null>(null)
  const finalRef = useRef('')
  const startedAtRef = useRef(0)
  const mountedRef = useRef(true)
  const pendingRef = useRef<{
    promise: Promise<string>
    resolve: (text: string) => void
  } | null>(null)

  useEffect(() => {
    optionsRef.current = options
  })

  const setStateBoth = useCallback((next: InternalState) => {
    stateRef.current = next
    if (mountedRef.current) setListening(next === 'listening')
  }, [])

  const clearVad = useCallback(() => {
    if (vadTimerRef.current !== null) {
      window.clearInterval(vadTimerRef.current)
      vadTimerRef.current = null
    }
  }, [])

  const ensurePending = useCallback(() => {
    if (!pendingRef.current) {
      let resolve!: (text: string) => void
      const promise = new Promise<string>((r) => {
        resolve = r
      })
      pendingRef.current = { promise, resolve }
    }
    return pendingRef.current
  }, [])

  const settle = useCallback((text: string) => {
    const pending = pendingRef.current
    pendingRef.current = null
    pending?.resolve(text)
  }, [])

  const finish = useCallback(async (): Promise<string> => {
    if (stateRef.current === 'processing') {
      return pendingRef.current?.promise ?? finalRef.current
    }
    if (stateRef.current !== 'listening') {
      return finalRef.current
    }

    const pending = ensurePending()
    clearVad()
    setStateBoth('processing')
    const recorder = recorderRef.current
    recorderRef.current = null

    if (!recorder) {
      settle('')
      setStateBoth('idle')
      return pending.promise
    }

    try {
      const audio = await recorder.stop()
      if (!audio || !recorder.hasSpeechDetected()) {
        settle('')
        setStateBoth('idle')
        optionsRef.current.onEnd?.()
        return pending.promise
      }

      const text = (await transcribeAudio(audio.wav)).trim()
      if (!mountedRef.current) {
        settle('')
        return pending.promise
      }
      finalRef.current = text
      setFinalText(text)
      settle(text)
      setStateBoth('idle')
      optionsRef.current.onFinal?.(text)
      optionsRef.current.onEnd?.()
      return pending.promise
    } catch {
      if (mountedRef.current) {
        setError('语音转文字失败，可以再说一次，或者改用文字。')
      }
      settle('')
      setStateBoth('idle')
      optionsRef.current.onError?.(
        '语音转文字失败，可以再说一次，或者改用文字。',
        'cloud-asr',
      )
      return pending.promise
    }
  }, [clearVad, ensurePending, setStateBoth, settle])

  const start = useCallback((): boolean => {
    if (!supported) return false
    if (stateRef.current !== 'idle') return true

    finalRef.current = ''
    setFinalText('')
    setError(null)
    setStateBoth('listening')
    startedAtRef.current = performance.now()

    const recorder = new VoiceRecorder()
    recorderRef.current = recorder
    ensurePending()

    void recorder
      .start()
      .catch(() => {
        if (!mountedRef.current) return
        setError('麦克风没有打开，可以改用文字回答。')
        recorderRef.current = null
        settle('')
        setStateBoth('idle')
        optionsRef.current.onError?.(
          '麦克风没有打开，可以改用文字回答。',
          'not-allowed',
        )
      })

    clearVad()
    vadTimerRef.current = window.setInterval(() => {
      if (stateRef.current !== 'listening') return
      const current = recorderRef.current
      if (!current) return
      const now = performance.now()
      if (current.hasSpeechDetected() && current.getSilenceMs() >= VOICE_SILENCE_MS) {
        optionsRef.current.onSpeechEnd?.()
        void finish()
        return
      }
      if (now - startedAtRef.current > VOICE_MAX_LISTEN_MS) {
        void finish()
      }
    }, 120)

    return true
  }, [clearVad, ensurePending, finish, setStateBoth, settle, supported])

  const stop = useCallback(() => {
    void finish()
  }, [finish])

  const stopAndWait = useCallback((): Promise<string> => {
    if (stateRef.current === 'processing') {
      return pendingRef.current?.promise ?? Promise.resolve(finalRef.current)
    }
    if (stateRef.current === 'listening') {
      return finish()
    }
    return Promise.resolve(finalRef.current)
  }, [finish])

  const abort = useCallback(() => {
    clearVad()
    recorderRef.current?.cancel()
    recorderRef.current = null
    setStateBoth('idle')
    settle('')
    optionsRef.current.onEnd?.()
  }, [clearVad, setStateBoth, settle])

  const reset = useCallback(() => {
    finalRef.current = ''
    if (mountedRef.current) {
      setFinalText('')
      setError(null)
    }
  }, [])

  const clearError = useCallback(() => {
    if (mountedRef.current) setError(null)
  }, [])

  const getTranscript = useCallback(() => finalRef.current.trim(), [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearVad()
      recorderRef.current?.cancel()
      recorderRef.current = null
      settle('')
    }
  }, [clearVad, settle])

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
    stopAndWait,
  }
}
