/**
 * Web Speech API 的最小类型声明 + 能力检测。
 *
 * 为什么自己声明：
 * - `SpeechRecognition` 目前不在 TypeScript 的 lib.dom 里（Chrome 仍用
 *   `webkitSpeechRecognition` 前缀），直接写会 TS 报错；
 * - 只声明我们用得到的字段，避免把整个浏览器 API 面搬进来。
 *
 * ⚠️ 能力边界（2026-10 实机情况）：
 * - Chrome / Edge 桌面端通常有 `SpeechRecognition`；
 * - Chrome 的识别服务可能依赖 Google 网络，国内网络下会 `network` 失败；
 * - Electron 一般没有可用的语音识别（TTS 仍可用）。
 * 所以调用方必须把“不支持/失败”当成正常分支，降级到文字，而不是报错卡死。
 */

export interface AicareerSpeechAlternative {
  transcript: string
  confidence: number
}

export interface AicareerSpeechResult {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: AicareerSpeechAlternative
}

export interface AicareerSpeechResultList {
  readonly length: number
  readonly [index: number]: AicareerSpeechResult
}

export interface AicareerSpeechResultEvent extends Event {
  readonly resultIndex: number
  readonly results: AicareerSpeechResultList
}

export interface AicareerSpeechErrorEvent extends Event {
  readonly error: string
  readonly message?: string
}

export interface AicareerSpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number

  start(): void
  stop(): void
  abort(): void

  onstart: ((event: Event) => void) | null
  onend: ((event: Event) => void) | null
  onerror: ((event: AicareerSpeechErrorEvent) => void) | null
  onresult: ((event: AicareerSpeechResultEvent) => void) | null
  onspeechend: ((event: Event) => void) | null
  onnomatch: ((event: Event) => void) | null
}

export type AicareerSpeechRecognitionCtor = new () => AicareerSpeechRecognition

interface SpeechWindow {
  SpeechRecognition?: AicareerSpeechRecognitionCtor
  webkitSpeechRecognition?: AicareerSpeechRecognitionCtor
}

/** 取浏览器提供的识别构造器；没有就返回 null（调用方据此降级） */
export function getSpeechRecognitionCtor(): AicareerSpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** 浏览器识别错误码 -> 给用户看的人话 */
export function speechErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风没有打开，或者浏览器不允许语音识别。可以改用文字回答。'
    case 'audio-capture':
      return '没有找到可用的麦克风。可以改用文字回答。'
    case 'network':
      return '语音识别连不上网，先改用文字吧。'
    case 'no-speech':
      return '没听到声音，再说一次？'
    case 'aborted':
      return ''
    default:
      return '语音识别出了点问题，可以改用文字回答。'
  }
}
