import { motion, useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

/**
 * 近 N 天每日活动柱状图（纯手写 SVG/CSS，无图表库）。
 *
 * 为什么要手写：整页**最多只允许一个 recharts**（那是画像雷达），所以这种小图
 * 必须自己画。柱子只是 div + 高度，比引一个图表库轻得多，也更好对齐设计稿。
 *
 * 用色纪律（2026-10-11 修订，语义分色版）：
 *   - 仍然是**单系列**：14 根柱子同色相（语义蓝 --signal），深浅只表示当天步数的多少
 *     （1–2 步 / 3–5 步 / 6 步以上各一档），不是"好/坏"；
 *   - **今天**用琥珀（--secondary）：全图唯一的强调，给"当下"；
 *   - 无记录的那天只留底柱，颜色比最低档更淡（空≠少，要能被看出来）。
 * 禁止彩虹色、禁止 Tailwind 默认色板、禁止渐变。
 *
 * 动效纪律：进场时柱子从底部逐个升起；系统「减少动态效果」时直接显示终态，
 * 不做任何位移动画。组件内部不包 MotionConfig（由调用方统一托管）。
 */

/** 缓动：和首页一致，先快后慢的「落定」手感 */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** steps 全为 0（或某天无记录）时的最小柱高百分比：留一根底柱，避免整列空白 */
const MIN_BAR_PERCENT = 6

/**
 * 三档浓度：由 --signal 与 --signal-soft 现调，不另写色值。
 * 浓度值是按实拍调的（audit/home-state-color-both-panels.png）：
 * 原方案 16/34/58/85% 在浅底上最淡那两根几乎看不见（13px 宽的柱子 + 24px 高），
 * 提到 26/46/68/90% 后三档能一眼分开，又都还在"蓝"里没有变成墨色。
 */
const BAR_CLASS = {
  /** 那天没走任何一步：只留底柱的淡色 */
  empty: 'bg-[color-mix(in_srgb,var(--signal)_32%,var(--signal-soft))]',
  /** 起步档：1–2 步 */
  low: 'bg-[color-mix(in_srgb,var(--signal)_46%,var(--signal-soft))]',
  /** 中档：3–5 步 */
  mid: 'bg-[color-mix(in_srgb,var(--signal)_68%,var(--signal-soft))]',
  /** 高档：6 步以上 */
  high: 'bg-[color-mix(in_srgb,var(--signal)_90%,var(--signal-soft))]',
} as const

export interface ActivityPoint {
  /** 形如「YYYY-MM-DD」 */
  date: string
  steps: number
}

export interface ActivityStripProps {
  data: ActivityPoint[]
  /** 最多展示多少天（默认 14），取最后 N 天 */
  days?: number
  className?: string
}

/** 把「YYYY-MM-DD」转成「M/D」：直接切字符串，绕开时区，不 new Date */
function tickText(date: string): string {
  const [, month, day] = date.split('-')
  if (!month || !day) return date
  return `${Number(month)}/${Number(day)}`
}

/**
 * 只标首日与每周刻度（自最后一天往回每 7 天），保证「今天」一定有标签、
 * 又不至于把刻度挤成一团。
 */
function isTick(index: number, length: number): boolean {
  if (index === 0) return true
  return (length - 1 - index) % 7 === 0
}

/** 步数 → 档位。阈值写死（1–2 / 3–5 / 6+），因为这是"一天做了几格"的直觉分档 */
function barTone(steps: number): keyof typeof BAR_CLASS {
  if (steps <= 0) return 'empty'
  if (steps <= 2) return 'low'
  if (steps <= 5) return 'mid'
  return 'high'
}

export function ActivityStrip({ data, days = 14, className }: ActivityStripProps) {
  const reduce = useReducedMotion()
  const shown = data.slice(-days)
  if (shown.length === 0) return null

  // 归一化基准取这批数据的最大值；全 0 时 max 为 0，所有柱子走最小底柱
  const max = Math.max(0, ...shown.map((point) => Number(point.steps) || 0))
  const todaySteps = Number(shown[shown.length - 1].steps) || 0

  return (
    <div
      role="img"
      aria-label={`近 ${shown.length} 天每日活动，今天 ${todaySteps} 步`}
      className={cn('flex items-end gap-1', className)}
    >
      {shown.map((point, index) => {
        const steps = Number(point.steps) || 0
        // 高度一律走「归一化高度 ∩ 最小底柱」：注意**今天 0 步时尤其要兜住**——
        // 它同时是归一化基准之外的最后一根，一不小心就画出满格高度，
        // 变成一根 96px 的琥珀实心块，把"今天其实没动"说反了。
        const raw = max > 0 ? (steps / max) * 100 : 0
        const percent = Math.max(raw, MIN_BAR_PERCENT)
        const isToday = index === shown.length - 1
        return (
          <div
            key={`${point.date}-${index}`}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            <div className="flex h-24 w-full items-end">
              <motion.div
                className={cn('w-full rounded-sm', isToday ? 'bg-secondary' : BAR_CLASS[barTone(steps)])}
                style={{ height: `${percent}%`, transformOrigin: 'bottom' }}
                initial={reduce ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.55, delay: reduce ? 0 : index * 0.04, ease: EASE }}
              />
            </div>
            <span
              className={cn(
                'h-4 text-caption tabular-nums',
                isToday ? 'font-medium text-secondary' : 'text-on-surface-variant',
              )}
            >
              {isTick(index, shown.length) ? tickText(point.date) : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default ActivityStrip
