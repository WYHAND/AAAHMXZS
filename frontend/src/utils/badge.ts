/**
 * 奖章响应收口
 *
 * 后端契约（已冻结）：GET /badge 的 data 是 **BadgeOverview 对象**
 *   { total, obtained_count, items: BadgeItem[] }
 *
 * 但后端改造可能比前端晚落地，那时 data 还是**旧的裸数组**
 * （{ id, badge_id, name, condition, obtained_at }[]）。
 * 这里按 api/report.ts 的 normalizeReport 先例做宽容收口：
 * 两种形状都认，字段缺失一律兜底 —— 页面永远拿到一个完整的 BadgeOverview，
 * 不会白屏、不会因为少一个字段整页报错。
 *
 * 纪律：
 * - `items` 顺序**完全沿用后端**（门槛从低到高），这里不排序、不截断、不补位。
 * - 前缀 `__` 是给「旧形状 / 未知奖章」用的内部占位 key，
 *   只为让美术层选不到纹样时落到默认纹样，不是业务语义。
 */

import type { BadgeItem, BadgeOverview } from '@/types'

/** 旧裸数组里的一条（只读这几个字段，其余忽略） */
interface LegacyBadgeLike {
  key?: unknown
  name?: unknown
  description?: unknown
  hint?: unknown
  badge_id?: unknown
  condition?: unknown
  obtained?: unknown
  obtained_at?: unknown
  progress?: unknown
  current?: unknown
  target?: unknown
}

const EMPTY_OVERVIEW: BadgeOverview = { total: 0, obtained_count: 0, items: [] }

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function toCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

/** 进度夹取：current ∈ [0, target]，target 至少 1（避免除零和空进度环） */
function normalizeProgress(raw: unknown, obtained: boolean): { current: number; target: number } {
  const source = (raw ?? {}) as { current?: unknown; target?: unknown }
  const target = Math.max(1, Math.floor(toCount(source.target) ?? 1))
  const fallbackCurrent = obtained ? target : 0
  const currentRaw = toCount(source.current) ?? fallbackCurrent
  const current = Math.min(target, Math.max(0, Math.floor(currentRaw)))
  return { current, target }
}

/** 旧条件字典里尽力抠一个「1 / 1」出来；抠不到就当 0 / 1（即「还没拿到」） */
function progressFromCondition(condition: unknown, obtained: boolean): { current: number; target: number } {
  const bag = (condition ?? {}) as Record<string, unknown>
  const target = toCount(bag.target ?? bag.count ?? bag.steps)
  const current = toCount(bag.current ?? bag.done ?? bag.progress)
  if (target === null && current === null) {
    return { current: obtained ? 1 : 0, target: 1 }
  }
  return normalizeProgress({ target: target ?? 1, current }, obtained)
}

/** 旧形状（裸数组元素）→ BadgeItem */
function fromLegacy(item: LegacyBadgeLike, index: number): BadgeItem {
  const name = toStringOrNull(item.name) ?? toStringOrNull(item.badge_id) ?? '未命名奖章'
  const obtainedAt = toStringOrNull(item.obtained_at)
  const obtained = item.obtained === true || Boolean(obtainedAt)
  const key =
    toStringOrNull(item.key) ??
    toStringOrNull(item.badge_id) ??
    `__legacy_${index}`
  const progress =
    item.progress !== undefined
      ? normalizeProgress(item.progress, obtained)
      : progressFromCondition(item.condition, obtained)

  return {
    key,
    name,
    description: toStringOrNull(item.description) ?? '这枚奖章已经在你的收藏里。',
    hint: obtained ? '已经拿到手了，留着它。' : '继续做任务，这枚就快到手了。',
    obtained,
    obtained_at: obtainedAt,
    progress,
  }
}

/** 新形状（BadgeItem）→ 保证每个字段都存在且类型正确 */
function fromOverviewItem(item: LegacyBadgeLike, index: number): BadgeItem {
  const obtainedAt = toStringOrNull(item.obtained_at)
  const obtained = item.obtained === true
  return {
    key: toStringOrNull(item.key) ?? toStringOrNull(item.badge_id) ?? `__item_${index}`,
    name: toStringOrNull(item.name) ?? '未命名奖章',
    description: toStringOrNull(item.description) ?? '',
    hint: toStringOrNull(item.hint) ?? '',
    obtained,
    obtained_at: obtainedAt,
    progress: normalizeProgress(item.progress, obtained),
  }
}

/**
 * 任意后端形状 → 完整 BadgeOverview。
 * 同时导出给 api/badge.ts 用（页面不直接调它）。
 */
export function normalizeBadgeOverview(raw: unknown): BadgeOverview {
  if (raw === null || raw === undefined) return EMPTY_OVERVIEW

  // ① 旧形状：裸数组
  if (Array.isArray(raw)) {
    if (!raw.length) return EMPTY_OVERVIEW
    const items = raw.map((item, index) => fromLegacy((item ?? {}) as LegacyBadgeLike, index))
    return {
      total: items.length,
      obtained_count: items.filter((item) => item.obtained).length,
      items,
    }
  }

  if (typeof raw !== 'object') return EMPTY_OVERVIEW

  // ② 新形状：BadgeOverview；缺 items 时再退一步看有没有 data/items 包了一层
  const bag = raw as Record<string, unknown>
  const rawItems = Array.isArray(bag.items)
    ? bag.items
    : Array.isArray(bag.data)
      ? bag.data
      : null

  if (!rawItems) return EMPTY_OVERVIEW

  const items = rawItems.map((item, index) => fromOverviewItem((item ?? {}) as LegacyBadgeLike, index))

  return {
    total: toCount(bag.total) ?? items.length,
    obtained_count: toCount(bag.obtained_count) ?? items.filter((item) => item.obtained).length,
    items,
  }
}

/** 还差几步：至少 0，用于「还差 N 个步骤」 */
export function remainingSteps(progress: { current: number; target: number }): number {
  return Math.max(0, progress.target - progress.current)
}
