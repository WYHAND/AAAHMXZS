import { useCallback, useEffect, useState } from 'react'

import { voiceApi } from '@/api/voice'
import { useCloudSpeechRecognition } from '@/hooks/useCloudSpeechRecognition'
import {
  useSpeechRecognition,
  type SpeechRecognitionOptions,
  type SpeechRecognitionState,
} from '@/hooks/useSpeechRecognition'

/**
 * 语音输入的“选路器”。
 *
 * - 后端配置了云端 ASR（阿里百炼）时，优先用云端录音 + 转写；
 * - 没有配置 / 后端不可用 / 设备不支持录音时，退回浏览器 SpeechRecognition；
 * - 两者接口一致，页面和通话状态机不需要关心用的是哪一种。
 *
 * `stopAndWait()` 是给通话状态机用的：停止录音并等最终文字，
 * 避免云端上传还没回来就读到空 transcript。
 */

export interface VoiceInputState extends SpeechRecognitionState {
  stopAndWait: () => Promise<string>
  /** 当前走的是云端 ASR 还是浏览器识别（调试/提示用） */
  cloud: boolean
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function useVoiceInput(options: SpeechRecognitionOptions = {}): VoiceInputState {
  const [cloudReady, setCloudReady] = useState(false)

  useEffect(() => {
    let alive = true
    void voiceApi
      .status()
      .then((data) => {
        if (alive) setCloudReady(Boolean(data?.configured))
      })
      .catch(() => {
        // 后端没配置 / 未登录 / 网络失败：保持浏览器识别兜底
      })
    return () => {
      alive = false
    }
  }, [])

  const browser = useSpeechRecognition(options)
  const cloud = useCloudSpeechRecognition(options)

  const browserStopAndWait = useCallback(async (): Promise<string> => {
    browser.stop()
    // 浏览器 stop 后最终结果通常几十毫秒内到；给一点余量
    await wait(550)
    return browser.getTranscript()
  }, [browser])

  if (cloudReady && cloud.supported) {
    return {
      ...cloud,
      stopAndWait: cloud.stopAndWait,
      cloud: true,
    }
  }

  return {
    ...browser,
    stopAndWait: browserStopAndWait,
    cloud: false,
  }
}
