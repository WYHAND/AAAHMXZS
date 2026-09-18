/**
 * 画像接口 —— 路径对齐后端 app/api/v1/profile.py（prefix="/profile"）
 *
 * 后端 3 个端点：
 *   GET  /profile            画像主表 + 标签 + 基础资料 + tested
 *   GET  /profile/tags       标签（可按 dimension 过滤）
 *   POST /profile/feedback   标签反馈（**后端唯一的画像写端点**）
 *
 * ⚠️ 没有 PATCH /profile。设计说明书 5.4 提的 next_action 后端也没实现。
 */

import { get, post } from '@/api/client'
import type { ListPayload, Profile, ProfileFeedbackPayload, ProfileTag } from '@/types'

export const profileApi = {
  get: () => get<Profile>('/profile'),

  /** 标签单独拉取（/profile 已内嵌 tags，此接口用于按维度筛选场景） */
  tags: (dimension?: string) =>
    get<ListPayload<ProfileTag>>('/profile/tags', {
      params: dimension ? { dimension } : undefined,
    }),

  /** 用户对标签认可/否定；后端会调权重并重算阶段 */
  feedback: (payload: ProfileFeedbackPayload) => post<Profile>('/profile/feedback', payload),
}
