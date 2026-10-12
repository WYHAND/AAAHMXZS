import { motion, useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

/**
 * 信号条：标签 + 横向条 + 数值（纯 CSS，无图表库）。
 *
 * 语义：它呈现的是**证据强度**的分布形状，**不是打分**。条越满只代表这一项
 * 被聊到/记录得越多，不代表「越好」——所以文案里禁止出现「越满越好」「能力越强」
 * 这类暗示（调用方给 label/meta 时要守住这条）。
 *
 * 用色纪律（2026-10-11 修订）：track 仍是中性浅底（bg-surface-container）；
 * 填充色由调用方按**语义**指定，**只允许这三个**：
 *   neutral（缺省）→ 主墨，纯灰底场景保持原样；
 *   signal         → 语义蓝 --signal，表示「这是聊出来的数据」；
 *   accent         → 琥珀，表示「现在要看的这一条」。
 * 仍然禁止：渐变、彩虹色、Tailwind 默认色板、单条里多色。颜色一律只落在图形
 * 与小圆点上，标签文字保持主墨。
 *
 * 动效：进场时条从左侧展开；系统「减少动态效果」时静止显示终态。
 * 组件内部不包 MotionConfig（由调用方统一托管）。
 */

/** 缓动：和首页一致 */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

/** 填充 + 标签前小圆点共用的语义色（点与条必须同色，否则读起来像两套语义） */
const TONE_CLASS: Record<SignalTone, string> = {
  neutral: 'bg-primary',
  signal: 'bg-signal',
  accent: 'bg-secondary',
}

/** 标签前的小圆点：比条略深一档，6px 足够被看见又不抢戏 */
const DOT_CLASS: Record<SignalTone, string> = {
  neutral: 'bg-primary',
  signal: 'bg-signal',
  accent: 'bg-secondary',
}

export type SignalTone = 'neutral' | 'signal' | 'accent'

export interface SignalBarProps {
  label: string
  /** 当前值 */
  value: number
  /** 归一化用的最大值（value/max 决定条长），默认取 1 */
  max?: number
  /** 右侧小字（如「来自对话」），可空 */
  meta?: string
  /** 语义色，缺省 neutral（主墨） */
  tone?: SignalTone
  className?: string
}

/** 数字最多两位小数，整数原样显示（避免出现 0.30000000000000004 这种尾巴） */
function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

export function SignalBar({
  label,
  value,
  max = 1,
  meta,
  tone = 'neutral',
  className,
}: SignalBarProps) {
  const reduce = useReducedMotion()
  // 归一化到 0-100 并夹紧；max ≤ 0 时条长为 0（不除零、不画反方向）
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {/* 小圆点：给"这一条属于什么"一个一眼可辨的标记，代替再加一行文字说明 */}
          <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[tone])} aria-hidden />
          <span className="truncate text-body-md text-primary">{label}</span>
        </span>
        <span className="flex shrink-0 items-baseline gap-2">
          {meta ? <span className="text-caption text-on-surface-variant">{meta}</span> : null}
          <span className="text-body-md font-medium tabular-nums text-primary">
            {formatValue(value)}
          </span>
        </span>
      </div>
      {/* 条高 6px、圆角 full：与全站进度条规格一致（主卡 6px / 列表行 4px，这里取 6px） */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
        <motion.div
          className={cn('h-full rounded-full', TONE_CLASS[tone])}
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.7, ease: EASE }}
        />
      </div>
    </div>
  )
}

export default SignalBar
