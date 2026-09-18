import { Skeleton } from '@/components/ui/skeleton'
import type { Stage } from '@/constants/stage'
import { cn } from '@/lib/utils'

/**
 * AI 等待态（设计说明书 6.5：骨架 + 阶段文案，不用转圈）
 * 文案随阶段变化，让「AI 在读你的经历」这件事显性化。
 */
export interface AIThinkingProps {
  stage?: Stage
  /** 覆盖默认文案 */
  text?: string
  lines?: number
  className?: string
}

const STAGE_THINKING: Record<Stage, string> = {
  explore: '正在读你的经历，帮你找可能的方向…',
  prepare: '正在对照目标岗位，检查你的准备度…',
  sprint: '正在按面试官视角复盘你的表达…',
}

export function AIThinking({ stage, text, lines = 3, className }: AIThinkingProps) {
  const message = text ?? (stage ? STAGE_THINKING[stage] : '正在思考…')

  return (
    <div
      data-slot="ai-thinking"
      className={cn(
        'ai-inset flex flex-col gap-3 rounded-lg bg-accent/50 px-4 py-3',
        className,
      )}
    >
      <p className="text-sm text-accent-foreground">{message}</p>
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton
            key={index}
            className={cn(
              'h-3 rounded-full bg-background/70',
              index === lines - 1 ? 'w-2/3' : 'w-full',
            )}
          />
        ))}
      </div>
    </div>
  )
}
