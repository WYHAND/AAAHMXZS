/**
 * 模拟面试接口 —— 路径对齐后端 app/api/v1/interview.py（prefix="/interview"）
 *
 *   POST /interview/start               开始（InterviewStartRequest: mode/scene/resume_id/target_job）
 *   GET  /interview/{id}/questions      **一次返回全部题目** + current_index
 *   POST /interview/{id}/answer         提交回答 ->
 *                                       { action: followup | next_question | finished, ... }
 *   POST /interview/{id}/finish         结束 -> 生成复盘
 *   GET  /interview/{id}/review         复盘报告
 *
 * ⚠️ 追问 = 同一道题的再问，**不新建题目行**（后端 README §4.12）：
 * `action` 是唯一判别依据，状态机在 store/interviewStore.ts 里。
 * ⚠️ 后端没有 GET /interview/options —— 模式/场景改为前端常量
 * （constants/interview.ts：小测试/全真，HR/项目/技术）。
 */

import { get, post } from '@/api/client'
import type {
  InterviewAnswerPayload,
  InterviewAnswerResponse,
  InterviewFinishResponse,
  InterviewQuestionsResponse,
  InterviewReview,
  InterviewSession,
  InterviewStartPayload,
} from '@/types'

export const interviewApi = {
  start: (payload: InterviewStartPayload) =>
    post<InterviewSession>('/interview/start', payload),

  /** 一次拿全部题目；前端按 current_index 定位当前题 */
  questions: (interviewId: string) =>
    get<InterviewQuestionsResponse>(`/interview/${interviewId}/questions`),

  answer: (interviewId: string, payload: InterviewAnswerPayload) =>
    post<InterviewAnswerResponse>(`/interview/${interviewId}/answer`, payload),

  finish: (interviewId: string) =>
    post<InterviewFinishResponse>(`/interview/${interviewId}/finish`),

  review: (interviewId: string) =>
    get<InterviewReview>(`/interview/${interviewId}/review`),
}
