/**
 * 奖章接口 —— 路径对齐后端 app/api/v1/badge.py（prefix="/badge"）
 *
 *   GET /badge   我的奖章概览（***对象***，不再是裸数组）
 *
 * 契约已冻结：data = { total, obtained_count, items: BadgeItem[] }，items 固定 3 项
 * （first_task / five_steps / profile_shape），顺序由后端定，前端不排序。
 * key 是稳定机器标识，只用来挑奖章美术；未知 key 必须有默认纹样兜底。
 *
 * 后端改造未落地时 data 仍是旧裸数组 —— 收口在 utils/badge.ts，
 * 调用方（ProfilePage）只认 BadgeOverview，不需要自己判形状。
 */

import { get } from '@/api/client'
import type { BadgeOverview } from '@/types'
import { normalizeBadgeOverview } from '@/utils/badge'

export const badgeApi = {
  /** GET /badge —— 任意后端形状都会被收口成完整的 BadgeOverview */
  list: async (): Promise<BadgeOverview> => normalizeBadgeOverview(await get<unknown>('/badge')),
}
