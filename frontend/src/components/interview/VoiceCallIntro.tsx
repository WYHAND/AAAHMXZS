import { Headphones, Keyboard, MicOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/Panel'

/**
 * 全真模式的入口：先让用户选“语音”还是“文字”。
 *
 * 为什么不在进入页面时自动开麦：
 * - 浏览器要求麦克风/自动播放由用户手势触发；
 * - 用户可能没戴耳机、环境不方便，先问一句更礼貌。
 */
export interface VoiceCallIntroProps {
  asrSupported: boolean
  ttsSupported: boolean
  onStart: () => void
  onText: () => void
}

export function VoiceCallIntro({
  asrSupported,
  ttsSupported,
  onStart,
  onText,
}: VoiceCallIntroProps) {
  return (
    <Panel inset className="gap-3">
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-primary ring-1 ring-primary/30"
          aria-hidden
        >
          {asrSupported ? <Headphones className="size-5" /> : <MicOff className="size-5" />}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body-md font-medium text-primary">这场是全真模拟</p>
          <p className="text-body-sm text-on-surface-variant">
            {asrSupported
              ? ttsSupported
                ? '建议接通语音，像接一个电话一样回答。也可以先用文字。'
                : '可以语音作答，但当前浏览器不支持语音朗读，题目会以文字显示。'
              : '当前浏览器不支持语音识别，先用文字作答；换 Chrome/Edge 可以试语音。'}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="warm"
          size="lg"
          className="motion-press w-full sm:w-auto"
          onClick={onStart}
          disabled={!asrSupported}
        >
          <Headphones aria-hidden />
          {ttsSupported ? '接通语音通话' : '开始语音作答'}
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="motion-press w-full sm:w-auto"
          onClick={onText}
        >
          <Keyboard aria-hidden />
          先用文字
        </Button>
      </div>

      <p className="text-caption text-caption-foreground">
        建议戴耳机，外放容易把面试官的声音录进去。语音识别需要联网；
        识别不可用时会自动切到文字，录音不会保存。
      </p>
    </Panel>
  )
}

export default VoiceCallIntro
