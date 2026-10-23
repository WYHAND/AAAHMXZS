import { motion, useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

/**
 * 环形进度（纯手写 SVG，无图表库）：用于任务完成度这种「done / total」。
 *
 * 为什么手写：整页最多只允许一个 recharts（那是画像雷达），环形图自己画两个
 * circle 就够，还能精确控制起点、线帽与居中数字。
 *
 * 用色纪律（2026-10-11 修订）：底环仍是中性浅底（--surface-container-highest）；
 * 进度环的颜色由调用方按**任务当前状态**给，只允许四档：
 *   ink（缺省）→ 主墨，保持原样，给不需要状态语义的场景（如成长报告的报表）；
 *   wait        → 克制红 --attention：一步都还没走，需要被看见；
 *   signal      → 语义蓝 --signal：已经在走了；
 *   settled     → 克制绿 --settled：做完了。
 * 单系列，不用渐变、不用彩虹色、不用 Tailwind 默认色板。颜色同时落在环与中间的
 * 数字上（**同一档色**，不同档色会读成两个意思）。
 *
 * ⚠️ wait 这档一屏最多给**一处**：红是整页最响的颜色，两处以上就变成报警灯了。
 *
 * 动效：进场时进度环用 strokeDashoffset 从空填到目标；系统「减少动态效果」时
 * 直接显示终态。组件内部不包 MotionConfig（由调用方统一托管）。
 */

/** 缓动：和首页一致 */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

export type StatRingTone = 'ink' | 'wait' | 'signal' | 'settled' | 'accent'

/**
 * 环与数字共用的 CSS 变量名。这里写 `var(--x)` 而不是 Tailwind 工具类：
 * SVG 的 stroke 只认 CSS 值，而 --signal/--settled/--attention 是 2026-10-11
 * 新增的状态色 token（见 index.css），不在 Tailwind 默认色板里。
 */
const TONE_TOKEN: Record<StatRingTone, string> = {
  ink: 'var(--primary)',
  wait: 'var(--attention)',
  signal: 'var(--signal)',
  settled: 'var(--settled)',
  accent: 'var(--secondary)',
}

const TONE_TEXT: Record<StatRingTone, string> = {
  ink: 'text-primary',
  wait: 'text-attention',
  signal: 'text-signal-ink',
  settled: 'text-settled',
  accent: 'text-secondary',
}

export interface StatRingProps {
  /** 已完成 */
  done: number
  /** 总数 */
  total: number
  /** 环下面/中间的说明文字，如「1/4 步」或任务名 */
  label: string
  /** 直径 px，默认 72 */
  size?: number
  /** 环宽 px，默认 7 */
  stroke?: number
  /** 语义色，缺省 ink（主墨） */
  tone?: StatRingTone
  className?: string
}

export function StatRing({
  done,
  total,
  label,
  size = 72,
  stroke = 7,
  tone = 'ink',
  className,
}: StatRingProps) {
  const reduce = useReducedMotion()
  // total 为 0 时进度按 0 处理（不除零），仍画出完整的空环
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - ratio)

  return (
    <div className={cn('inline-flex flex-col items-center gap-1.5', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        {/* -rotate-90：让进度从 12 点方向起画，而不是 SVG 默认的 3 点方向 */}
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            stroke="var(--surface-container-highest)"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            stroke={TONE_TOKEN[tone]}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={reduce ? false : { strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.8, ease: EASE }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn('text-headline-lg leading-none tabular-nums', TONE_TEXT[tone])}>
            {done}/{total}
          </span>
        </div>
      </div>
      <span className="text-caption text-on-surface-variant">{label}</span>
    </div>
  )
}

export default StatRing
