/**
 * 首页聚合接口 —— 对齐后端 app/api/v1/home.py（prefix="/home"）
 *
 *   GET /home/summary   一次拿全首页四个模块 + 后端决定的下一步建议
 *
 * ⚠️ 这是后端**后补实现**的模块（手册 10.2 未列，见 backend/app/api/router.py 注释）。
 * 早期骨架版本里前端曾用 Promise.allSettled 自行组合 4 个请求；现在接口已存在，
 * 改回一次请求，且 next_action 由后端下发（前端不做推荐逻辑，符合设计说明书 5.4）。
 */

import { get } from '@/api/client'
import type { HomeSummary } from '@/types'

export const homeApi = {
  summary: () => get<HomeSummary>('/home/summary'),
}
