/**
 * 列表响应收口（Fix B）
 *
 * 后端所有列表端点的 `data` 都是**裸数组**（`ApiResponse[List[X]]`）。
 * 后端虽然定义了 `PageData`（core/api_response.py），但一处都没用。
 * 为了不依赖后端未来是否改成分页体，前端统一走这里：
 * 数组直接返回，分页体取 items，null/undefined 返回空数组。
 */

import type { ListPayload } from '@/types'

export function normalizeList<T>(payload: ListPayload<T> | null | undefined): T[] {
  if (!payload) return []
  return Array.isArray(payload) ? payload : (payload.items ?? [])
}
