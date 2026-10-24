/**
 * 评委自填 API Key（只存在本机浏览器，不写入代码/仓库/数据库）。
 *
 * 用途：
 * - DeepSeek Key：AI 对话、任务生成、简历润色、面试出题与复盘；
 * - 百炼 DashScope Key：面试语音（ASR/TTS）。
 *
 * 请求时通过 `X-DeepSeek-Key` / `X-DashScope-Key` 发给**本机后端**，
 * 后端只在当前请求里使用，不落库、不写日志。
 */

export interface ApiKeys {
  deepseek: string
  dashscope: string
}

const STORAGE_DEEPSEEK = 'ai_career.deepseek_key'
const STORAGE_DASHSCOPE = 'ai_career.dashscope_key'

function read(key: string): string {
  try {
    return (localStorage.getItem(key) ?? '').trim()
  } catch {
    return ''
  }
}

function write(key: string, value: string): void {
  try {
    if (value.trim()) localStorage.setItem(key, value.trim())
    else localStorage.removeItem(key)
  } catch {
    /* 浏览器禁用 storage 时静默失败：本次会话仍可通过内存使用 */
  }
}

export function loadApiKeys(): ApiKeys {
  return {
    deepseek: read(STORAGE_DEEPSEEK),
    dashscope: read(STORAGE_DASHSCOPE),
  }
}

export function saveApiKeys(keys: ApiKeys): void {
  write(STORAGE_DEEPSEEK, keys.deepseek)
  write(STORAGE_DASHSCOPE, keys.dashscope)
}

export function clearApiKeys(): void {
  write(STORAGE_DEEPSEEK, '')
  write(STORAGE_DASHSCOPE, '')
}

/** 只返回已填写的 Key，未填时不带这个头（后端回落到 .env/兜底）。 */
export function getApiKeyHeaders(): Record<string, string> {
  const keys = loadApiKeys()
  const headers: Record<string, string> = {}
  if (keys.deepseek) headers['X-DeepSeek-Key'] = keys.deepseek
  if (keys.dashscope) headers['X-DashScope-Key'] = keys.dashscope
  return headers
}

/** 脱敏展示：只露前 4 位和后 4 位，避免设置页整串显示。 */
export function maskKey(value: string): string {
  const text = value.trim()
  if (!text) return '未填写'
  if (text.length <= 10) return '已填写'
  return `${text.slice(0, 4)}…${text.slice(-4)}`
}
