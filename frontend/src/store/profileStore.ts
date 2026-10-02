import { create } from 'zustand'

import { profileApi } from '@/api/profile'
import { normalizeStage, type Stage } from '@/constants/stage'
import type { HomeNextAction, Profile, ProfileTag } from '@/types'

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

/**
 * 换号世代：`reset()` 每跑一次 +1（登出 / 登录 / 注册都会走到）。
 *
 * 它挡的是"迟到的画像响应"：token 换了之后，上一个账号的 fetchProfile
 * 可能还挂在网络上，回来时会 set 一份**别人的画像**。这不是显示问题 ——
 * fetched / tested 是路由守卫的分流依据（未测评 → 强制 30 题），
 * 写错就是把老用户推进测评，正好是之前修过的那个 bug。
 */
let fetchGeneration = 0

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
  /**
   * 画像拉取**失败**（网络/后端没起来/超时）。
   *
   * ⚠️ 必须与「用户没做过测评」严格区分：
   * 曾经把失败也写成 `fetched: true`，结果 `tested` 保持默认 false，
   * 守卫就把「请求失败」误判成「未测评」——重启后端那几秒内加载过页面，
   * 再重新登录，老用户会被直接推进 30 题测评。
   * 现在失败只置 `failed`，`fetched` 保持 false，由守卫给出「重试」。
   */
  failed: boolean
  fetchProfile: () => Promise<void>
  /** 测评提交后本地先落地，避免守卫把用户弹回 /test/intro */
  setProfile: (profile: Partial<Profile> & { stage: string }) => void
  /** 首页聚合拉到的 next_action 缓存在这里，供 useStage 与顶栏共用 */
  setNextAction: (next: HomeNextAction | null) => void
  bumpVersion: () => void
  reset: () => void
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  tags: [],
  stage: normalizeStage(null),
  tested: false,
  nextAction: null,
  version: 0,
  loading: false,
  fetched: false,
  failed: false,

  async fetchProfile() {
    // 记下"发请求时"的换号世代：迟到的响应会把**别人的画像**写进来
    const generation = fetchGeneration
    set({ loading: true, failed: false })
    try {
      const profile = await profileApi.get()
      // 期间换过号 → 这份画像属于上一个账号，丢弃（见 fetchGeneration）
      if (generation !== fetchGeneration) return
      set({
        profile: profile ?? null,
        tags: profile?.tags ?? [],
        stage: normalizeStage(profile?.stage),
        tested: hasFinishedTest(profile ?? null),
        fetched: true,
        failed: false,
      })
    } catch {
      // 换过号了：这次失败是上一个账号的失败，不要写进新账号的状态
      if (generation !== fetchGeneration) return
      // ⚠️ 这里**只**标记失败，绝不 set({ fetched: true })。
      // fetched 的语义是"成功拿到过画像"；把失败也置 true，
      // 会让守卫把「网络失败」当成「用户未测评」→ 老用户被赶去做 30 题。
      // 保持 fetched=false 也让 RequireAuth 的自动重试不会误判为已完成。
      set({ failed: true })
    } finally {
      // 换过号了：这份 loading 属于上一次请求，别去动新账号的加载态
      if (generation === fetchGeneration) set({ loading: false })
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

  /** 首页聚合拉到的 next_action 缓存在这里，供 useStage 与顶栏共用 */
  setNextAction(next) {
    set({ nextAction: next })
  },

  reset() {
    /*
     * 换号世代 +1：上一个账号在途的 fetchProfile 回来时必须被丢掉。
     * 否则「旧画像的迟到响应」会盖在新账号头上 —— fetched/tested 都是
     * 路由守卫的分流依据，写错就是把新账号当成老账号（或反过来）。
     * version 有意**不**重置：它是单调递增的全局失效信号，与账号无关。
     */
    fetchGeneration += 1
    set({
      profile: null,
      tags: [],
      stage: normalizeStage(null),
      tested: false,
      nextAction: null,
      fetched: false,
      failed: false,
      // loading 同样是按用户的：别让上一个账号在途的请求把新账号卡在加载态
      loading: false,
    })
  },
}))
