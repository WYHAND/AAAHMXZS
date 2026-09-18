/**
 * 响应式断点（设计说明书 2.2）
 * ≥1024px：左侧栏 220px + 顶栏 56px
 * <768px：底部 Tab 四项
 * 中间区间：折叠侧栏（只有图标）
 */

import { useEffect, useState } from 'react'

export interface UseResponsiveResult {
  width: number
  /** ≥1024 */
  isDesktop: boolean
  /** 768 ≤ w < 1024 */
  isTablet: boolean
  /** <768：用底部 Tab，隐藏侧栏 */
  isMobile: boolean
}

function readWidth(): number {
  if (typeof window === 'undefined') return 1280
  return window.innerWidth
}

export function useResponsive(): UseResponsiveResult {
  const [width, setWidth] = useState<number>(readWidth)

  useEffect(() => {
    let frame = 0
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWidth(readWidth()))
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return {
    width,
    isDesktop: width >= 1024,
    isTablet: width >= 768 && width < 1024,
    isMobile: width < 768,
  }
}
