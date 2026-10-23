/**
 * axios 实例与统一响应解包
 *
 * 后端契约（2026-09-18 更新，以此为准）：
 * - 业务失败：HTTP 200 + `{ code, message, data }`，code !== 0。
 * - 认证/权限/未找到/服务器错误：**真实 HTTP 状态码**，body 仍是同一个信封：
 *     401 → {code:1002}  403 → {code:1003}  404 → {code:2001}  500 → {code:5000}
 * - 所以成功与失败两条路径都要解信封。
 */

import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import { toast } from 'sonner'

import {
  ERROR_CODE,
  NETWORK_ERROR_TEXT,
  TIMEOUT_ERROR_TEXT,
  errorText,
} from '@/constants/errorCode'
import type { ApiEnvelope } from '@/types'

/** 业务层可以按 code 分支 */
export class ApiError extends Error {
  code: number
  /** 后端原始 message（可能比映射文案更具体） */
  serverMessage?: string
  raw?: unknown

  constructor(code: number, message: string, serverMessage?: string, raw?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.serverMessage = serverMessage
    this.raw = raw
  }
}

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** 为 true 时不弹全局错误 toast，交调用方自己给出更具体的下一步文案 */
    silent?: boolean
    /**
     * 为 true 时**不解信封**：成功路径返回整封 `{code,message,data}`。
     *
     * 默认（false）拦截器只把 `data` 交给调用方 —— 绝大多数接口只关心 data，
     * 但**信封里的 message 有时是业务的一部分**：简历润色那句
     * 「已润色；还有 3 项你没填，先空着（…）」是后端算出来的人话，界面要原样显示。
     * 只给 `POST /resume/polish` 用（见 api/resume.ts 的 polish）。
     */
    envelope?: boolean
  }
}

/* ------------------------- 反向注入：避免 store → api → store 循环依赖 ------------------------- */

interface AuthBridge {
  getToken: () => string | null
  onUnauthorized: () => void
}

/**
 * 未登录时的默认处理：**什么都不做**。
 *
 * ⚠️ 这里刻意不做 `window.location.href = '/login'`（整页硬跳会丢 SPA 状态、
 * 重新加载整个 bundle）。真正的处理是由 store/authStore.ts 注册的
 * `onUnauthorized` —— 它只清 token，跳转交给路由守卫的
 * `<Navigate to="/login">` 做客户端跳转。
 */
let authBridge: AuthBridge = {
  getToken: () => null,
  onUnauthorized: () => {},
}

/** 由 store/authStore.ts 在模块初始化时调用 */
export function registerAuthBridge(bridge: AuthBridge): void {
  authBridge = bridge
}

/**
 * 当前登录态 token（没有则 null）。
 *
 * 只给**走不了 axios 的请求**用 —— 目前唯一一处是 api/chat.ts 的 SSE：
 * `fetch` + `ReadableStream` 是消费事件流的唯一方式（EventSource 既不能带
 * Authorization 头也不能带 JSON body），因此它绕过了这里的请求拦截器，
 * 必须自己取一次 token。其余请求一律继续走 `client`，不要用这个函数。
 */
export function getAuthToken(): string | null {
  return authBridge.getToken()
}

/* ------------------------------ 实例 ------------------------------ */

/**
 * 桌面端 preload 注入的桥：只声明这里用得到的字段，不接管整个 window 的类型。
 * preload.ts 在 `electronAPI` 上挂了 apiBase —— 端口是主进程**运行时**挑的，
 * 8000 被占时可能是 `http://127.0.0.1:8010/api/v1`，构建期的 .env 不可能写死。
 */
interface DesktopBridge {
  apiBase?: string
}

/**
 * 后端 API 前缀，优先级从高到低：
 * 1. 桌面端运行时注入的地址 —— 唯一能跟上主进程实际端口的来源；
 * 2. `VITE_API_BASE`（打包前的构建期配置 / 浏览器开发）；
 * 3. `/api/v1`（纯浏览器开发走同源代理兜底）。
 * 浏览器里没有 `window.electronAPI`，前两项自然落到 2、3，行为与以前一致。
 */
export const API_BASE =
  (window as unknown as { electronAPI?: DesktopBridge }).electronAPI?.apiBase ??
  import.meta.env.VITE_API_BASE ??
  '/api/v1'

export const client: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
})

client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authBridge.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiEnvelope<unknown>).code === 'number'
  )
}

/** 统一处理信封里的非 0 code：登出跳登录 / 中文 toast / 抛 ApiError */
function rejectWithEnvelope(
  payload: ApiEnvelope<unknown>,
  silent: boolean | undefined,
): never {
  const { code, message } = payload

  if (code === ERROR_CODE.UNAUTHORIZED) {
    authBridge.onUnauthorized()
  }

  const text = errorText(code, message)
  if (!silent) {
    toast.error(text)
  }
  throw new ApiError(code, text, message, payload)
}

client.interceptors.response.use(
  (res) => {
    const payload = res.data as unknown

    // 非包装响应（例如 blob、裸对象）原样透传，避免前端硬崩
    if (!isEnvelope(payload)) {
      return payload as never
    }

    if (payload.code === ERROR_CODE.OK) {
      /*
       * 默认只给业务数据；`envelope: true` 的请求要连 `message` 一起拿走
       * （润色那句人话就在里面）。失败路径两条完全一样，都是 rejectWithEnvelope。
       */
      const wantEnvelope = (res.config as AxiosRequestConfig).envelope
      return (wantEnvelope ? payload : payload.data) as never
    }

    const silent = (res.config as AxiosRequestConfig).silent
    return rejectWithEnvelope(payload, silent)
  },
  (error: AxiosError) => {
    const silent = (error.config as AxiosRequestConfig | undefined)?.silent

    // 1) 超时 / 网络层错误：另一套文案
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      if (!silent) toast.error(TIMEOUT_ERROR_TEXT)
      return Promise.reject(new ApiError(-1, TIMEOUT_ERROR_TEXT, undefined, error))
    }
    if (!error.response) {
      if (!silent) toast.error(NETWORK_ERROR_TEXT)
      return Promise.reject(new ApiError(-2, NETWORK_ERROR_TEXT, undefined, error))
    }

    // 2) 有响应：body 里仍然可能是信封（401/403/404/500）
    const body = error.response.data as unknown
    if (isEnvelope(body)) {
      try {
        rejectWithEnvelope(body, silent)
      } catch (apiError) {
        return Promise.reject(apiError)
      }
    }

    // 3) 连信封都没有：按 HTTP 状态码兜底
    const status = error.response.status
    const code = status === 401 ? ERROR_CODE.UNAUTHORIZED : ERROR_CODE.SERVER_ERROR
    const text = errorText(code)
    if (code === ERROR_CODE.UNAUTHORIZED) {
      authBridge.onUnauthorized()
    }
    if (!silent) toast.error(text)
    return Promise.reject(new ApiError(code, text, undefined, error))
  },
)

/** 解包后的请求助手：返回值已经是业务数据 */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  return (await client.request(config)) as unknown as T
}

export const get = <T>(url: string, config?: AxiosRequestConfig) =>
  request<T>({ ...config, url, method: 'GET' })

export const post = <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
  request<T>({ ...config, url, method: 'POST', data })

/** 后端目前只有 PUT /resume/mine 一处写操作使用 PUT */
export const put = <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
  request<T>({ ...config, url, method: 'PUT', data })

/*
 * 未提供 patch / del 助手：后端目前只有两条写操作不是 PUT ——
 * DELETE /chat/conversations/{id} 与 DELETE /task/{id}，两条而已，
 * 还没有多到值得抽助手。调用方直接用 client.delete(...)：
 * 见 api/chat.ts 的 chatApi.deleteConversation 与 api/task.ts 的 taskApi.remove。
 */
