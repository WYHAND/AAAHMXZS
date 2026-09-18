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

export const useResumeStore = create<ResumeState>((set, get) => ({
  list: [],
  active: null,
  report: null,
  loading: false,

  async fetchList() {
    set({ loading: true })
    try {
      const list = normalizeList(await resumeApi.list())
      set({ list })
    } catch {
      set({ list: [] })
    } finally {
      set({ loading: false })
    }
  },

  async fetchDetail(id) {
    set({ loading: true })
    try {
      const resume = await resumeApi.detail(id)
      set({ active: resume ?? null })
    } catch {
      set({ active: null })
    } finally {
      set({ loading: false })
    }
  },

  async fetchReport(id) {
    set({ loading: true })
    try {
      const report = await resumeApi.report(id)
      set({ report: report ?? null })
    } catch {
      set({ report: null })
    } finally {
      set({ loading: false })
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

  reset() {
    set({ list: [], active: null, report: null })
  },
}))
