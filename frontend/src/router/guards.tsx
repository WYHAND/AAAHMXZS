import { type ReactNode, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuthStore } from '@/store/authStore'
import { useProfileStore } from '@/store/profileStore'

/**
 * 路由守卫（设计说明书 2.1 首次进入漏斗）
 *
 *   未登录            → /login
 *   已登录 + 未做测评  → 强制 /test/intro（其它路由一律重定向）
 *   已登录 + 已做测评  → /（首页）
 *   已登录 + 测试中途  → /test/question?resume=1（本地存答题进度）
 *
 * ⚠️ 漏斗判据（Fix C）：
 * 后端 GET /profile 走 get_or_create_profile，**永远 200 且返回画像对象**，
 * 所以不能用 Boolean(profile) 判断「有没有画像」——那样新注册用户会直接掉进首页。
 * 判据是 profileStore.tested，它读后端 ProfileResponse.tested
 * （依据 test_results 是否存在）；字段缺失时回落到「有标签即算测过」。
 */

const TEST_PREFIX = '/test'

function FullScreenHint({ text }: { text: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

/** 要求登录：负责触发一次 bootstrap（有 token 时拉 /auth/me 与 /profile） */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const bootstrapped = useAuthStore((s) => s.bootstrapped)
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const profileFetched = useProfileStore((s) => s.fetched)
  const profileLoading = useProfileStore((s) => s.loading)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const location = useLocation()

  // token → user（登录/注册已带回 user，这里只处理刷新页面）
  useEffect(() => {
    if (token && !user && !bootstrapped) {
      void fetchMe()
    }
  }, [token, user, bootstrapped, fetchMe])

  // token → profile（漏斗判据 + 全局 version 失效由布局负责刷新）
  useEffect(() => {
    if (token && !profileFetched && !profileLoading) {
      void fetchProfile()
    }
  }, [token, profileFetched, profileLoading, fetchProfile])

  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (!bootstrapped || !profileFetched) {
    return <FullScreenHint text="正在准备你的工作台…" />
  }

  return children ? <>{children}</> : <Outlet />
}

/**
 * 要求已完成测评：未测评时强制去 /test/intro。
 * /test/* 自身不加这个守卫，否则会自我重定向死循环。
 */
export function RequireProfile({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const fetched = useProfileStore((s) => s.fetched)
  const tested = useProfileStore((s) => s.tested)

  if (!fetched) {
    return <FullScreenHint text="正在读取你的画像…" />
  }

  if (!tested && !location.pathname.startsWith(TEST_PREFIX)) {
    return <Navigate to="/test/intro" replace />
  }

  return children ? <>{children}</> : <Outlet />
}

/** 已登录用户访问 /login、/register 时直接放回漏斗的下一站 */
export function RedirectIfAuthed({ children }: { children?: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const fetched = useProfileStore((s) => s.fetched)
  const tested = useProfileStore((s) => s.tested)

  if (token && fetched) {
    return <Navigate to={tested ? '/' : '/test/intro'} replace />
  }

  return children ? <>{children}</> : <Outlet />
}
