/**
 * 任务接口 —— 路径对齐后端 app/api/v1/task.py（prefix="/task"，**单数**）
 *
 *   GET  /task                              列表（裸数组，可选 status 过滤，值是中文）
 *   POST /task/generate                     生成任务（TaskGenerateRequest）
 *                                           → TaskGenerateResponse（详情 + reused）
 *   GET  /task/{id}                         详情（含 steps）
 *   POST /task/{id}/steps/{step_id}/complete 打卡（body 只有 feedback）
 *   POST /task/{id}/abandon                 放弃（**无 body**）
 *   DELETE /task/{id}                       删除（**硬删除**任务 + 全部步骤，不可恢复）
 *
 * ⚠️ 后端没有 POST /task/{id}/start —— 已删除。
 * 后端 status/difficulty 都是中文枚举：进行中/已完成/已放弃。
 *
 * 「放弃」与「删除」的区别（别混）：放弃只是把 status 改成「已放弃」，任务还在、
 * 打卡记录还在、**不扣分**；删除是把 tasks / task_steps 真删掉，会连带把
 * 行动力分数里那些打卡一起抹掉（分数下降）。所以删除必须二次确认。
 */

// Fix B：列表收口由调用方用 normalizeList 完成（utils/list.ts）
import { client, get, post } from '@/api/client'
import type {
  ListPayload,
  Task,
  TaskDeleteResponse,
  TaskDetail,
  TaskGeneratePayload,
  TaskGenerateResponse,
  TaskStepCompletePayload,
} from '@/types'

export const taskApi = {
  /** 列表：返回裸数组或分页体，调用方用 normalizeList 收口（Fix B） */
  list: (params?: { status?: string }) => get<ListPayload<Task>>('/task', { params }),

  /** 痛点诊断 -> 任务推荐 -> 步骤拆解（11.5）；reused === true 表示命中已有任务、没有新建 */
  generate: (payload: TaskGeneratePayload) =>
    post<TaskGenerateResponse>('/task/generate', payload),

  /**
   * 详情（含 steps）。
   *
   * `options.silent`：不弹全局错误 toast。给"删除前先数一遍打卡步数"用 ——
   * 那一步失败时确认弹窗自己会退化成保守文案，再弹一条全局错误只是噪音。
   */
  detail: (id: string, options?: { silent?: boolean }) =>
    get<TaskDetail>(`/task/${id}`, options),

  /** 打卡某一步；成功后必须 profileStore.bumpVersion()（4.2） */
  completeStep: (id: string, stepId: string, payload: TaskStepCompletePayload) =>
    post<TaskDetail>(`/task/${id}/steps/${stepId}/complete`, payload),

  /** 放弃任务：后端不接受 body，原因只作为本地埋点信号 */
  abandon: (id: string) => post<Task>(`/task/${id}/abandon`),

  /**
   * 删除任务（硬删除，连带全部步骤，**不可恢复**）。
   *
   * client.ts 刻意没有 del 助手（后端 DELETE 只有会话与任务两处，还没多到值得抽），
   * 所以按 chatApi.deleteConversation 的先例直接用 client.delete —— 拦截器已解信封，
   * 这里拿到的是 data（TaskDeleteResponse）。
   *
   * silent：失败提示统一由 store 的 remove 负责（它还要保证"失败就一个字节都不改列表"），
   * 交给拦截器会变成两个 toast。
   */
  remove: (id: string) =>
    client.delete(`/task/${id}`, { silent: true }) as unknown as Promise<TaskDeleteResponse>,
}
