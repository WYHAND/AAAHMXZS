import { create } from 'zustand'

import { resumeApi } from '@/api/resume'
import { useProfileStore } from '@/store/profileStore'
import type { Resume, ResumeReport, ResumeUpdatePayload } from '@/types'
import { normalizeList } from '@/utils/list'

/**
 * resumeStore（设计说明书 4.1）
 *
 * upload / optimize / save 成功后 profileStore.bumpVersion()（4.2）。不持久化。
 * 列表走 normalizeList（后端 GET /resume 返回裸数组）。
 *
 * 四个简历页面（列表 / 新建 / 编辑 / 报告）都通过本 store 读写，
 * 页面不再各自持有重复的加载逻辑。
 */

interface ResumeState {
  list: Resume[]
  active: Resume | null
  report: ResumeReport | null
  loading: boolean

  fetchList: () => Promise<void>
  fetchDetail: (id: string) => Promise<void>
  fetchReport: (id: string) => Promise<void>
  upload: (file: File) => Promise<boolean>
  optimize: (id: string) => Promise<boolean>
  save: (id: string, payload: ResumeUpdatePayload) => Promise<boolean>
  setActive: (resume: Resume | null) => void
  /** 报告页「忽略建议」等纯前端标记用 */
  clearReport: () => void
  reset: () => void
}

/**
 * 换号世代：`reset()` 每跑一次 +1（登出 / 登录 / 注册都会走到）。
 * 它挡的是"迟到的响应"：上一个账号在途的 fetchList/fetchDetail/fetchReport
 * 回来时会把**别人的简历/报告**写进新账号的内存。发请求前记下世代、落地前比一次即可。
 */
let fetchGeneration = 0

export const useResumeStore = create<ResumeState>((set, get) => ({
  list: [],
  active: null,
  report: null,
  loading: false,

  async fetchList() {
    const generation = fetchGeneration
    set({ loading: true })
    try {
      const list = normalizeList(await resumeApi.list())
      if (generation !== fetchGeneration) return
      set({ list })
    } catch {
      if (generation !== fetchGeneration) return
      set({ list: [] })
    } finally {
      if (generation === fetchGeneration) set({ loading: false })
    }
  },

  async fetchDetail(id) {
    const generation = fetchGeneration
    set({ loading: true })
    try {
      const resume = await resumeApi.detail(id)
      if (generation !== fetchGeneration) return
      set({ active: resume ?? null })
    } catch {
      if (generation !== fetchGeneration) return
      set({ active: null })
    } finally {
      if (generation === fetchGeneration) set({ loading: false })
    }
  },

  async fetchReport(id) {
    const generation = fetchGeneration
    set({ loading: true })
    try {
      const report = await resumeApi.report(id)
      if (generation !== fetchGeneration) return
      set({ report: report ?? null })
    } catch {
      if (generation !== fetchGeneration) return
      set({ report: null })
    } finally {
      if (generation === fetchGeneration) set({ loading: false })
    }
  },

  async upload(file) {
    try {
      const resume = await resumeApi.upload(file)
      if (resume) set((state) => ({ list: [resume, ...state.list] }))
      useProfileStore.getState().bumpVersion()
      return true
    } catch {
      return false
    }
  },

  async optimize(id) {
    try {
      const report = await resumeApi.optimize(id)
      set({ report: report ?? null })
      useProfileStore.getState().bumpVersion()
      void get().fetchList()
      return true
    } catch {
      return false
    }
  },

  async save(id, payload) {
    try {
      const resume = await resumeApi.save(id, payload)
      set({ active: resume ?? null })
      useProfileStore.getState().bumpVersion()
      return true
    } catch {
      return false
    }
  },

  setActive(resume) {
    set({ active: resume })
  },

  clearReport() {
    set({ report: null })
  },

  /**
   * 换号时必须调（见 store/reset.ts）。
   * 清掉：简历列表 list、当前选中的简历 active（含详情）、诊断报告 report、
   * loading 标志。三份都是按 user_id 存在后端、按账号拉回来的数据，
   * 跨账号留着会让新账号第一眼看到别人的简历。
   */
  reset() {
    // 世代 +1：上一个账号在途的 fetchList/fetchDetail/fetchReport 回来时会被丢掉
    fetchGeneration += 1
    set({ list: [], active: null, report: null, loading: false })
  },
}))
