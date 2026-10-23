import { Skeleton } from '@/components/ui/skeleton'
import type { Stage } from '@/constants/stage'
import { cn } from '@/lib/utils'

/**
 * AI 等待态（设计说明书 6.5：骨架 + 阶段文案，不用转圈）
 * 文案随阶段变化，让「AI 在读你的经历」这件事显性化。
 *
 * 2026-10-22（方案 A）：与对话页 AI 气泡统一 —— **白卡 + 主墨 + 左侧 3px 赭金竖条**。
 * 之前是 bg-surface-container-low，放在暖纸画布上几乎和底色融成一片；
 * 白卡让"AI 正在读"这块真的浮起来，竖条则保留"这是 AI 说的话"的识别度。
 * 骨架条用画布色，在白色卡上仍能看见。
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
        // 与 ChatBubble 的 AI 外形保持一致：白卡 + 1px 中性描边（不要彩色竖条）
        'flex min-w-0 max-w-full flex-col gap-3 rounded-xl border border-outline-variant/60 bg-card px-4 py-3.5 shadow-card',
        className,
      )}
    >
      <p className="text-body-md text-primary">{message}</p>
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
