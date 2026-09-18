import { create } from 'zustand'

import { authApi } from '@/api/auth'
import { registerAuthBridge } from '@/api/client'
import { STORAGE_KEY, storage } from '@/utils/storage'
import type { LoginPayload, RegisterPayload, User } from '@/types'

/**
 * authStore（设计说明书 4.1）
 * 持久化：仅 token → localStorage；user 与 bootstrapped 只在内存。
 *
 * 后端 /auth/login 与 /auth/register **都**返回 TokenResponse（含 user），
 * 所以登录/注册成功即可直接拿到 user，不需要再打一次 /auth/me；
 * /auth/me 只在「本地有 token 但内存没有 user」（刷新页面）时调用。
 * 登出是纯客户端行为：后端没有 /auth/logout（Fix A）。
 */

interface AuthState {
  token: string | null
  user: User | null
  /** 是否已完成一次 bootstrap（守卫据此避免闪烁） */
  bootstrapped: boolean
  loading: boolean
  login: (payload: LoginPayload) => Promise<void>
  register: (payload: RegisterPayload) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: storage.get<string | null>(STORAGE_KEY.token, null),
  user: null,
  bootstrapped: false,
  loading: false,

  async login(payload) {
    set({ loading: true })
    try {
      const data = await authApi.login(payload)
      storage.set(STORAGE_KEY.token, data.access_token)
      set({ token: data.access_token, user: data.user ?? null, bootstrapped: true })
    } finally {
      set({ loading: false })
    }
  },

  async register(payload) {
    set({ loading: true })
    try {
      // 后端注册直接返回 token + user，无需再登录一次
      const data = await authApi.register(payload)
      storage.set(STORAGE_KEY.token, data.access_token)
      set({ token: data.access_token, user: data.user ?? null, bootstrapped: true })
    } finally {
      set({ loading: false })
    }
  },

  logout() {
    storage.remove(STORAGE_KEY.token)
    storage.session.remove(STORAGE_KEY.testProgress)
    storage.session.remove(STORAGE_KEY.interviewId)
    set({ token: null, user: null, bootstrapped: true })
  },

  async fetchMe() {
    if (!get().token) {
      set({ bootstrapped: true, user: null })
      return
    }
    try {
      const user = await authApi.me()
      set({ user, bootstrapped: true })
    } catch {
      // token 失效：清干净，交回守卫跳登录
      storage.remove(STORAGE_KEY.token)
      set({ token: null, user: null, bootstrapped: true })
    }
  },
}))

/* 反向注入到 api/client.ts，避免 client → store → client 的循环依赖。
 *
 * ⚠️ 这里**只清 token**，不做 `window.location.href` 整页硬跳：
 * logout() 把 token 置空后，RequireAuth 会渲染 <Navigate to="/login" replace>，
 * 由路由守卫完成客户端跳转（不刷新页面、不丢 SPA 状态）。
 */
registerAuthBridge({
  getToken: () => useAuthStore.getState().token,
  onUnauthorized: () => {
    useAuthStore.getState().logout()
  },
})
