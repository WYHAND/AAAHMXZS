/**
 * 认证接口 —— 路径对齐后端 app/api/v1/auth.py（prefix="/auth"）
 *
 * 后端只有 3 个端点：POST /register、POST /login、GET /me。
 * **没有 /auth/logout**：登出是纯客户端行为（清 token），
 * 见 store/authStore.logout()。
 */

import { get, post } from '@/api/client'
import type { LoginPayload, RegisterPayload, TokenResponse, User } from '@/types'

export const authApi = {
  /** 后端 schemas/user.TokenResponse：直接返回 token + user */
  login: (payload: LoginPayload) => post<TokenResponse>('/auth/login', payload),
  register: (payload: RegisterPayload) => post<TokenResponse>('/auth/register', payload),
  me: () => get<User>('/auth/me'),
}
