/**
 * 成长报告接口 —— 路径对齐后端 app/api/v1/report.py（prefix="/report"）
 *
 *   GET  /report        每次**实时计算**（不再读数据库快照、不再每次刷新落一份新报告）
 *   POST /report/save   把当前状态 + 「我的补充」存成一份**里程碑**，成为下次对比的基线
 *
 * ⚠️ 后端路径是 GET /report，**不是** /report/growth（旧的 refresh 查询参数已废弃）。
 * ⚠️ 两个接口返回**同一个扁平结构**（GrowthReportData），不再包在 ReportResponse.content 里。
 */

import { get, post } from '@/api/client'
import type {
  GrowthReport,
  GrowthReportContent,
  GrowthReportData,
  ReportSavePayload,
  ReportSuggestion,
} from '@/types'

/** 后端可能返回新扁平结构，也可能（改造未上线时）返回旧的 { content } 包装 */
type ReportPayload = GrowthReportData | GrowthReport

/**
 * 收口两种形状 → 页面只认 GrowthReportData。
 *
 * 这里刻意做得宽容：后端接口由另一个 agent 同步改造，改造完成前旧形状也不该让页面崩掉。
 */
export function normalizeReport(raw: ReportPayload | null | undefined): GrowthReportData | null {
  if (!raw) return null

  const legacy = raw as GrowthReport
  const source: Partial<GrowthReportContent> = legacy.content ?? (raw as GrowthReportData)
  const createdAt = typeof legacy.created_at === 'string' ? legacy.created_at : null

  // 旧版 suggestions 是 string[]，新版是 { text, pain_point }[]
  const suggestions: ReportSuggestion[] = (source.suggestions ?? [])
    .map((item) =>
      typeof item === 'string' ? { text: item, pain_point: null } : item,
    )
    .filter((item): item is ReportSuggestion => Boolean(item?.text))

  const lastSavedAt = source.last_saved_at ?? createdAt ?? null

  return {
    stage: source.stage ?? 'explore',
    stage_label: source.stage_label ?? null,
    stage_changed: Boolean(source.stage_changed),
    clarity_score: source.clarity_score ?? 0,
    action_score: source.action_score ?? 0,
    resume_score: source.resume_score ?? 0,
    total_score: source.total_score ?? 0,
    score_delta: source.score_delta ?? {},
    completed_tasks: source.completed_tasks ?? 0,
    completed_steps: source.completed_steps ?? 0,
    active_days: source.active_days ?? 0,
    highlights: source.highlights ?? [],
    suggestions,
    last_saved_at: lastSavedAt,
    user_note: source.user_note ?? '',
    // 旧接口没有 saved：有 created_at 就说明存过一份
    saved: source.saved ?? Boolean(lastSavedAt),
  }
}

export const reportApi = {
  /** GET /report —— 打开页面就是最新数据 */
  current: async (): Promise<GrowthReportData | null> =>
    normalizeReport(await get<ReportPayload>('/report')),

  /** POST /report/save —— 存里程碑（body 只有可选的 user_note，最多 500 字） */
  save: async (payload: ReportSavePayload): Promise<GrowthReportData | null> =>
    normalizeReport(await post<ReportPayload>('/report/save', payload)),
}
