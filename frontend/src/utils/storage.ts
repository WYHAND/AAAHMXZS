/** 本地存储封装：只允许在明确需要时读写，避免散落的 localStorage 调用 */

const PREFIX = 'ai_job_helper:'

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = window.localStorage.getItem(PREFIX + key)
      if (raw === null) return fallback
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      /* 隐私模式下写入失败，忽略 */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(PREFIX + key)
    } catch {
      /* ignore */
    }
  },
  /** sessionStorage：仅用于测试答题进度（3.2 ④） */
  session: {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = window.sessionStorage.getItem(PREFIX + key)
        if (raw === null) return fallback
        return JSON.parse(raw) as T
      } catch {
        return fallback
      }
    },
    set(key: string, value: unknown): void {
      try {
        window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
      } catch {
        /* ignore */
      }
    },
    remove(key: string): void {
      try {
        window.sessionStorage.removeItem(PREFIX + key)
      } catch {
        /* ignore */
      }
    },
  },
}

export const STORAGE_KEY = {
  token: 'token',
  testProgress: 'test_progress',
  interviewId: 'interview_id',
  conversationId: 'conversation_id',
} as const
