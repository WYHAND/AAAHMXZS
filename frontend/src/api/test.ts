/**
 * 测试（职业测评）接口 —— 路径对齐后端 app/api/v1/test.py（prefix="/test"）
 *
 *   GET  /test/questions   题目列表（**需登录**；返回裸数组）
 *   POST /test/submit      提交答案 -> 计算初始画像
 *   GET  /test/result      最近一次结果（**没测过时 data 为 null**）
 *
 * ⚠️ 没有 GET /test/intro（设计说明书提过，后端未实现）：
 * 测试引导页的文案改为前端静态，不再发请求。
 */

import { get, post } from '@/api/client'
import type { ListPayload, TestQuestion, TestResult, TestSubmitRequest } from '@/types'

export const testApi = {
  /** 列表返回裸数组，调用方用 normalizeList 收口（Fix B） */
  questions: () => get<ListPayload<TestQuestion>>('/test/questions'),

  /** answers 是「题目 id -> 选项 key」的字典（后端 TestSubmitRequest） */
  submit: (payload: TestSubmitRequest) => post<TestResult>('/test/submit', payload),

  /** 没测过时后端返回 data: null */
  result: () => get<TestResult | null>('/test/result'),
}
