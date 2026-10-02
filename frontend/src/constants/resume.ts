/**
 * 简历优化建议的小节名映射。
 *
 * ⚠️ 后端 `ResumeSuggestion.section` 是英文枚举
 *    （basic/education/experience/project/skill/summary，
 *      见 backend/app/ai/prompts/resume_optimize.txt），
 *    直接渲染会出现「1. project」这种英文，**必须**过这层映射。
 */

export const RESUME_SECTION_LABEL: Record<string, string> = {
  basic: '基本信息',
  education: '教育经历',
  experience: '实习/工作经历',
  project: '项目经历',
  skill: '技能',
  summary: '个人总结',
  other: '整体',
}

/**
 * 小节名 → 中文。
 * 未知英文枚举兜底成「整体」，已经是中文的值原样透传。
 */
export function resumeSectionLabel(section?: string | null): string {
  const raw = (section ?? '').trim()
  if (!raw) return '整体'
  const mapped = RESUME_SECTION_LABEL[raw.toLowerCase()]
  if (mapped) return mapped
  return /^[a-z_]+$/.test(raw.toLowerCase()) ? '整体' : raw
}
