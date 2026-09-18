import { useCallback, useState } from 'react'

import { useAuthStore } from '@/store/authStore'
import type { LoginPayload, RegisterPayload } from '@/types'

/**
 * 登录态读取（守卫与顶栏用户区共用）
 */
export function useAuth() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const bootstrapped = useAuthStore((s) => s.bootstrapped)
  const loading = useAuthStore((s) => s.loading)
  const login = useAuthStore((s) => s.login)
  const register = useAuthStore((s) => s.register)
  const logout = useAuthStore((s) => s.logout)
  const fetchMe = useAuthStore((s) => s.fetchMe)

  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null)
      try {
        await fn()
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败，请稍后再试')
        return false
      }
    },
    [],
  )

  const doLogin = useCallback(
    (payload: LoginPayload) => run(() => login(payload)),
    [login, run],
  )

  const doRegister = useCallback(
    (payload: RegisterPayload) => run(() => register(payload)),
    [register, run],
  )

  const doLogout = useCallback(() => logout(), [logout])

  return {
    token,
    user,
    bootstrapped,
    loading,
    error,
    login: doLogin,
    register: doRegister,
    logout: doLogout,
    fetchMe,
  }
}
