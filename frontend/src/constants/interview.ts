/**
 * 面试模式与场景常量（Fix A：后端没有 GET /interview/options，
 * 这些值是后端 InterviewStartRequest 的枚举，前端写死为常量）
 *
 * 后端 schemas/interview.InterviewStartRequest：
 *   mode  = "小测试" / "全真"
 *   scene = "HR" / "项目" / "技术"
 */

export const INTERVIEW_MODES = [
  {
    value: '小测试',
    label: '小测试',
    desc: '3-5 题，先熟悉一下节奏',
  },
  {
    value: '全真',
    label: '全真模拟',
    desc: '完整流程，更接近真实面试',
  },
] as const

export const INTERVIEW_SCENES = [
  { value: 'HR', label: 'HR 面', desc: '动机、稳定性、沟通表达' },
  { value: '项目', label: '项目面', desc: '你做过的项目与细节追问' },
  { value: '技术', label: '技术面', desc: '岗位相关的专业知识' },
] as const

export const DEFAULT_INTERVIEW_MODE = INTERVIEW_MODES[0].value
export const DEFAULT_INTERVIEW_SCENE = INTERVIEW_SCENES[0].value

/** 题目总数未知时用它做进度条兜底 */
export const FALLBACK_QUESTION_TOTAL = 5

/**
 * 面试复盘的维度名映射。
 *
 * 后端 CORE_DIMENSIONS 本身就是中文（沟通表达/逻辑思维/专业基础/项目经验/求职动机，
 * 见 backend/app/ai/schemas.py），正常情况下直接用即可；但 dimension_scores 是
 * Dict[str, float]，AI 偶发返回英文键时会直接渲染到雷达图上 —— 这里兜底成中文，
 * **绝不把英文字段名显示给用户**。
 */
export const INTERVIEW_DIMENSION_LABEL: Record<string, string> = {
  communication: '沟通表达',
  expression: '沟通表达',
  logic: '逻辑思维',
  'logical thinking': '逻辑思维',
  professional: '专业基础',
  'professional foundation': '专业基础',
  project: '项目经验',
  'project experience': '项目经验',
  motivation: '求职动机',
}

/** 维度名 → 中文；未知的英文键兜底成「其他维度」，中文原样透传 */
export function interviewDimensionLabel(dimension?: string | null): string {
  const raw = (dimension ?? '').trim()
  if (!raw) return '其他维度'
  const mapped = INTERVIEW_DIMENSION_LABEL[raw.toLowerCase()]
  if (mapped) return mapped
  return /^[a-z_ ]+$/.test(raw.toLowerCase()) ? '其他维度' : raw
}
