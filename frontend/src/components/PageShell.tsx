import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * 页面外壳：统一页面标题 / 描述 / 面包屑 / 右侧操作区。
 * 打印时 data-print='main' 让内容铺满纸张（见 styles/print.css）。
 */
export interface PageShellProps {
  title: string
  description?: string
  /** 面包屑（顶栏之外，页面内可选的层级提示） */
  breadcrumb?: string
  /** 右侧操作区，注意整屏最多一个 bg-primary 实心按钮 */
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export function PageShell({
  title,
  description,
  breadcrumb,
  actions,
  children,
  className,
}: PageShellProps) {
  return (
    <div
      data-print="main"
      className={cn('mx-auto flex w-full max-w-5xl flex-col gap-6', className)}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          {breadcrumb ? (
            <nav className="flex items-center gap-1 text-xs text-muted-foreground">
              <Link to="/" className="hover:text-foreground">
                首页
              </Link>
              <ChevronRight className="size-3" aria-hidden />
              <span>{breadcrumb}</span>
            </nav>
          ) : null}
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div data-print="hide" className="flex shrink-0 items-center gap-2">
            {actions}
          </div>
        ) : null}
      </header>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  )
}
