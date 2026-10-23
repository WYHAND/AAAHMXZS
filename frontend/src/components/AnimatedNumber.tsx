import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

/**
 * 数字滚动，用在分数这类"值到手了"的地方。
 *
 * ⚠️ **首帧永远显示真值，绝不先端出 0**（2026-10-18 实测修正）：
 * 原来初始化写的是 `useState(reduce ? value : 0)`，于是哪怕数据早就到手，
 * 也会先渲染一帧 `0` 再滚上去 —— 用户看到的是"我的综合分是 0 / 我的准备度是 0"。
 * 三个现场都在分数位置：个人中心「x / 100 综合分」、成长报告「整体准备度 0 / 100」、
 * 面试复盘「综合得分 0」。0 只有在它**真的是 0** 时才允许出现。所以现在的规则是：
 * - 首次挂载：直接显示 `value`，不做进场补间；
 * - 之后 `value` 变化：从**上一个已落定的真值**滚到新值（不是从 0 滚）。
 * 想要"进场从 0 数上去"的调用方显式传 `animateOnMount`，并自行确认那个位置
 * 短暂出现 0 不会误导用户（分数、比例这类位置**不要**开）。
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
  /**
   * 是否在**首次挂载**时从 0 滚到目标值（默认 `false`）。
   *
   * 默认关掉是刻意的：开会先渲染一帧 0，在分数/比例位置等于告诉用户"你现在是 0"。
   * 只有确认"短暂出现 0 不误导"的位置才开。
   */
  animateOnMount?: boolean
}

export function AnimatedNumber({
  value,
  decimals = 0,
  duration = 520,
  suffix,
  className,
  animateOnMount = false,
}: AnimatedNumberProps) {
  const reduce = usePrefersReducedMotion()
  // 首帧就是真值 —— 见文件头「首帧永远显示真值，绝不先端出 0」
  const [display, setDisplay] = useState(value)
  /** 补间的**起点**：上一个已经落定的真值（不是"当前显示值"，中间帧不算数） */
  const settledRef = useRef(value)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (reduce) {
      settledRef.current = value
      setDisplay(value)
      return
    }

    // 首次挂载：默认直接落在真值上，不补间
    if (!mountedRef.current) {
      mountedRef.current = true
      settledRef.current = value
      if (!animateOnMount) {
        setDisplay(value)
        return
      }
      // 显式要求进场动画：起点退回 0（调用方已确认 0 在这里不误导）
      settledRef.current = 0
    }

    const from = settledRef.current
    if (from === value) {
      setDisplay(value)
      return
    }

    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      // ease-out cubic：与全站进场同一条手感
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(from + (value - from) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else {
        settledRef.current = value
        setDisplay(value)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduce, animateOnMount])

  return (
    <span className={cn('tabular-nums', className)}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  )
}

export default AnimatedNumber
