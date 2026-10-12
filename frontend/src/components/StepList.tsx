import { Check } from 'lucide-react'

import type { TaskStep } from '@/types'
import { cn } from '@/lib/utils'

/**
 * 任务步骤条（设计说明书 6.5：shadcn 无 Steps，三态自行实现）
 *
 * 对齐后端 TaskStepResponse：completed: boolean（不是 status 枚举），
 * 序号字段是 step_order（从 1 开始）。
 *
 * 2026-10 三态重排（语义色，不再用"三种灰"）：
 * - 已完成 = `text-on-surface-variant line-through` + 勾（序号标换成勾）；
 * - 当前   = `bg-primary-soft ring-1 ring-primary/30`（浅墨底必须配环，否则选中态看不见）；
 * - 未开始 = `bg-surface-container-low`。
 * 序号标保留（`size-6` 圆，未完成时显示 step_order，当前步是实心主墨）。
 * `step.feedback` 若有，用小字附在**该步下方**，不再另开一块。
 *
 * 只被 TaskDetailPage 使用（grep 确认过），所以直接改样式是安全的。
 */
export interface StepListProps {
  steps: TaskStep[]
  activeStepId?: string | null
  onSelect?: (step: TaskStep) => void
  className?: string
}

export function StepList({ steps, activeStepId, onSelect, className }: StepListProps) {
  return (
    <ol data-slot="step-list" className={cn('flex flex-col gap-2', className)}>
      {steps.map((step) => {
        const active = activeStepId != null && step.id === activeStepId
        const stateLabel = step.completed ? '已完成' : active ? '当前' : '未开始'
        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => onSelect?.(step)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors',
                active
                  ? 'bg-primary-soft ring-1 ring-primary/30'
                  : 'bg-surface-container-low hover:bg-surface-container',
              )}
            >
              {/* 序号标（size-6 圆）：当前步是实心主墨，其余是浅底 */}
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold tabular-nums',
                  active
                    ? 'bg-primary text-on-primary'
                    : step.completed
                      ? 'bg-surface-container text-on-surface-variant'
                      : 'bg-card text-on-surface-variant',
                )}
                aria-hidden
              >
                {step.completed ? <Check className="size-3.5" /> : step.step_order}
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex w-full items-center gap-3">
                  <span
                    className={cn(
                      'flex-1 text-body-md',
                      step.completed
                        ? 'text-on-surface-variant line-through'
                        : 'font-medium text-primary',
                    )}
                  >
                    第 {step.step_order} 步 · {step.title}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-body-sm',
                      active ? 'text-primary' : 'text-on-surface-variant',
                    )}
                  >
                    {stateLabel}
                  </span>
                </span>

                {/* 这一步的打卡反馈：附在该步下方的小字，不另开一块 */}
                {step.feedback ? (
                  <span className="text-body-sm text-on-surface-variant">{step.feedback}</span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
