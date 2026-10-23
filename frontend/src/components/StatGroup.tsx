import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * 数字面板（全站唯一实现）—— 首页「成长节律」三格、成长报告三列统计都用它。
 *
 * 为什么要有这一层：同样的"三个数字"在首页是**一张卡里的一格浅底**（浅底托住数字），
 * 在成长报告里却是**三张独立白卡**（重复三条边框）。抽成一组组件后，
 * 数字的排版、单位写法、强调色与分隔线全站只有一份。
 *
 * 用色纪律：
 *   - `accent`（琥珀）**一屏最多给一个数字**，它是"今天要看的那一个"；
 *   - `tone="settled"`（克制绿）给"已经累积到手"的数字（首页累计微步 / 活跃天数），
 *     与琥珀不冲突，但**同一格里不要同时出现两种状态色**；
 *   - 其余数字一律主墨。报表页（成长报告 / 测评结果）保持缺省，不动。
 */
export interface StatGroupProps {
  children: ReactNode
  /** 列数（默认 3；窄屏自动退化为 1 列纵向） */
  columns?: 2 | 3
  className?: string
}

export function StatGroup({ children, columns = 3, className }: StatGroupProps) {
  return (
    <div
      data-slot="stat-group"
      className={cn(
        'grid gap-4 rounded-lg bg-surface-container-low px-4 py-3.5 text-center',
        columns === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

export interface StatProps {
  value: ReactNode
  label: string
  /** 单位（如「天」「步」），跟在数字后面用小字 */
  unit?: string
  /** true = 这个数字用琥珀强调（一屏最多一个） */
  accent?: boolean
  /**
   * 语义色（2026-10-11 新增，只服务首页「成长节律」三格）：
   *   ink（缺省）→ 主墨；settled → 克制绿 --settled（"累积到手"的数字）；
   *   amber       → 琥珀（与 accent 等价，给非布尔场景用）。
   * 白色卡片上绿 5.5:1 / 琥珀 6.3:1，大号数字都够；**别**用它给正文上色。
   * accent 优先级高于 tone（历史写法 `accent` 的含义不能变）。
   */
  tone?: 'ink' | 'settled' | 'amber'
  /** true = 左右各加一条细分隔线（放在多格中间用） */
  divided?: boolean
  /** lg = 24px（默认，报表用）；display = 32px（首页节律这种要当主角的数字） */
  size?: 'lg' | 'display'
  className?: string
}

export function Stat({
  value,
  label,
  unit,
  accent = false,
  tone = 'ink',
  divided = false,
  size = 'lg',
  className,
}: StatProps) {
  // 缺省 ink 必须解析成 text-primary（而不是走一遍 text-ink 工具类），保持与旧版逐像素一致
  const valueClass = accent || tone === 'amber' ? 'text-secondary' : tone === 'settled' ? 'text-settled' : 'text-primary'
  return (
    <div
      data-slot="stat"
      className={cn(
        'flex flex-col items-center justify-center gap-0.5',
        divided && 'sm:border-x sm:border-outline-variant/30',
        className,
      )}
    >
      <span className={cn(size === 'display' ? 'text-display' : 'text-headline-lg font-bold', 'tabular-nums')}>
        <span className={valueClass}>{value}</span>
        {unit ? <span className="text-body-sm font-normal text-on-surface-variant">{unit}</span> : null}
      </span>
      <span className="text-body-sm text-on-surface-variant">{label}</span>
    </div>
  )
}

export default StatGroup
