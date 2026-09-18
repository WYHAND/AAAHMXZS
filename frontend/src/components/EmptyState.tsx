import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * 空状态（设计说明书 3.2 空状态统一规范 / 6.5）
 * 强制 title + action 两个 props：不允许出现纯「暂无数据」。
 */
export interface EmptyStateProps {
  /** 一句人话，必须写清「现在没有什么」 */
  title: string
  /** 一个可点按钮（唯一主 CTA 由页面决定） */
  action: ReactNode
  description?: string
  icon?: ReactNode
  className?: string
}

export function EmptyState({
  title,
  action,
  description,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-base font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-1">{action}</div>
    </div>
  )
}
