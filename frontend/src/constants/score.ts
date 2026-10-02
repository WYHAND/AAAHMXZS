/**
 * 四个分数维度的**唯一**中文映射。
 *
 * ⚠️ 前端任何地方都不允许把 `clarity_score` / `action_score` / `resume_score` /
 *    `total_score` 这类英文字段名渲染给用户（用户截图里「与上一份报告相比」那排
 *    显示的 `clarity_score` 就是漏了这个映射）。
 *
 * 成长报告、个人中心、测试结果、首页雷达都从这里取 label，**不要写第二套**。
 */

export type ScoreKey =
  | 'clarity_score'
  | 'action_score'
  | 'resume_score'
  | 'total_score'

export interface ScoreItem {
  key: ScoreKey
  label: string
}

/** 单一数据源：所有中文文案在这里定义一次 */
export const SCORE_LABEL: Record<ScoreKey, string> = {
  clarity_score: '方向清晰度',
  action_score: '行动力',
  resume_score: '简历完整度',
  total_score: '综合得分',
}

/** 三个分项（成长报告上方那排分数、个人中心「当前阶段」的三根进度条、测评结果共用） */
export const SCORE_ITEMS: ScoreItem[] = [
  { key: 'clarity_score', label: SCORE_LABEL.clarity_score },
  { key: 'action_score', label: SCORE_LABEL.action_score },
  { key: 'resume_score', label: SCORE_LABEL.resume_score },
]

/** 综合得分（与上面三项一起用于「与上一份报告相比」） */
export const TOTAL_SCORE_ITEM: ScoreItem = {
  key: 'total_score',
  label: SCORE_LABEL.total_score,
}

/** 四行对比用：三项 + 综合得分 */
export const SCORE_COMPARE_ITEMS: ScoreItem[] = [...SCORE_ITEMS, TOTAL_SCORE_ITEM]

/**
 * 未知 key 的兜底：宁可说「其他维度」，也绝不把原始英文字段名漏给用户。
 */
export function scoreLabel(key: string): string {
  return SCORE_LABEL[key as ScoreKey] ?? '其他维度'
}

/**
 * 变化值的统一显示：正数 `+N`、负数 `-N`、0 显示 `±0`。
 * 0 不是"涨了"，所以不能走 `+0`。
 */
export function formatScoreDelta(value: number): string {
  const rounded = Math.round(value)
  if (rounded > 0) return `+${rounded}`
  if (rounded < 0) return `${rounded}`
  return '±0'
}

/** 变化值的语义色：涨=success、跌=destructive、没变=中性灰（0 不用绿色） */
export function scoreDeltaTone(value: number): string {
  const rounded = Math.round(value)
  if (rounded > 0) return 'text-success'
  if (rounded < 0) return 'text-destructive'
  return 'text-muted-foreground'
}
