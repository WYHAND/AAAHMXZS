import { type ReactNode, useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
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
 * 判据是 profileStore.tested，它读后端 ProfileResponse.tested（依据 test_results 是否存在）。
 *
 * ⚠️⚠️ 三种状态必须分开，绝不能合并（踩过坑）：
 *   ① 加载中      → 显示"正在准备"，什么都不跳
 *   ② **加载失败** → 显示「重试」，**绝不跳测评**
 *   ③ 加载成功且 tested=false → 这才是"没做过测评"，跳 /test/intro
 *
 * 曾经把 ② 也写成 `fetched: true`，于是 `tested` 保持默认 false，
 * 守卫把「后端没起来导致请求失败」误判成「用户未测评」：
 * 重启后端那几秒内加载过页面、再重新登录，**老用户就会被推进 30 题测评**。
 */

const TEST_PREFIX = '/test'

function FullScreenHint({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-canvas px-6">
      <p className="text-center text-body-md text-on-surface-variant">{text}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      ) : null}
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
  const profileFailed = useProfileStore((s) => s.failed)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const location = useLocation()

  // token → user（登录/注册已带回 user，这里只处理刷新页面）
  useEffect(() => {
    if (token && !user && !bootstrapped) {
      void fetchMe()
    }
  }, [token, user, bootstrapped, fetchMe])

  // token → profile（漏斗判据 + 全局 version 失效由布局负责刷新）
  // 失败后必须等用户手动重试：否则 effect 会在 failed 与 render 之间无限重试造成请求风暴
  useEffect(() => {
    if (token && !profileFetched && !profileLoading && !profileFailed) {
      void fetchProfile()
    }
  }, [token, profileFetched, profileLoading, profileFailed, fetchProfile])

  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  // ② 拉取失败：给重试，**绝不**当成"没做过测评"
  if (profileFailed) {
    return (
      <FullScreenHint
        text="没能读到你的数据（后端可能还在启动）。稍等几秒再重试，不会影响你的测评记录。"
        onRetry={() => void fetchProfile()}
      />
    )
  }

  // ① 加载中
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
  const failed = useProfileStore((s) => s.failed)
  const tested = useProfileStore((s) => s.tested)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)

  // 与 RequireAuth 同一套护栏：失败只提示重试，不跳测评
  if (failed) {
    return (
      <FullScreenHint
        text="没能读到你的画像（后端可能还在启动）。稍等几秒再重试。"
        onRetry={() => void fetchProfile()}
      />
    )
  }

  if (!fetched) {
    return <FullScreenHint text="正在读取你的画像…" />
  }

  // ③ 只有"确实拿到了画像、且后端说没测过"才跳测评
  if (!tested && !location.pathname.startsWith(TEST_PREFIX)) {
    return <Navigate to="/test/intro" replace />
  }

  return children ? <>{children}</> : <Outlet />
}

/** 已登录用户访问 /login、/register 时直接放回漏斗的下一站 */
export function RedirectIfAuthed({ children }: { children?: ReactNode }) {
  const token = useAuthStore((s) => s.token)
  const fetched = useProfileStore((s) => s.fetched)
  const failed = useProfileStore((s) => s.failed)
  const tested = useProfileStore((s) => s.tested)

  // 只有"成功拿到过画像"才敢按 tested 分流；
  // 失败时（failed=true）留在登录页，让用户看到错误提示而不是被莫名推进测评
  if (token && fetched && !failed) {
    return <Navigate to={tested ? '/' : '/test/intro'} replace />
  }

  return children ? <>{children}</> : <Outlet />
}
