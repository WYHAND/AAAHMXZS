import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * 页面标题区（全站唯一实现）—— 首页之外的每个页面都用它，不再各写一份 header。
 *
 * 规格（与首页对齐，改这里就是改全站）：
 * - h1：text-headline-xl（26px / 700 / 行高 34px / 字距 -0.015em），颜色 text-primary；
 * - 面包屑：text-caption（12px）+「首页 › X」，只有需要层级提示的页面才传；
 * - 描述：text-body-md（14px），最宽 60ch（一行读得完，不横跨 1040px）；
 * - 右侧动作区：最多一个实心主按钮（其余用 outline / ghost，见 button.tsx）。
 *
 * ⚠️ 这里刻意**不**渲染任何卡片/底板：标题区永远贴在画布上，
 * 这样任何页面（列表页、详情页、窄栏流程页）都能复用它。
 */
export interface PageHeaderProps {
  title: string
  /** 标题右侧的小标签（如「小步打卡」「轻量记录」） */
  badge?: ReactNode
  /** 标题下面那句人话 */
  description?: ReactNode
  /** 面包屑末级文案；传了就在标题上方出现「首页 › X」 */
  breadcrumb?: string
  /** 右侧动作区（窄屏自动换行到标题下方） */
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  badge,
  description,
  breadcrumb,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {breadcrumb ? (
          <nav className="flex items-center gap-1 text-caption text-caption-foreground">
            <Link to="/" className="transition-colors hover:text-on-surface-variant">
              首页
            </Link>
            <ChevronRight className="size-3" aria-hidden />
            <span className="text-on-surface-variant">{breadcrumb}</span>
          </nav>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-headline-xl font-bold tracking-tight text-primary">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="max-w-[60ch] text-body-md text-on-surface-variant">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div data-print="hide" className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export default PageHeader
