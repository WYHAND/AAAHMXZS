import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, LogOut, Sparkles, User as UserIcon } from 'lucide-react'

import { StageBadge } from '@/components/StageBadge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MOBILE_TABS, navLabelForPath, orderNav } from '@/constants/nav'
import { useResponsive } from '@/hooks/useResponsive'
import { useStage } from '@/hooks/useStage'
import { useAuthStore } from '@/store/authStore'
import { useProfileStore } from '@/store/profileStore'
import { cn } from '@/lib/utils'

/**
 * 应用主布局（设计说明书 2.2）
 * - ≥1024px：左侧固定侧栏 220px + 顶栏 56px
 * - 768~1023px：窄侧栏（仅图标）
 * - <768px：底部 Tab 四项，其余功能在「我的」里进入
 * - 导航按 profile.stage 自适应排序（NAV_ORDER_BY_STAGE）
 */
export function AppLayout() {
  const { isMobile, isDesktop } = useResponsive()
  const { stage, navOrder, label } = useStage()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const version = useProfileStore((s) => s.version)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const location = useLocation()
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

  return (
    <div className="flex min-h-svh bg-background">
      {/* 侧栏：≥768px 显示 */}
      {!isMobile ? (
        <aside
          data-print="hide"
          className={cn(
            'sticky top-0 flex h-svh shrink-0 flex-col border-r bg-card',
            isDesktop ? 'w-[220px]' : 'w-[68px]',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-2 px-4',
              isDesktop ? 'h-14' : 'h-14 justify-center px-0',
            )}
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Sparkles className="size-4" />
            </span>
            {isDesktop ? (
              <span className="text-sm font-semibold text-foreground">
                AI 就业助手
              </span>
            ) : null}
          </div>

          <ScrollArea className="flex-1">
            <nav className="flex flex-col gap-1 px-2 pb-4">
              {items.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.key}
                    to={item.to}
                    end={item.to === '/'}
                    title={item.label}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                        isDesktop ? '' : 'justify-center px-0',
                        isActive
                          ? 'bg-primary-soft font-medium text-primary'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    {isDesktop ? <span>{item.label}</span> : null}
                  </NavLink>
                )
              })}
            </nav>
          </ScrollArea>
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 顶栏 56px */}
        <header
          data-print="hide"
          className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-card/95 px-4 backdrop-blur"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-muted-foreground">
              {navLabelForPath(location.pathname)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <StageBadge stage={stage} size="sm" showStepper />
            <Button variant="ghost" size="icon-sm" aria-label="通知">
              <Bell className="size-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5 px-1.5">
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-secondary text-xs text-secondary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
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
          </div>
        </header>

        <main
          data-print="main"
          className={cn(
            'flex-1 px-4 py-6 sm:px-6',
            isMobile ? 'pb-24' : 'pb-10',
          )}
        >
          <Outlet />
        </main>
      </div>

      {/* 移动端底部 Tab 四项 */}
      {isMobile ? (
        <nav
          data-print="hide"
          className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-4 border-t bg-card"
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
                    'flex flex-col items-center justify-center gap-1 text-xs transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground',
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

export default AppLayout
