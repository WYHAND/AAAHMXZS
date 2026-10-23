/**
 * 面试语音的节奏、文案与文本拼接工具。
 *
 * 这一版只做浏览器原生语音：
 * - TTS 用 speechSynthesis（系统中文音色，通常不依赖外网）；
 * - ASR 用 SpeechRecognition（Chrome/Edge 可用，但识别服务在浏览器厂商那边，
 *   国内 Chrome 可能连不上 Google，所以必须允许降级到文字）。
 *
 * 时间参数集中在这里，调“像不像打电话”只改这一处。
 */

/** 检测到"说话结束"后，再等多久算用户说完了 */
export const VOICE_SILENCE_MS = 1400

/** 说完后留给用户"继续补充"的窗口 */
export const VOICE_REVIEW_MS = 2000

/** 一直没有识别到任何文字时，多久给一句提示 */
export const VOICE_NO_SPEECH_HINT_MS = 10000

/** 一直没有说话时，最长录多久就收掉（避免一直占着麦克风） */
export const VOICE_MAX_LISTEN_MS = 60000

/** 语音输入（小测试）在没有声音时最长等多久 */
export const DICTATION_MAX_LISTEN_MS = 30000

/** 语音输入（小测试）说完后自动收尾的静音时长 */
export const DICTATION_SILENCE_MS = 1400

/**
 * 面试官的口头衔接。
 *
 * 只用于 TTS 朗读，不写进题库、不写进复盘：
 * 让“直接念下一题”听起来像人在接话，而不是机器在播报。
 */
export const VOICE_BRIDGES = {
  opening: '你好，我是今天的面试官，我们开始吧。',
  followup: '嗯，我想再追问一句。',
  next: '好，我们看下一个问题。',
  closing: '好，今天先聊到这里，谢谢你。',
} as const

export type VoiceBridgeKind = keyof typeof VOICE_BRIDGES | 'none'

/** 给朗读文本加上一句口头衔接；字幕仍然显示纯题目 */
export function withBridge(kind: VoiceBridgeKind, text: string): string {
  const clean = text.trim()
  if (!clean || kind === 'none') return clean
  return `${VOICE_BRIDGES[kind]}${clean}`
}

/** 文本长度 -> 预计朗读时长（TTS 不可用时的兜底等待） */
export function estimateReadMs(text: string): number {
  return Math.min(15000, Math.max(2200, text.trim().length * 190))
}

/**
 * 把两段识别结果拼起来。
 *
 * 浏览器的最终结果经常分成多段返回，直接相加会变成
 * “我主要负责前端我做了三个页面”；这里补一个逗号。
 */
export function joinTranscript(existing: string, incoming: string): string {
  const head = existing.trim()
  const tail = incoming.trim()
  if (!head) return tail
  if (!tail) return head
  if (/[。！？!?，,；;：:、]$/.test(head) || /^[。！？!?，,；;：:、]/.test(tail)) {
    return `${head}${tail}`
  }
  return `${head}，${tail}`
}

/**
 * 把语音转写追加到输入框。
 *
 * 小测试的输入框可能已经有用户打的字，所以不能直接覆盖；
 * 超过上限时截断，和后端 5000 字上限、输入框 500 字可见上限保持一致。
 */
export function appendDictation(draft: string, text: string, max: number): string {
  const merged = joinTranscript(draft, text)
  return merged.slice(0, max)
}
