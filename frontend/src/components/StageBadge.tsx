import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { STAGE_CLASS, STAGE_DESC, STAGE_LABEL, type Stage } from '@/constants/stage'
import { cn } from '@/lib/utils'

/**
 * 阶段徽章（设计说明书 2.2 顶栏、6.2 阶段色、6.5）
 * 阶段色只用于徽章与进度，**不允许**用在按钮上。
 * showStepper：●○○ 三档进度点（黄 → 蓝 → 红）。
 */
export interface StageBadgeProps {
  stage: Stage
  /** 是否显示 ●○○ 阶段进度点 */
  showStepper?: boolean
  size?: 'sm' | 'default'
  className?: string
}

const STAGE_INDEX: Record<Stage, number> = { explore: 0, prepare: 1, sprint: 2 }

export function StageBadge({
  stage,
  showStepper = false,
  size = 'default',
  className,
}: StageBadgeProps) {
  const tone = STAGE_CLASS[stage]
  const current = STAGE_INDEX[stage]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          data-slot="stage-badge"
          data-stage={stage}
          className={cn(
            'gap-1.5 rounded-full font-medium',
            size === 'sm' ? 'h-5 px-2 text-caption' : 'h-6 px-2.5 text-caption',
            tone.chip,
            className,
          )}
        >
          <span className={cn('size-1.5 rounded-full', tone.dot)} aria-hidden />
          {STAGE_LABEL[stage]}
          {showStepper ? (
            <span className="ml-0.5 flex items-center gap-0.5" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cn(
                    'size-1 rounded-full',
                    i <= current ? tone.dot : 'bg-muted-foreground/30',
                  )}
                />
              ))}
            </span>
          ) : null}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{STAGE_DESC[stage]}</TooltipContent>
    </Tooltip>
  )
}
