import { create } from 'zustand'

import { taskApi } from '@/api/task'
import { useProfileStore } from '@/store/profileStore'
import type {
  Task,
  TaskDeleteResponse,
  TaskDetail,
  TaskGenerateResponse,
  TaskStep,
} from '@/types'
import { normalizeList } from '@/utils/list'
import { track } from '@/utils/track'

/**
 * taskStore（设计说明书 4.1）
 * completeStep / abandon / remove 成功后必须 profileStore.bumpVersion()（4.2）。
 * 不持久化。
 *
 * 后端 task 形状（schemas/task.py）：status 是中文（进行中/已完成/已放弃），
 * progress 是 0-1 的比例（不是 done/total 计数），步骤用 completed: boolean。
 */

/** 进行中任务的状态值（后端 status 是中文） */
export const ONGOING_STATUS = '进行中'

/** 已完成 / 已放弃：这两个状态不该看起来和「进行中」一样重要（列表里视觉更淡、排后面） */
export const DONE_STATUS = '已完成'
export const ABANDONED_STATUS = '已放弃'

/**
 * 列表展示顺序：进行中在前，然后是已完成，最后是已放弃；同组内按创建时间倒序。
 *
 * 为什么在前端排而不是靠后端：后端 `GET /task` 是**单一** `created_at desc` 的
 * 通用列表（首页、报告页也用它），把"按状态分组"塞进后端会改变所有调用方的语义；
 * 而"用户打开任务列表最想先看到还在做的事"是列表页自己的展示需求。
 * 排序是**稳定**的：只比较这两个键，同状态的相对顺序与后端返回一致。
 */
export function sortTasksForDisplay(tasks: Task[]): Task[] {
  const priority = (status: string) => {
    if (status === ONGOING_STATUS) return 0
    if (status === DONE_STATUS) return 1
    if (status === ABANDONED_STATUS) return 2
    return 1
  }
  return [...tasks].sort((a, b) => {
    const byStatus = priority(a.status) - priority(b.status)
    if (byStatus !== 0) return byStatus
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
}

/**
 * 换号世代：`reset()` 每跑一次 +1（登出 / 登录 / 注册都会走到）。
 * 它挡的是"迟到的响应"：上一个账号在途的 fetchTasks/fetchTask 回来时会把
 * **别人的任务**写进新账号的内存。发请求前记下世代、落地前比一次即可。
 */
let fetchGeneration = 0

interface TaskState {
  tasks: Task[]
  activeTask: TaskDetail | null
  steps: TaskStep[]
  loading: boolean
  error: string | null

  fetchTasks: () => Promise<void>
  fetchTask: (id: string) => Promise<void>
  setActiveTask: (task: TaskDetail | null) => void
  /** 返回值带 reused：true 表示服务端命中了已有任务、本次没有新建（判定只看这个布尔值） */
  generate: (painPoint?: string) => Promise<TaskGenerateResponse | null>
  /** feedback 由「花了多久 / 卡在哪」两栏拼成（后端只有一个 feedback 字段） */
  completeStep: (taskId: string, stepId: string, feedback: string) => Promise<boolean>
  abandon: (taskId: string, reason: string) => Promise<boolean>
  /** 删除任务（硬删除，连带全部步骤）；成功返回被删的步骤数，失败返回 null 且**不动列表** */
  remove: (taskId: string) => Promise<TaskDeleteResponse | null>
  reset: () => void
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  activeTask: null,
  steps: [],
  loading: false,
  error: null,

  async fetchTasks() {
    const generation = fetchGeneration
    set({ loading: true, error: null })
    try {
      const list = normalizeList(await taskApi.list())
      // 期间换过号 → 这份列表属于上一个账号，丢弃（见 fetchGeneration）
      if (generation !== fetchGeneration) return
      // 展示顺序：进行中在前，已完成/已放弃沉底（后端给的是 created_at 倒序）
      set({ tasks: sortTasksForDisplay(list) })
    } catch (error) {
      if (generation !== fetchGeneration) return
      set({ error: error instanceof Error ? error.message : '任务加载失败' })
    } finally {
      if (generation === fetchGeneration) set({ loading: false })
    }
  },

  async fetchTask(id) {
    const generation = fetchGeneration
    set({ loading: true, error: null })
    try {
      const task = await taskApi.detail(id)
      if (generation !== fetchGeneration) return
      set({ activeTask: task ?? null, steps: task?.steps ?? [] })
    } catch (error) {
      if (generation !== fetchGeneration) return
      set({
        activeTask: null,
        steps: [],
        error: error instanceof Error ? error.message : '任务加载失败',
      })
    } finally {
      if (generation === fetchGeneration) set({ loading: false })
    }
  },

  setActiveTask(task) {
    set({ activeTask: task, steps: task?.steps ?? [] })
  },

  async generate(painPoint) {
    try {
      const result = await taskApi.generate({ pain_point: painPoint ?? null })
      if (!result) return null
      // result 是 TaskGenerateResponse（TaskDetail + reused）；reused 只是这次调用的结果标记，
      // 落进 activeTask / tasks 时按 TaskDetail 看待即可（判定与合并都在下面按 id 做）
      const detail: TaskDetail = result
      set((state) => ({
        activeTask: detail,
        steps: detail.steps ?? [],
        tasks: mergeTaskById(state.tasks, detail),
      }))
      return result
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

  async remove(taskId) {
    // 刻意**不**发埋点：可上报的事件名是固定白名单（types 里的 TrackEventName），
    // 删除不是"给推荐用的信号"（那个语义属于 abandon），没必要为它扩白名单。
    try {
      const result = await taskApi.remove(taskId)
      // 成功才动内存：从列表里摘掉这一条（不整表重拉，其它卡片的滚动位置/状态都不受影响）
      set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== taskId),
        // 详情页删的就是当前这条 -> 清空，避免"删完还停在详情页"
        activeTask: state.activeTask?.id === taskId ? null : state.activeTask,
        steps: state.activeTask?.id === taskId ? [] : state.steps,
      }))
      // 4.2 全局失效信号：行动力/总分/阶段都因为少了打卡而变了
      useProfileStore.getState().bumpVersion()
      return result ?? null
    } catch (error) {
      // 失败：列表一个字节都不改（只有 error 字段更新，列表页当前不展示它）
      set({ error: error instanceof Error ? error.message : '删除失败，请稍后再试' })
      return null
    }
  },

  /** 换号时必须调（见 store/reset.ts）：任务列表/详情都按 user_id 存储，跨账号留着就是脏数据 */
  reset() {
    // 世代 +1：上一个账号在途的 fetchTasks/fetchTask 回来时会被丢掉
    fetchGeneration += 1
    set({
      tasks: [],
      activeTask: null,
      steps: [],
      error: null,
      // loading 也是按用户的：上一个账号在途的请求不该把新账号卡在加载态
      loading: false,
    })
  },
}))

/**
 * 把生成接口回来的任务按 **id** 并入列表（不能无条件往头部插一条）：
 *
 * - id 已存在：用这次的详情覆盖原项、把它提到最前，旧的那一项**从原位置移除**；
 *   其它任务只被压缩位置，数据与相对顺序都不变。
 * - id 不存在：才插到最前（行为同以前）。
 *
 * 后端命中 `reused` 时返回的就是列表里那条已有任务，原来 `[task, ...tasks]`
 * 会让同一个 id 在列表里出现两条（React key 重复 + 视图里两个一样的任务）。
 * 这里用 filter 而不是 splice：即使列表因为历史原因已经有重复 id，也会被一并清掉。
 */
function mergeTaskById(tasks: Task[], incoming: TaskDetail): Task[] {
  const existing = tasks.find((task) => task.id === incoming.id)
  if (!existing) return [incoming, ...tasks]
  // 先铺旧项再铺新详情：列表里有而详情没返回的字段不会被抹成 undefined
  const merged: Task = { ...existing, ...incoming }
  return [merged, ...tasks.filter((task) => task.id !== incoming.id)]
}

/** 后端 progress 是 0-1 的比例，这里转成百分比整数 */
export function taskProgress(task: Task): number {
  const ratio = typeof task.progress === 'number' ? task.progress : 0
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100)
}
