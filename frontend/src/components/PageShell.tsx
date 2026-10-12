import type { ReactNode } from 'react'

import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

/**
 * 页面外壳：统一页面标题 / 描述 / 面包屑 / 右侧操作区。
 * 打印时 data-print='main' 让内容铺满纸张（见 styles/print.css）。
 *
 * 2026-10 收口：标题区整块搬到 **PageHeader**（h1 = 26px/700，与首页同一规格），
 * 本组件只负责「宽度 + 纵向节奏」这一件事，props 签名与以前完全一致 ——
 * 19 个调用点一个字都不用改，改版从这里统一生效。
 *
 * 宽度固定 1040px（与首页内容列一致）。页面内部要做窄栏排版时，
 * 用自己的容器收窄（如简历展示态 max-w-3xl），不要改这里。
 */
export interface PageShellProps {
  title: string
  /** 标题右侧的小标签（参考稿里如「轻量记录」）；不传则不渲染 */
  badge?: ReactNode
  description?: ReactNode
  /** 面包屑（顶栏之外，页面内可选的层级提示） */
  breadcrumb?: string
  /** 右侧操作区，注意整屏最多一个 bg-primary 实心按钮 */
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export function PageShell({
  title,
  badge,
  description,
  breadcrumb,
  actions,
  children,
  className,
}: PageShellProps) {
  return (
    <div
      data-print="main"
      className={cn('mx-auto flex w-full max-w-[1040px] flex-col gap-6', className)}
    >
      <PageHeader
        title={title}
        badge={badge}
        description={description}
        breadcrumb={breadcrumb}
        actions={actions}
      />
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  )
}
