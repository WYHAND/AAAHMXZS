import { create } from 'zustand'

import { profileApi } from '@/api/profile'
import { normalizeStage, type Stage } from '@/constants/stage'
import type { HomeNextAction, Profile, ProfileFeedbackPayload, ProfileTag } from '@/types'

/**
 * profileStore（设计说明书 4.1 / 4.2）
 *
 * **只有 profileStore.version 是全局失效信号**：
 * 任何写操作成功后（打卡 / 对话结束 / 简历解析 / 面试结束 / 每日一问）
 * 调用 bumpVersion()，首页与画像页 useEffect(..., [version]) 重新拉取。
 * 不持久化。
 *
 * ⚠️ 漏斗判据（Fix C）：
 * 后端 GET /profile 走 get_or_create_profile —— **永远 200 且返回画像对象**，
 * 所以「画像对象存在」不能代表「用户做过测评」。
 * 必须看后端 ProfileResponse.tested（依据 test_results 是否存在）。
 * 过渡兜底：tested 字段缺失时（老后端）退回「有标签即算测过」。
 */

export function hasFinishedTest(profile: Profile | null): boolean {
  if (!profile) return false
  // 过渡兜底：后端 tested 字段落地前的临时判据（有标签 ≈ 有测评结果）
  return profile.tested ?? (profile.tags?.length ?? 0) > 0
}

interface ProfileState {
  profile: Profile | null
  tags: ProfileTag[]
  stage: Stage
  /** 是否做过基础测试表（后端 tested） */
  tested: boolean
  /** 后端下发的下一步建议（来自 GET /home/summary，首页 CTA） */
  nextAction: HomeNextAction | null
  version: number
  loading: boolean
  fetched: boolean
  fetchProfile: () => Promise<void>
  /** 测评提交后本地先落地，避免守卫把用户弹回 /test/intro */
  setProfile: (profile: Partial<Profile> & { stage: string }) => void
  /** POST /profile/feedback 成功后刷新 */
  feedback: (payload: ProfileFeedbackPayload) => Promise<boolean>
  /** 首页聚合拉到的 next_action 缓存在这里，供 useStage 与顶栏共用 */
  setNextAction: (next: HomeNextAction | null) => void
  bumpVersion: () => void
  reset: () => void
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profile: null,
  tags: [],
  stage: normalizeStage(null),
  tested: false,
  nextAction: null,
  version: 0,
  loading: false,
  fetched: false,

  async fetchProfile() {
    set({ loading: true })
    try {
      const profile = await profileApi.get()
      set({
        profile: profile ?? null,
        tags: profile?.tags ?? [],
        stage: normalizeStage(profile?.stage),
        tested: hasFinishedTest(profile ?? null),
        fetched: true,
      })
    } catch {
      // 拉不到：未登录（守卫处理）或网络失败。保持已有数据，不白屏。
      set({ fetched: true })
    } finally {
      set({ loading: false })
    }
  },

  /** 4.2 全局失效信号 */
  bumpVersion() {
    set((state) => ({ version: state.version + 1 }))
  },

  /** 测评提交后本地先落地：必须置 tested: true，否则守卫会把用户弹回 /test/intro */
  setProfile(next) {
    const tags = next.tags ?? []
    set({
      profile: {
        id: next.id ?? '',
        user_id: next.user_id ?? '',
        clarity_score: next.clarity_score ?? 0,
        action_score: next.action_score ?? 0,
        resume_score: next.resume_score ?? 0,
        total_score: next.total_score ?? 0,
        stage: next.stage,
        updated_at: next.updated_at ?? new Date().toISOString(),
        tested: true,
        tags,
        user: next.user ?? null,
      },
      tags,
      stage: normalizeStage(next.stage),
      tested: true,
      fetched: true,
    })
  },

  async feedback(payload) {
    try {
      const profile = await profileApi.feedback(payload)
      set({
        profile: profile ?? null,
        tags: profile?.tags ?? [],
        stage: normalizeStage(profile?.stage),
        tested: hasFinishedTest(profile ?? null),
      })
      get().bumpVersion()
      return true
    } catch {
      return false
    }
  },

  /** 首页聚合拉到的 next_action 缓存在这里，供 useStage 与顶栏共用 */
  setNextAction(next) {
    set({ nextAction: next })
  },

  reset() {
    set({
      profile: null,
      tags: [],
      stage: normalizeStage(null),
      tested: false,
      nextAction: null,
      fetched: false,
    })
  },
}))
