/**
 * 成长报告接口 —— 路径对齐后端 app/api/v1/report.py（prefix="/report"）
 *
 *   GET /report?refresh=false   成长报告（ReportResponse，内容在 content 里）
 *
 * ⚠️ 后端路径是 GET /report，**不是** /report/growth。
 */

import { get } from '@/api/client'
import type { GrowthReport } from '@/types'

export const reportApi = {
  /** refresh=true 让后端重新计算并生成一份新报告 */
  growth: (params?: { refresh?: boolean }) => get<GrowthReport>('/report', { params }),
}
