import { useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import {
  Bell,
  ChevronDown,
  LogOut,
  Maximize2,
  Minus,
  Sparkles,
  User as UserIcon,
  X,
} from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MOBILE_TABS, orderNav, type NavItem } from '@/constants/nav'
import { useResponsive } from '@/hooks/useResponsive'
import { useStage } from '@/hooks/useStage'
import { useAuthStore } from '@/store/authStore'
import { useProfileStore } from '@/store/profileStore'
import { cn } from '@/lib/utils'

/**
 * 应用主布局 —— 高保真还原用户给的 Stitch 稿（Serene Career Companion）
 * 真源：stitch_ai_desktop_app_refinement.zip（code.html + DESIGN.md）
 *
 * 结构（与稿子一一对应）：
 * - **顶部 44px 无边框窗口头**（h-11，bg-surface/90 + backdrop-blur + 极轻投影）：
 *   左侧 Logo + 「AI 就业助手」+「桌面版」标签；右侧阶段 pill、通知、头像、
 *   以及**仅桌面端**的最小化/最大化/关闭（真的连 Electron IPC，不是画上去的）。
 * - **左侧 240px 亚麻侧栏**（w-60，bg-surface-container-low，右下角一道 1px 分隔线）：
 *   三组标题（核心导航 / 就业求职 / 我的）。
 * - **内容区**：左让 240px（pl-60）、上让 44px（pt-11），内层 max-w-[1040px] 居中，
 *   外边距 32px（px-margin py-margin）。
 *
 * 两处**保留本项目产品逻辑**（与稿子的固定分组并存）：
 * 1. 分组内的顺序仍按 `NAV_ORDER_BY_STAGE`（阶段自适应排序）—— 稿子是固定顺序，
 *    但"按阶段重排"是本项目 2.2 的明确设计，所以"分组用稿子的、组内顺序用我们的"；
 * 2. 移动端（<768px）仍走底部四项 Tab —— 稿子只画了桌面端。
 *
 * 一处与稿子不同：**图标沿用项目现有的 lucide**（稿子用 Material Symbols 字体图标，
 * 那需要额外下载一套图标字体；语义一致、形状略有差异）。
 */
export function AppLayout() {
  const { isMobile } = useResponsive()
  const { navOrder, label } = useStage()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const version = useProfileStore((s) => s.version)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const navigate = useNavigate()

  const items = orderNav(navOrder)

  // 4.2：version 是全局失效信号，任何写操作后重新拉画像
  useEffect(() => {
    void fetchProfile()
  }, [fetchProfile, version])

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  // 后端 User 只有 username（没有 nickname/avatar 字段）
  const displayName = user?.username ?? '同学'
  const initials = displayName.slice(0, 1)

  /** Electron 桥（浏览器里没有这个对象，所以窗口控制按钮只在桌面端出现） */
  const desktop = (window as unknown as { electronAPI?: DesktopBridge }).electronAPI
  const isDesktopShell = Boolean(desktop?.isDesktop)

  /** 侧栏分组（组内顺序仍按阶段自适应，见 constants/stage.ts） */
  const groups: Array<{ title: string; keys: string[] }> = [
    { title: '核心导航', keys: ['/', '/chat', '/daily', '/task'] },
    { title: '就业求职', keys: ['/resume', '/interview'] },
    // 「我的」这一组和上面两组一样，就是一组普通导航项（不再吊在侧栏最底部）
    { title: '我的', keys: ['/profile', '/report'] },
  ]
  const groupItems = (keys: string[]): NavItem[] =>
    items.filter((item) => keys.includes(item.key))

  return (
    <div className="min-h-svh bg-surface text-on-surface">
      {/* ---------------------------- 顶部 44px 窗口头 ---------------------------- */}
      <header
        data-print="hide"
        className="app-drag fixed inset-x-0 top-0 z-50 flex h-11 items-center justify-between bg-surface/90 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.03)] backdrop-blur-md"
      >
        <div className="app-no-drag flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-primary text-on-primary shadow-sm">
            <Sparkles className="size-3.5" />
          </span>
          <span className="text-headline-sm font-semibold tracking-tight text-primary">
            AI 就业助手
          </span>
          <span className="rounded bg-surface-container-high px-1.5 py-0.5 text-caption text-on-surface-variant">
            桌面版
          </span>
        </div>

        <div className="app-no-drag flex items-center gap-4">
          {/* 阶段 pill：状态显示 + 个人中心快捷方式（不再是唯一入口 —— 侧栏已一级可见） */}
          <NavLink
            to="/profile"
            className="flex items-center gap-1.5 rounded-full bg-surface-container-low px-3 py-1 text-on-surface transition-colors hover:bg-surface-container"
          >
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            <span className="text-label-md font-medium">{label}</span>
            <ChevronDown className="size-3.5 text-on-surface-variant" aria-hidden />
          </NavLink>

          <button
            type="button"
            aria-label="通知中心"
            className="flex size-7 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <Bell className="size-[18px]" />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="账号"
                className="flex size-8 items-center justify-center rounded-full bg-primary text-caption font-medium text-on-primary"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">{displayName}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  当前阶段：{label}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <UserIcon className="size-4" />
                个人中心
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="size-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 窗口控制：只在 Electron 桌面端渲染，且真的调主进程（浏览器里没有窗口可控制） */}
          {isDesktopShell ? (
            <>
              <span className="mx-0.5 h-4 w-px bg-outline-variant/40" aria-hidden />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="最小化"
                  onClick={() => desktop?.minimize?.()}
                  className="flex size-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                >
                  <Minus className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="最大化"
                  onClick={() => desktop?.maximize?.()}
                  className="flex size-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                >
                  <Maximize2 className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="关闭窗口"
                  onClick={() => desktop?.close?.()}
                  className="flex size-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-error hover:text-on-error"
                >
                  <X className="size-4" />
                </button>
              </div>
            </>
          ) : null}
        </div>
      </header>

      {/* ------------------------------ 左侧 240px 侧栏 ------------------------------ */}
      {!isMobile ? (
        <aside
          data-print="hide"
          className="fixed bottom-0 left-0 top-11 z-40 flex w-60 flex-col justify-between bg-surface-container-low py-4 shadow-[0_1px_8px_rgba(0,0,0,0.02)]"
        >
          <nav className="flex-1 space-y-1 overflow-y-auto px-2">
            {groups.map((group) => (
              <div key={group.title}>
                <div className="px-3 pb-2 pt-1 text-caption uppercase tracking-wider text-on-surface-variant">
                  {group.title}
                </div>
                {groupItems(group.keys).map((item) => (
                  <SideNavItem key={item.key} item={item} />
                ))}
              </div>
            ))}
          </nav>
        </aside>
      ) : null}

      {/* -------------------------------- 内容区 -------------------------------- */}
      <div className={cn(!isMobile && 'pl-60')}>
        <main
          data-print="main"
          className={cn(
            /*
             * 顶部留白 = 窗口头 44px + 页面呼吸 32px（= --spacing-shell: 76px）。
             * 旧写法是 px-margin py-margin pt-11：pt-11 把 py 的 32px 顶掉了，
             * 于是页面标题紧贴窗口头（实测 h1 的 y=44，正好压在窗头下沿）。
             * 高度相关的页面（/test/question）引用同一个 token，不再各写魔法数。
             */
            'relative min-h-screen w-full bg-surface px-margin pb-margin pt-shell',
            isMobile && 'pb-24',
          )}
        >
          <div className="mx-auto w-full max-w-[1040px]">
            <Outlet />
          </div>
        </main>
      </div>

      {/* 移动端底部 Tab 四项（稿子只有桌面端，这里沿用原交互、只换皮） */}
      {isMobile ? (
        <nav
          data-print="hide"
          className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t border-border bg-card"
        >
          {MOBILE_TABS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-1 text-caption transition-colors',
                    isActive ? 'text-secondary' : 'text-on-surface-variant',
                  )
                }
              >
                <Icon className="size-5" />
                {item.label}
              </NavLink>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}

/**
 * 侧栏一项。
 * 选中态是一块**会滑动的高亮**（motion 的 layoutId 共享同一个元素）——
 * 切换路由时高亮从旧项滑到新项，而不是原地闪现。
 */
function SideNavItem({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-label-md transition-colors',
          isActive
            ? 'font-semibold text-primary'
            : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <motion.span
              layoutId="sidebar-active"
              className="absolute inset-0 rounded-lg bg-surface-container-highest"
              transition={{ type: 'spring', stiffness: 520, damping: 42 }}
            />
          ) : null}
          <Icon className="relative z-10 size-5 shrink-0" />
          <span className="relative z-10">{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

/**
 * Electron preload 暴露的桥（见 electron/src/preload.ts）。
 * 浏览器里 `window.electronAPI` 不存在 —— 所以窗口控制按钮只在桌面端渲染。
 */
interface DesktopBridge {
  isDesktop?: boolean
  notify?: (title: string, body: string) => Promise<boolean>
  minimize?: () => void
  maximize?: () => void
  close?: () => void
}

export default AppLayout
