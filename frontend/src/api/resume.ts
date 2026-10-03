/**
 * 简历接口 —— 路径对齐后端 app/api/v1/resume.py（prefix="/resume"，**单数**）
 *
 *   GET  /resume/template       简历模板（每个字段带 question / example / required）
 *   POST /resume/polish         润色（只改用户写过的内容，不替他编）
 *   GET  /resume/mine           我的那一份（没有时 data = null，**不是报错**）
 *   PUT  /resume/mine           保存我的那一份
 *
 * 旧的列表式接口（GET /resume 列表、POST /resume 新建、POST /resume/upload 上传解析、
 * GET|PUT /resume/{id} 详情与更新、POST /resume/{id}/optimize 与 GET /resume/{id}/report
 * 优化报告、GET /resume/{id}/file 下载）已随老 ATS 链路整体删除（2026-11，与后端同批）。
 */

import { client, get, put } from '@/api/client'
import type {
  ApiEnvelope,
  ResumeMineUpdatePayload,
  ResumePolishPayload,
  ResumeResponse,
  ResumeTemplateData,
} from '@/types'

export const resumeApi = {
  /* ------------------- 我的简历（单份：模板 / 润色 / 读取 / 保存） ------------------- */

  /** 模板：界面上「问什么、怎么问」的唯一出处，前端不另写一份问题文案 */
  template: () => get<ResumeTemplateData>('/resume/template'),

  /**
   * 润色：只改写用户写过的内容。
   *
   * ⚠️ 这里刻意**不走 post<T>()**：润色必须把信封里的 `message` 原样带出来
   * （它是一句人话，例如「已润色；还有 3 项你没填，先空着（教育背景的时间…）」），
   * 而 post<T>() 只解出 data，message 会被丢掉。失败路径完全一致：
   * 非 0 code 由同一个响应拦截器 reject。
   */
  polish: async (payload: ResumePolishPayload): Promise<ApiEnvelope<ResumeResponse>> =>
    (await client.post('/resume/polish', payload, {
      // 润色要调 AI，给足超时
      timeout: 120000,
    })) as unknown as ApiEnvelope<ResumeResponse>,

  /**
   * 我的简历。后端**没有简历时返回 data = null**（HTTP 200 + code 0），
   * 所以 null 与「请求失败」是两件事：
   * - null → 正常，落到空态（还没开始填）；
   * - 抛错（ApiError）→ 真正的失败，页面给失败态 + 重试。
   * 调用方必须区分，不能把 null 当失败。
   */
  mine: () => get<ResumeResponse | null>('/resume/mine'),

  saveMine: (payload: ResumeMineUpdatePayload) =>
    put<ResumeResponse>('/resume/mine', payload),
}
