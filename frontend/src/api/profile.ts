/**
 * 画像接口 —— 路径对齐后端 app/api/v1/profile.py（prefix="/profile"）
 *
 * 后端 3 个端点：
 *   GET  /profile            画像主表 + 标签 + 基础资料 + tested
 *   GET  /profile/tags       标签（可按 dimension 过滤）
 *   POST /profile/feedback   标签反馈（**后端唯一的画像写端点**）
 *
 * ⚠️ POST /profile/feedback 前端已不再调用（2026-xx 起标签整块不给用户看，
 *    认可/否定入口一并移除）。后端端点保留，前端如需再启用参照上面路径。
 * ⚠️ 没有 PATCH /profile。设计说明书 5.4 提的 next_action 后端也没实现。
 */

import { get } from '@/api/client'
import type { ListPayload, Profile, ProfileTag } from '@/types'

export const profileApi = {
  get: () => get<Profile>('/profile'),

  /** 标签单独拉取（/profile 已内嵌 tags，此接口用于按维度筛选场景） */
  tags: (dimension?: string) =>
    get<ListPayload<ProfileTag>>('/profile/tags', {
      params: dimension ? { dimension } : undefined,
    }),
}
