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
        /*
         * 2026-10 收口：底色从 bg-card（白卡）换成 canvas（画布色）——空态是"这里先空着"，
         * 不该和真内容一样是一张白卡；虚线描边保留，它本来就表示"待填充"。
         * 图标圈原来是 bg-accent（现已是浅桃），空态不是 AI 输出，改中性浅底。
         */
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-outline-variant/60 bg-canvas px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-10 items-center justify-center rounded-full bg-surface-container text-on-surface-variant">
          {icon}
        </div>
      ) : null}
      <p className="text-headline-sm text-primary">{title}</p>
      {description ? (
        <p className="max-w-md text-body-sm text-on-surface-variant">{description}</p>
      ) : null}
      <div className="mt-1">{action}</div>
    </div>
  )
}
