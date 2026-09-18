/**
 * 每日一问接口 —— 路径对齐后端 app/api/v1/daily_question.py（prefix="/daily"）
 *
 *   GET  /daily/today    今日问题 + answered + answer + streak
 *   POST /daily/answer   回答（body: question_id + answer，**answer 上限 200 字**）
 *
 * ⚠️ 后端没有 GET /daily/history —— 已删除，历史页走空态。
 */

import { get, post } from '@/api/client'
import type { DailyAnswerPayload, DailyAnswerResponse, TodayQuestion } from '@/types'

export const dailyApi = {
  today: () => get<TodayQuestion>('/daily/today'),
  answer: (payload: DailyAnswerPayload) =>
    post<DailyAnswerResponse>('/daily/answer', payload),
}
