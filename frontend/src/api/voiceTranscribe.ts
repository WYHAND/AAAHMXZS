import { post } from '@/api/client'

/**
 * 云端语音转写：把一段录音发给后端，拿回文字。
 *
 * 后端 /voice/transcribe 接收原始音频字节（不是 multipart），
 * 所以这里直接把 Blob 作为 body，Content-Type 用录音自身的 MIME。
 * 与 TTS 的 api/voice.ts 分开，避免两个功能互相耦合。
 */
export async function transcribeAudio(audio: Blob): Promise<string> {
  const result = await post<{ text: string }>('/voice/transcribe', audio, {
    headers: {
      'Content-Type': audio.type || 'audio/wav',
    },
    timeout: 60000,
    silent: true,
  })
  return (result?.text ?? '').trim()
}
