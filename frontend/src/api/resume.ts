/**
 * 简历接口 —— 路径对齐后端 app/api/v1/resume.py（prefix="/resume"，**单数**）
 *
 *   GET  /resume                列表（裸数组）
 *   POST /resume                新建（ResumeCreate）
 *   POST /resume/upload         上传解析（multipart: file + title? + target_job?）
 *   GET  /resume/{id}           详情
 *   PUT  /resume/{id}           更新（ResumeUpdate）
 *   POST /resume/{id}/optimize  优化建议（**需要 body**，字段都可选）
 *   GET  /resume/{id}/report    最近一次优化报告
 *
 * ⚠️ 后端没有 DELETE /resume/{id}，也没有 /resume/{id}/file。
 * 上传后的文件走 main.py 挂载的静态目录 `/uploads/{file_path}`（无鉴权）。
 */

import { client, get, post, put } from '@/api/client'
import type {
  ListPayload,
  Resume,
  ResumeCreatePayload,
  ResumeOptimizePayload,
  ResumeReport,
  ResumeUpdatePayload,
} from '@/types'

export const resumeApi = {
  /** 列表返回裸数组，调用方用 normalizeList 收口（Fix B） */
  list: () => get<ListPayload<Resume>>('/resume'),

  detail: (id: string) => get<Resume>(`/resume/${id}`),

  create: (payload: ResumeCreatePayload) => post<Resume>('/resume', payload),

  save: (id: string, payload: ResumeUpdatePayload) => put<Resume>(`/resume/${id}`, payload),

  /** 上传简历文件（react-dropzone 提供 File）；后端 multipart 字段名是 file */
  upload: (file: File, meta?: { title?: string; target_job?: string }) => {
    const form = new FormData()
    form.append('file', file)
    if (meta?.title) form.append('title', meta.title)
    if (meta?.target_job) form.append('target_job', meta.target_job)
    return post<Resume>('/resume/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // 解析要调 AI，给足超时
      timeout: 120000,
    })
  },

  /** 生成优化报告；后端 body 必填（字段可选），所以至少发 {} */
  optimize: async (id: string, payload?: ResumeOptimizePayload): Promise<ResumeReport> =>
    (await post<ResumeReport>(`/resume/${id}/optimize`, payload ?? {})) as ResumeReport,

  report: (id: string) => get<ResumeReport>(`/resume/${id}/report`),

  /**
   * 带鉴权的简历文件下载（后端返回 FileResponse，不是信封）：
   * 后端**后补**了这个端点，因为 file_path 里带 user_id、路径可枚举，
   * 而简历含 PII，不能直接静态暴露 —— 必须走这个带鉴权的接口拿 blob。
   * 不能用 <a href> 直链。
   */
  downloadFile: async (id: string): Promise<Blob> =>
    (await client.get(`/resume/${id}/file`, { responseType: 'blob' })) as unknown as Blob,
}
