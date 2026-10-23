import {
  decodeToWav,
  isCloudRecordingSupported,
  rmsOfTimeDomain,
  type RecordedAudio,
} from '@/voice/audio'

/**
 * 麦克风录音器（云端 ASR 用）。
 *
 * - MediaRecorder 负责采集，AudioContext 只做分析，不接 destination（避免外放）；
 * - 录音结束后优先转成 16k WAV，失败则保留原始 webm；
 * - VAD 不在这里做，由上层按 getLevel/getSilenceMs 决定何时收尾。
 */
export class VoiceRecorder {
  readonly supported = isCloudRecordingSupported()

  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private loopHandle = 0
  private startedAt = 0
  private stoppedAt = 0
  private lastVoiceAt = 0
  private hasSpeech = false
  private currentLevel = 0
  private stopped = true
  private stopPromise: Promise<RecordedAudio | null> | null = null

  async start(): Promise<void> {
    if (!this.supported) throw new Error('UNSUPPORTED')
    if (!this.stopped) return

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) throw new Error('UNSUPPORTED')
    this.context = new Ctx()
    if (this.context.state === 'suspended') {
      await this.context.resume()
    }

    const source = this.context.createMediaStreamSource(this.stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.8
    source.connect(this.analyser)

    const preferred = 'audio/webm;codecs=opus'
    const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : ''
    this.recorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined,
    )
    this.chunks = []
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.start(250)

    this.startedAt = performance.now()
    this.stoppedAt = 0
    this.lastVoiceAt = this.startedAt
    this.hasSpeech = false
    this.currentLevel = 0
    this.stopped = false
    this.stopPromise = null
    this.loop()
  }

  private loop = () => {
    if (this.stopped || !this.analyser) return
    const data = new Uint8Array(this.analyser.fftSize)
    this.analyser.getByteTimeDomainData(data)
    const rms = rmsOfTimeDomain(data)
    this.currentLevel = Math.min(1, rms / 0.18)

    const now = performance.now()
    // 前 250ms 给麦克风/AGC 一点稳定时间，避免把启动噪声当成人声
    if (now - this.startedAt > 250 && rms > 0.02) {
      this.hasSpeech = true
      this.lastVoiceAt = now
    }

    this.loopHandle = requestAnimationFrame(this.loop)
  }

  getLevel(): number {
    return this.stopped ? 0 : this.currentLevel
  }

  hasSpeechDetected(): boolean {
    return this.hasSpeech
  }

  /** 检测到说话后，已经静音了多久 */
  getSilenceMs(): number {
    if (!this.hasSpeech || this.stopped) return 0
    return performance.now() - this.lastVoiceAt
  }

  getDurationMs(): number {
    if (!this.startedAt) return 0
    return (this.stoppedAt || performance.now()) - this.startedAt
  }

  stop(): Promise<RecordedAudio | null> {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = this.doStop()
    return this.stopPromise
  }

  private async doStop(): Promise<RecordedAudio | null> {
    const recorder = this.recorder
    if (!recorder || this.stopped) return null

    this.stopped = true
    this.stoppedAt = performance.now()
    cancelAnimationFrame(this.loopHandle)
    this.loopHandle = 0

    const raw = await new Promise<Blob>((resolve) => {
      let settled = false
      let timer: number | null = null
      const finish = () => {
        if (settled) return
        settled = true
        if (timer !== null) window.clearTimeout(timer)
        resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }))
      }
      recorder.onstop = finish
      // 极少数设备/浏览器 MediaRecorder.stop() 不触发 onstop；不能让整场面试挂在这里
      timer = window.setTimeout(finish, 2500)
      try {
        recorder.stop()
      } catch {
        finish()
      }
    })

    let wav = raw
    if (this.context) {
      try {
        wav = await decodeToWav(raw, this.context)
      } catch {
        // 解码失败就上传原始音频，让后端/供应商决定是否支持
        wav = raw
      }
    }

    const durationMs = this.getDurationMs()
    this.cleanup()
    return { wav, raw, durationMs }
  }

  cancel(): void {
    this.stopped = true
    this.stoppedAt = performance.now()
    cancelAnimationFrame(this.loopHandle)
    this.loopHandle = 0
    if (this.recorder) {
      this.recorder.onstop = null
      try {
        if (this.recorder.state !== 'inactive') this.recorder.stop()
      } catch {
        // ignore
      }
      this.recorder = null
    }
    this.chunks = []
    this.cleanup()
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.recorder = null
    this.analyser = null
    if (this.context) {
      void this.context.close().catch(() => undefined)
      this.context = null
    }
  }
}
