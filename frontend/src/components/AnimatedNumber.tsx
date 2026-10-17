import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * 数字滚动（进场时从 0 数到目标值），用在分数这类"值到手了"的地方。
 *
 * 为什么自己做而不是用库：
 * - Motion 的 AnimateNumber 在 motion-plus 包里（要另装）；这里只要一个 500ms 的补间，
 *   requestAnimationFrame 就够，不引任何依赖。
 * - Magic UI / Aceternity 那类组件库的数字动效都依附它们的主题与依赖，
 *   为了一个补间引一整套库不划算。
 *
 * 纪律（照外部规范）：
 * - 时长 520ms，缓动 ease-out cubic（起手快、收尾稳，和全站进场一支笔）。
 * - 只用文本变化，不动布局（数字等宽，用 tabular-nums 防止宽度跳动）。
 * - prefers-reduced-motion: reduce → 直接显示终值，不滚动。
 * - 不做 live region：屏幕阅读器只会在读到它时读当前值，不会被中间态轰炸。
 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduce(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  return reduce
}

export interface AnimatedNumberProps {
  /** 目标值 */
  value: number
  /** 小数位（默认 0） */
  decimals?: number
  /** 补间时长（毫秒） */
  duration?: number
  /** 后缀，如「分」「%」 */
  suffix?: string
  className?: string
}

export function AnimatedNumber({
  value,
  decimals = 0,
  duration = 520,
  suffix,
  className,
}: AnimatedNumberProps) {
  const reduce = usePrefersReducedMotion()
  const [display, setDisplay] = useState(reduce ? value : 0)

  useEffect(() => {
    if (reduce) {
      setDisplay(value)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      // ease-out cubic：与全站进场同一条手感
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(value * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else setDisplay(value)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduce])

  return (
    <span className={cn('tabular-nums', className)}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  )
}

export default AnimatedNumber
