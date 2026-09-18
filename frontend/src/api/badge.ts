/**
 * 奖章接口 —— 路径对齐后端 app/api/v1/badge.py（prefix="/badge"）
 *
 *   GET /badge   我的奖章（裸数组；MVP 只有「起步行动家」一枚）
 */

import { get } from '@/api/client'
import type { ListPayload, UserBadge } from '@/types'

export const badgeApi = {
  /** 列表返回裸数组，调用方用 normalizeList 收口（Fix B） */
  list: () => get<ListPayload<UserBadge>>('/badge'),
}
