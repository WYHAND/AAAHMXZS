/**
 * 任务接口 —— 路径对齐后端 app/api/v1/task.py（prefix="/task"，**单数**）
 *
 *   GET  /task                              列表（裸数组，可选 status 过滤，值是中文）
 *   POST /task/generate                     生成任务（TaskGenerateRequest）
 *   GET  /task/{id}                         详情（含 steps）
 *   POST /task/{id}/steps/{step_id}/complete 打卡（body 只有 feedback）
 *   POST /task/{id}/abandon                 放弃（**无 body**）
 *
 * ⚠️ 后端没有 POST /task/{id}/start —— 已删除。
 * 后端 status/difficulty 都是中文枚举：进行中/已完成/已放弃。
 */

// Fix B：列表收口由调用方用 normalizeList 完成（utils/list.ts）
import { get, post } from '@/api/client'
import type {
  ListPayload,
  Task,
  TaskDetail,
  TaskGeneratePayload,
  TaskStepCompletePayload,
} from '@/types'

export const taskApi = {
  /** 列表：返回裸数组或分页体，调用方用 normalizeList 收口（Fix B） */
  list: (params?: { status?: string }) => get<ListPayload<Task>>('/task', { params }),

  /** 痛点诊断 -> 任务推荐 -> 步骤拆解（11.5） */
  generate: (payload: TaskGeneratePayload) => post<TaskDetail>('/task/generate', payload),

  detail: (id: string) => get<TaskDetail>(`/task/${id}`),

  /** 打卡某一步；成功后必须 profileStore.bumpVersion()（4.2） */
  completeStep: (id: string, stepId: string, payload: TaskStepCompletePayload) =>
    post<TaskDetail>(`/task/${id}/steps/${stepId}/complete`, payload),

  /** 放弃任务：后端不接受 body，原因只作为本地埋点信号 */
  abandon: (id: string) => post<Task>(`/task/${id}/abandon`),
}
