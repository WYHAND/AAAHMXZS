import { Check, Circle, Dot } from 'lucide-react'

import type { TaskStep } from '@/types'
import { cn } from '@/lib/utils'

/**
 * 任务步骤条（设计说明书 6.5：shadcn 无 Steps，三态自行实现）
 *
 * 对齐后端 TaskStepResponse：completed: boolean（不是 status 枚举），
 * 序号字段是 step_order（从 1 开始）。
 * 三态：已完成（✓） / 当前（●） / 未开始（○）
 */
export interface StepListProps {
  steps: TaskStep[]
  activeStepId?: string | null
  onSelect?: (step: TaskStep) => void
  className?: string
}

export function StepList({ steps, activeStepId, onSelect, className }: StepListProps) {
  return (
    <ol data-slot="step-list" className={cn('flex flex-col gap-1', className)}>
      {steps.map((step) => {
        const active = activeStepId != null && step.id === activeStepId
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect?.(step)}
              className={cn(
                'flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors',
                active ? 'bg-primary-soft' : 'hover:bg-secondary',
              )}
            >
              <span className="mt-0.5 shrink-0" aria-hidden>
                {step.completed ? (
                  <Check className="size-4 text-success" />
                ) : active ? (
                  <Dot className="size-4 text-primary" />
                ) : (
                  <Circle className="size-4 text-muted-foreground" />
                )}
              </span>
              <span className="flex flex-col">
                <span
                  className={cn(
                    'text-sm',
                    step.completed ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}
                >
                  {step.step_order}. {step.title}
                </span>
                {active && !step.completed ? (
                  <span className="text-xs text-muted-foreground">当前</span>
                ) : null}
                {step.completed && step.completed_at ? (
                  <span className="text-xs text-muted-foreground">已完成</span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
