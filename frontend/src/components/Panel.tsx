import type { ElementType, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * 卡片（全站唯一实现）—— 首页的主行动卡/侧栏卡与其它页面的区块卡都用它。
 *
 * 为什么要有这一层：`ui/card.tsx`（shadcn 底座）是「外框 py-6 + CardHeader/Content 各 px-6」
 * 的分层结构，页面里又各自写 `py-5 px-5`、`bg-muted/50` 内嵌块，于是同一屏出现过
 * 0/16/20/24px 四种内边距、有无描边两种外观 —— 这正是"首页之外看着不像一个产品"的主因。
 *
 * 规格（与首页对齐）：
 * - 白底 + 12px 圆角 + 极轻环境阴影，**不画可见描边**（分层靠阴影与浅底区块）；
 * - 默认内边距 20px（p-5）；带页头/多区块时用 `padded={false}` 自己排；
 * - `inset`：卡内浅底区块（bg-surface-container-low + 8px 圆角），
 *   用它替代各处 `bg-muted/50`、`bg-card/80` 这类临时底色。
 *
 * `as` 可换成 section/article/li，语义交给调用方；默认 div。
 */
export interface PanelProps {
  children: ReactNode
  /** 默认 true = p-5（20px）；false = 不加内边距，由调用方排 */
  padded?: boolean
  /** true = 浅底内嵌区块（bg-surface-container-low，圆角 8px） */
  inset?: boolean
  /** 换成 section / article / li 等语义标签 */
  as?: ElementType
  className?: string
  /** 数据属性等透传 */
  [key: `data-${string}`]: unknown
}

export function Panel({
  children,
  padded = true,
  inset = false,
  as: Tag = 'div',
  className,
  ...rest
}: PanelProps) {
  return (
    <Tag
      data-slot={inset ? 'panel-inset' : 'panel'}
      className={cn(
        'flex flex-col rounded-xl',
        inset
          ? 'gap-2 rounded-lg bg-surface-inset'
          : 'bg-card shadow-card',
        padded && (inset ? 'p-3.5' : 'p-5'),
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export default Panel
