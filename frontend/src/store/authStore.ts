import { create } from 'zustand'

import { authApi } from '@/api/auth'
import { registerAuthBridge } from '@/api/client'
import { resetUserScopedStores } from '@/store/reset'
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
      /*
       * ⚠️ 换了账号就必须丢掉**所有**按用户缓存的前端状态（画像只是其中一个）：
       * 以前这里只 reset 了 profileStore，chatStore 里上一个账号的 activeId
       * 就会活到新账号的会话里 → 拿别人的会话 id 去拉历史/开场白 → code 2001
       * 「内容不存在」，而开场白簿记又说"拉过了" → 界面永远转圈。
       * 统一入口见 store/reset.ts（那里的纪律注释是这类 bug 的总结）。
       */
      resetUserScopedStores()
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
      // 注册即换号（新账号），与 login 同一条纪律
      resetUserScopedStores()
    } finally {
      set({ loading: false })
    }
  },

  logout() {
    storage.remove(STORAGE_KEY.token)
    set({ token: null, user: null, bootstrapped: true })
    /*
     * ⚠️ 必须一并清掉所有按用户缓存的前端状态。
     * 这里只清 token 是不够的：token 没了只是"下次请求带不上身份"，
     * 而内存里的会话 id / 画像 / 任务 / 简历 / 面试场次不会自己消失 ——
     * 下一个账号登录后会沿用它们（profileStore 里定义了很久的 reset() 此前
     * **从没被调用过**，导致登出后 fetched/tested 残留，守卫拿旧值分流，
     * 把已完成测评的老用户推进 /test/intro 重做 30 题；chatStore 更彻底，
     * 连 reset() 都没人调过，于是有了「新号打开 AI 对话永远转圈」）。
     * 测试答题进度、面试 id 这两个 sessionStorage 键也在统一入口里一起清。
     */
    resetUserScopedStores()
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
