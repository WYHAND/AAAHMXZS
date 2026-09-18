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
