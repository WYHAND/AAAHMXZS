import { Mic, Square } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * 输入框里的语音按钮（小测试 / 文字模式共用）。
 *
 * 只负责“开始/停止”和状态反馈；真正的识别在 useDictation 里。
 * 不支持语音的浏览器直接不渲染，避免给用户一个点了没反应的按钮。
 */
export interface VoiceMicButtonProps {
  supported: boolean
  listening: boolean
  processing: boolean
  onClick: () => void
  disabled?: boolean
  className?: string
}

export function VoiceMicButton({
  supported,
  listening,
  processing,
  onClick,
  disabled = false,
  className,
}: VoiceMicButtonProps) {
  if (!supported) return null

  const label = processing
    ? '正在整理语音'
    : listening
      ? '停止语音输入'
      : '用语音输入'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || processing}
      aria-label={label}
      aria-pressed={listening}
      title={processing ? '正在转成文字…' : listening ? '点一下停止' : '点一下说话，转成文字'}
      className={cn(
        'motion-press absolute right-2 bottom-2 grid size-9 place-items-center rounded-full',
        'ring-1 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        listening
          ? 'bg-secondary text-primary-foreground ring-secondary'
          : 'bg-card text-primary ring-primary/20 hover:bg-primary-soft',
        processing && 'opacity-60',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {listening ? (
        <>
          <span className="absolute inset-0 animate-ping rounded-full bg-secondary/25" aria-hidden />
          <Square className="relative size-3.5 fill-current" />
        </>
      ) : (
        <Mic className="size-4" />
      )}
    </button>
  )
}

export default VoiceMicButton
