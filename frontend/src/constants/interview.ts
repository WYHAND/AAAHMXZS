/**
 * 面试模式与场景常量（Fix A：后端没有 GET /interview/options，
 * 这些值是后端 InterviewStartRequest 的枚举，前端写死为常量）
 *
 * 后端 schemas/interview.InterviewStartRequest：
 *   mode  = "小测试" / "全真"
 *   scene = "HR" / "项目" / "技术"
 *
 * ⚠️ 2026-10-11 订正「题量」：
 * 这里原先把小测试写成「3-5 题」，是**假的** —— 后端
 * `interview_service.MODE_QUESTION_COUNT = {"小测试": 3, "全真": 6}`，
 * 且出题后按 `questions[:expected]` 截断，所以用户最多只会被问 3 题 / 6 题，
 * 永远不会有第 5 题。题量因此改为**一个数字字段 `count`**，
 * 页面只许引用它、不许再手写数字（手写就会像这次一样漂移成假话）。
 * 改后端 MODE_QUESTION_COUNT 时必须同步这里。
 */

export const INTERVIEW_MODES = [
  {
    value: '小测试',
    label: '小测试',
    count: 3,
    desc: '3 题，先把节奏熟悉一下',
  },
  {
    value: '全真',
    label: '全真模拟',
    count: 6,
    desc: '6 题，完整流程更接近真实面试',
  },
] as const

export const INTERVIEW_SCENES = [
  { value: 'HR', label: 'HR 面', desc: '动机、稳定性、沟通表达' },
  { value: '项目', label: '项目面', desc: '你做过的项目与细节追问' },
  { value: '技术', label: '技术面', desc: '岗位相关的专业知识' },
] as const

export const DEFAULT_INTERVIEW_MODE = INTERVIEW_MODES[0].value
export const DEFAULT_INTERVIEW_SCENE = INTERVIEW_SCENES[0].value

/**
 * 「跳过这题」写进 answer 的占位文本。
 *
 * 后端 interview_service.SKIP_ANSWER 与此一致：复盘时会把这条当成“跳过”，
 * 不会当成认真回答。语音/文字两条提交路径共用它，避免两处各写一份。
 */
export const INTERVIEW_SKIP_ANSWER = '（跳过这题）'

/**
 * 出题失败时的兜底题数 —— 后端 `interview_service.FALLBACK_QUESTIONS` 是 **3 条**，
 * 所以这里从 INTERVIEW_MODES 派生（小测试 = 3 题），不再手写。
 *
 * ⚠️ 这个常量目前**全前端零引用**（只有定义，没有 import）。保留它是为了在需要时
 * 有个"带出处"的值可用；原值写的 5 与真实兜底 3 条对不上（也会和 3/6 的真值打架），
 * 已订正。要用就直接引用它，别再写数字。
 */
export const FALLBACK_QUESTION_TOTAL = INTERVIEW_MODES[0].count

/**
 * 「小测试 N 题；全真模拟 N 题」——从上面的 count 派生，
 * 给准备页那种"这场会怎么进行"的说明用，避免第二处手写数字。
 */
export function interviewModeHint(): string {
  return INTERVIEW_MODES.map((item) => `${item.label} ${item.count} 题`).join('；')
}

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
