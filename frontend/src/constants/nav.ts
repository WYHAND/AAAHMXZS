/**
 * 导航常量（设计说明书 2.2 导航结构）
 *
 * 桌面：左侧栏 220px + 顶栏 56px
 * 移动（<768px）：底部 Tab 四项（首页 / 对话 / 任务 / 我的）
 * 排序：由 constants/stage.ts 的 NAV_ORDER_BY_STAGE 决定，只改顺序不隐藏。
 */

import {
  BarChart3,
  FileText,
  HelpCircle,
  Home,
  ListChecks,
  MessageSquare,
  Mic,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  key: string
  to: string
  label: string
  icon: LucideIcon
  /** 是否出现在移动端底部 Tab（只有四项） */
  mobileTab?: boolean
  /** 匹配前缀，用于选中态 */
  match?: string[]
}

export const NAV_ITEMS: NavItem[] = [
  { key: '/', to: '/', label: '首页', icon: Home, mobileTab: true },
  { key: '/chat', to: '/chat', label: 'AI 对话', icon: MessageSquare, mobileTab: true },
  { key: '/daily', to: '/daily', label: '每日一问', icon: HelpCircle },
  { key: '/task', to: '/task', label: '成长任务', icon: ListChecks, mobileTab: true },
  { key: '/resume', to: '/resume', label: '简历', icon: FileText },
  { key: '/interview', to: '/interview', label: '模拟面试', icon: Mic },
  { key: '/report', to: '/report', label: '成长报告', icon: BarChart3 },
  { key: '/profile', to: '/profile', label: '个人中心', icon: User, mobileTab: true },
]

export const NAV_BY_KEY: Record<string, NavItem> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.key, item]),
)

/** 移动端底部 Tab 固定四项 */
export const MOBILE_TABS = NAV_ITEMS.filter((item) => item.mobileTab)

/** 按阶段顺序重排侧栏（2.2：只改顺序、不隐藏功能） */
export function orderNav(order: string[]): NavItem[] {
  const ranked = order
    .map((key) => NAV_BY_KEY[key])
    .filter((item): item is NavItem => Boolean(item))
  const rest = NAV_ITEMS.filter((item) => !order.includes(item.key))
  return [...ranked, ...rest]
}

/** 顶栏面包屑：当前路径 → 名称 */
export function navLabelForPath(pathname: string): string {
  const exact = NAV_ITEMS.find((item) => item.to === pathname)
  if (exact) return exact.label
  const prefixed = NAV_ITEMS.find(
    (item) => item.to !== '/' && pathname.startsWith(item.to),
  )
  return prefixed?.label ?? '首页'
}
