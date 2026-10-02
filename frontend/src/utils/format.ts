/**
 * 格式化工具
 *
 * ⚠️ **后端所有时间戳都是 naive UTC**（`app.models.user.utcnow()`），Pydantic 序列化
 * 出来形如 `"2026-09-25T16:04:45"` —— **既没有 `Z`，也没有时区偏移**。
 *
 * 而 JS 的 `new Date("2026-09-25T16:04:45")` 会把这串**按浏览器本地时区**解析，
 * 于是同一个时刻在界面上会错开一整个时区：
 * - UTC+8：解析出的时刻比真实值**早 8 小时** → 本地 0–8 点发生的事（凌晨答的题、
 *   凌晨拿到的奖章）日期显示成**前一天**；刚发生的事被说成「8 小时前」；
 * - 西半球（UTC-5 等）：解析出的时刻比真实值**晚** → `Date.now() - t` 是**负数**，
 *   新内容在最初几小时里一直显示「刚刚」。
 *
 * 收口规则只有一条，写在 `parseServerTime` 里：
 * **带时区信息（`Z` / `±HH:MM` / `±HHMM`）就按原样解析，不带时区就当 UTC 解析**。
 * 任何时间展示都必须走下面这几个格式化函数，**不要自己 `new Date(...)`**。
 */

/** 结尾自带时区：`Z` 或 `±HH:MM` / `±HHMM` */
const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i
/** 只有年月日（没有时刻，JS 规范里本身就是 UTC 零点，没有歧义） */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
/** 年月日 + 时刻（分隔符可能是 T，也可能是空格） */
const DATE_WITH_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

/**
 * 后端时间串 → Date（**唯一**的解析入口）。
 *
 * - 自带时区的原样解析 —— 因此**幂等**：已经被别的收口层补过 `Z` 的串不会变成 `…ZZ`；
 * - 只有年月日的原样解析；
 * - 年月日 + 时刻但没有时区的，补 `Z` 当 UTC 解析（后端 naive UTC 的正解）；
 * - 认不出来的返回 `null`，格式化函数一律显示 `—`。
 */
export function parseServerTime(value?: string | null): Date | null {
  const raw = (value ?? '').trim()
  if (!raw) return null

  const text =
    HAS_TIMEZONE.test(raw) || DATE_ONLY.test(raw)
      ? raw
      : DATE_WITH_TIME.test(raw)
        ? `${raw.replace(' ', 'T')}Z`
        : raw

  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value?: string | null): string {
  const date = parseServerTime(value)
  if (!date) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDateTime(value?: string | null): string {
  const date = parseServerTime(value)
  if (!date) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${formatDate(value)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 相对时间：对话列表、任务列表用 */
export function formatRelative(value?: string | null): string {
  const date = parseServerTime(value)
  if (!date) return '—'
  const diff = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  // 时钟轻微偏差时 diff 可能是个小负数，那同样是「刚刚」
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return formatDate(value)
}

export function formatPercent(value: number, total: number): string {
  if (!total) return '0%'
  return `${Math.round((value / total) * 100)}%`
}

/** 4.3：每条用户消息带前端生成的 client_msg_id（uuid），重试时复用 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}
