/**
 * 错误码与中文文案映射（设计说明书 5.1，来源手册 10.3）
 * code = 0 仍然表示成功；非 0 一律走这里的文案。
 */

export const ERROR_CODE = {
  OK: 0,
  BAD_REQUEST: 1001,
  UNAUTHORIZED: 1002,
  FORBIDDEN: 1003,
  NOT_FOUND: 2001,
  AI_BUSY: 3001,
  SERVER_ERROR: 5000,
} as const

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE]

export const ERROR_TEXT: Record<number, string> = {
  [ERROR_CODE.OK]: '成功',
  [ERROR_CODE.BAD_REQUEST]: '参数有误',
  [ERROR_CODE.UNAUTHORIZED]: '登录已过期，请重新登录',
  [ERROR_CODE.FORBIDDEN]: '没有权限',
  [ERROR_CODE.NOT_FOUND]: '内容不存在',
  [ERROR_CODE.AI_BUSY]: 'AI 暂时忙不过来，请稍后再试',
  [ERROR_CODE.SERVER_ERROR]: '服务器开小差了',
}

export const NETWORK_ERROR_TEXT = '网络连接失败，请检查网络后重试'
export const TIMEOUT_ERROR_TEXT = '请求超时，请稍后再试'
export const UNKNOWN_ERROR_TEXT = '出了点问题，请稍后再试'

/** 取错误码文案，未知码回落到后端 message */
export function errorText(code: number, fallback?: string): string {
  return ERROR_TEXT[code] ?? fallback ?? UNKNOWN_ERROR_TEXT
}
