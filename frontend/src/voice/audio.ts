/**
 * 云端 ASR 的录音与 WAV 编码工具。
 *
 * 为什么自己录音：
 * - 浏览器 SpeechRecognition 依赖厂商服务，国内 Chrome 经常不可用；
 * - 换成阿里百炼后，需要把真实音频送到后端；
 * - 自己录音还能做 VAD（判断“说完了”）和音量反馈。
 *
 * 录音流程：
 *   getUserMedia -> MediaRecorder(webm/opus) -> decodeAudioData
 *   -> 16k 单声道 PCM16 WAV -> 上传后端
 * 选 WAV 是因为语音识别服务对 WAV 的兼容性最好。
 */

export interface RecordedAudio {
  /** 16k 单声道 WAV，上传给后端 ASR */
  wav: Blob
  /** 原始录音，解码失败时作为兜底 */
  raw: Blob
  durationMs: number
}

export function isCloudRecordingSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined' &&
      Ctx,
  )
}

/** 取时间域数据并算 RMS（0..1） */
export function rmsOfTimeDomain(data: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i += 1) {
    const value = (data[i] - 128) / 128
    sum += value * value
  }
  return Math.sqrt(sum / Math.max(1, data.length))
}

/** 多声道混合成单声道，并线性重采样到 16k */
export function downsampleTo16k(buffer: AudioBuffer): Float32Array {
  const sourceRate = buffer.sampleRate
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const mixed = new Float32Array(length)
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      mixed[i] += data[i] / channels
    }
  }

  if (sourceRate === 16000) return mixed

  const ratio = sourceRate / 16000
  const outLength = Math.max(1, Math.floor(length / ratio))
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i += 1) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, length - 1)
    const fraction = position - left
    out[i] = mixed[left] * (1 - fraction) + mixed[right] * fraction
  }
  return out
}

/** Float32 单声道 -> 16-bit PCM WAV */
export function encodeWav(samples: Float32Array, sampleRate = 16000): Blob {
  const dataSize = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/** 把浏览器录制的 webm/opus 解码成 16k WAV；失败时由调用方用 raw 兜底 */
export async function decodeToWav(raw: Blob, context: AudioContext): Promise<Blob> {
  const arrayBuffer = await raw.arrayBuffer()
  const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0))
  const samples = downsampleTo16k(audioBuffer)
  return encodeWav(samples, 16000)
}
