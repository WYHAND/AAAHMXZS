import { Skeleton } from '@/components/ui/skeleton'
import type { Stage } from '@/constants/stage'
import { cn } from '@/lib/utils'

/**
 * AI 等待态（设计说明书 6.5：骨架 + 阶段文案，不用转圈）
 * 文案随阶段变化，让「AI 在读你的经历」这件事显性化。
 *
 * 2026-10 收口（AI 面板的唯一正确底色）：**中性浅底 + 琥珀竖条 + 正文字色**，
 * 浅桃 bg-accent 只留给 chip / 小按钮 / 状态点这类小面积强调 ——
 * 大面积粉底会变成"到处都在提示你"，这正是首页之外看着更闹的原因之一。
 * （首页的「AI 随行手记」就是同一个写法：bg-surface-container-low + ai-inset。）
 * 骨架条用画布色，在浅底上仍看得见。
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
        'ai-inset flex flex-col gap-3 rounded-lg bg-surface-container-low px-4 py-3',
        className,
      )}
    >
      <p className="text-body-sm text-on-surface">{message}</p>
      <div className="flex flex-col gap-2">
        {Array.from({ length: lines }).map((_, index) => (
          <Skeleton
            key={index}
            className={cn(
              'h-3 rounded-full bg-canvas',
              index === lines - 1 ? 'w-2/3' : 'w-full',
            )}
          />
        ))}
      </div>
    </div>
  )
}
