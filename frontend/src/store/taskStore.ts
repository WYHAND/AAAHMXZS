import { create } from 'zustand'

import { taskApi } from '@/api/task'
import { useProfileStore } from '@/store/profileStore'
import type { Task, TaskDetail, TaskStep } from '@/types'
import { normalizeList } from '@/utils/list'
import { track } from '@/utils/track'

/**
 * taskStore（设计说明书 4.1）
 * completeStep / abandon 成功后必须 profileStore.bumpVersion()（4.2）。
 * 不持久化。
 *
 * 后端 task 形状（schemas/task.py）：status 是中文（进行中/已完成/已放弃），
 * progress 是 0-1 的比例（不是 done/total 计数），步骤用 completed: boolean。
 */

/** 进行中任务的状态值（后端 status 是中文） */
export const ONGOING_STATUS = '进行中'

interface TaskState {
  tasks: Task[]
  activeTask: TaskDetail | null
  steps: TaskStep[]
  loading: boolean
  error: string | null

  fetchTasks: () => Promise<void>
  fetchTask: (id: string) => Promise<void>
  setActiveTask: (task: TaskDetail | null) => void
  generate: (painPoint?: string) => Promise<TaskDetail | null>
  /** feedback 由「花了多久 / 卡在哪」两栏拼成（后端只有一个 feedback 字段） */
  completeStep: (taskId: string, stepId: string, feedback: string) => Promise<boolean>
  abandon: (taskId: string, reason: string) => Promise<boolean>
  reset: () => void
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  activeTask: null,
  steps: [],
  loading: false,
  error: null,

  async fetchTasks() {
    set({ loading: true, error: null })
    try {
      const list = normalizeList(await taskApi.list())
      set({ tasks: list })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '任务加载失败' })
    } finally {
      set({ loading: false })
    }
  },

  async fetchTask(id) {
    set({ loading: true, error: null })
    try {
      const task = await taskApi.detail(id)
      set({ activeTask: task ?? null, steps: task?.steps ?? [] })
    } catch (error) {
      set({
        activeTask: null,
        steps: [],
        error: error instanceof Error ? error.message : '任务加载失败',
      })
    } finally {
      set({ loading: false })
    }
  },

  setActiveTask(task) {
    set({ activeTask: task, steps: task?.steps ?? [] })
  },

  async generate(painPoint) {
    try {
      const task = await taskApi.generate({ pain_point: painPoint ?? null })
      if (!task) return null
      set((state) => ({
        activeTask: task,
        steps: task.steps ?? [],
        tasks: [task, ...state.tasks],
      }))
      return task
    } catch {
      return null
    }
  },

  async completeStep(taskId, stepId, feedback) {
    try {
      const task = await taskApi.completeStep(taskId, stepId, {
        feedback: feedback || null,
      })
      set({ activeTask: task ?? null, steps: task?.steps ?? [] })
      // 4.2 全局失效信号：打卡会改变画像
      useProfileStore.getState().bumpVersion()
      // 同步更新列表里的进度
      set((state) => ({
        tasks: state.tasks.map((t) => (task && t.id === task.id ? { ...t, ...task } : t)),
      }))
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '打卡失败，请稍后再试' })
      return false
    }
  },

  async abandon(taskId, reason) {
    // 后端 POST /task/{id}/abandon 不接受 body —— 原因只作为本地埋点信号
    track('task_abandon', { task_id: taskId, reason })
    try {
      const task = await taskApi.abandon(taskId)
      set((state) => ({
        activeTask: state.activeTask ? { ...state.activeTask, ...task } : state.activeTask,
        tasks: state.tasks.map((t) => (task && t.id === task.id ? task : t)),
      }))
      useProfileStore.getState().bumpVersion()
      void get().fetchTasks()
      return true
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '操作失败，请稍后再试' })
      return false
    }
  },

  reset() {
    set({ tasks: [], activeTask: null, steps: [], error: null })
  },
}))

/** 后端 progress 是 0-1 的比例，这里转成百分比整数 */
export function taskProgress(task: Task): number {
  const ratio = typeof task.progress === 'number' ? task.progress : 0
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100)
}
