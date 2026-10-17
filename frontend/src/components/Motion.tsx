import type { ElementType, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * 动效助手（2026-10-12 前端迭代）。
 *
 * 为什么是薄薄一层 CSS 类而不是上动画库：
 * - 主页用 motion/react 做的是**编排型**动效（共享 layoutId、跟随手指），
 *   那是它的专属需求；其它页面要的只是"进场一次 + 交互反馈"，
 *   用 CSS 就够，且不增加运行时开销，`prefers-reduced-motion` 也能在 CSS 里一次关干净。
 * - 全站节拍定义在 `index.css` 的「统一动效语汇」一节，改节拍只改那一处。
 *
 * ⚠️ 只做两类：进场（一次）与交互反馈。不要在这里加循环动画 / 弹跳 / 旋转。
 */

/** 列表错峰：第 index 项的进场延迟。只错开头几项，免得最后一项等太久 */
export function staggerDelay(index: number, step = 32, max = 7): number {
  return Math.min(index, max) * step
}

export interface RevealProps {
  children: ReactNode
  /** 元素标签，默认 div（用在列表里就传 li） */
  as?: ElementType
  /** 进场延迟（毫秒）。列表里用 staggerDelay(i) */
  delay?: number
  /** 大块（页面主角区）用，节拍更从容 */
  lg?: boolean
  /** 只淡入、不上浮（整页容器、覆盖层） */
  fade?: boolean
  className?: string
}

/** 进场容器：默认上浮 8px + 淡入，一次播完，不改变布局占位 */
export function Reveal({ children, as: Tag = 'div', delay = 0, lg, fade, className }: RevealProps) {
  return (
    <Tag
      className={cn(fade ? 'fade-in' : lg ? 'rise-in-lg' : 'rise-in', className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}

export default Reveal
