/**
 * 每日一问接口 —— 路径对齐后端 app/api/v1/daily_question.py（prefix="/daily"）
 *
 *   GET  /daily/today     今日问题 + answered + answer + streak
 *   POST /daily/answer    回答（body: question_id + answer，**answer 上限 200 字**）
 *   GET  /daily/history   我答过的每日一问（后端已按 answered_at 倒序，服务端硬上限 100 条）
 *
 * `history` 的收口在本文件里做（先例：api/report.ts 的 normalizeReport）：
 * 后端这个端点可能比前端晚落地（404 / 旧裸数组 / null / 垃圾），一律降级成空历史，
 * 页面永远拿到一个完整的 DailyHistory —— 不白屏、不弹错，也不影响「今天的问题」。
 */

import { get, post } from '@/api/client'
import type {
  DailyAnswerPayload,
  DailyAnswerResponse,
  DailyHistory,
  DailyHistoryItem,
  TodayQuestion,
} from '@/types'
import { parseServerTime } from '@/utils/format'

/** 空历史 / 形状不认识时的兜底 */
const EMPTY_HISTORY: DailyHistory = { total: 0, items: [] }

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/**
 * 时间戳统一成**带 Z 的 UTC ISO**。
 *
 * 后端的 datetime 是 naive UTC（app/models/user.utcnow()），序列化出来没有时区；
 * 解析规则（不带时区就当 UTC）收口在 utils/format 的 parseServerTime 里，这里只
 * 把结果固化成 ISO —— 页面用 formatDate 展示，别的调用方拿去做比较/排序也是对的。
 * 解析不出来（垃圾值）给空串，页面会显示 `—`。
 */
function toUtcIso(value: unknown): string {
  return parseServerTime(toText(value))?.toISOString() ?? ''
}

/** 任意一条 → DailyHistoryItem；字段缺失/类型不对一律兜底（绝不把 undefined 漏进页面） */
function toHistoryItem(raw: unknown): DailyHistoryItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const bag = raw as Record<string, unknown>
  return {
    id: toText(bag.id) ?? '',
    question_id: toText(bag.question_id) ?? '',
    content: toText(bag.content) ?? '',
    dimension: toText(bag.dimension),
    answer: toText(bag.answer) ?? '',
    answered_at: toUtcIso(bag.answered_at),
  }
}

/**
 * 任意后端形状 → 完整 DailyHistory（页面只认它）。
 *
 * - 旧形状：裸数组（后端改造未落地时）也认；
 * - `null` / 字符串 / 没有 items 的对象 → 空历史；
 * - ⚠️ items 的**顺序完全沿用后端**（answered_at 倒序）：不排序、不截断、不翻页。
 */
export function normalizeDailyHistory(raw: unknown): DailyHistory {
  if (raw === null || raw === undefined) return EMPTY_HISTORY

  const bag = (typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawItems: unknown[] | null = Array.isArray(raw)
    ? raw
    : Array.isArray(bag.items)
      ? bag.items
      : null
  if (!rawItems) return EMPTY_HISTORY

  const items = rawItems
    .map(toHistoryItem)
    .filter((item): item is DailyHistoryItem => item !== null)

  const total =
    typeof bag.total === 'number' && Number.isFinite(bag.total) ? bag.total : items.length
  // total 是「答过的真实总条数」，不该小于实际给出的条数（缺字段时用条数兜底）
  return { total: Math.max(total, items.length), items }
}

export const dailyApi = {
  today: () => get<TodayQuestion>('/daily/today'),
  answer: (payload: DailyAnswerPayload) =>
    post<DailyAnswerResponse>('/daily/answer', payload),
  /**
   * GET /daily/history —— 任意后端形状都会被收口成完整的 DailyHistory。
   *
   * 走 `silent`：这个端点可能还没上线，不该在页面右上角弹一个红色报错；
   * 失败文案由历史区就地给（也不影响上面那道今日问题）。401 的登出处理不受影响。
   */
  history: async (): Promise<DailyHistory> =>
    normalizeDailyHistory(await get<unknown>('/daily/history', { silent: true })),
}
