/** 阶段枚举与文案（设计说明书 2.2、6.2 阶段色） */

export const STAGE = {
  EXPLORE: 'explore',
  PREPARE: 'prepare',
  SPRINT: 'sprint',
} as const

export type Stage = (typeof STAGE)[keyof typeof STAGE]

/** 后端可能下发中文或英文阶段名，统一归一化到此枚举 */
export const STAGE_LABEL: Record<Stage, string> = {
  explore: '职业探索期',
  prepare: '求职准备期',
  sprint: '求职冲刺期',
}

export const STAGE_DESC: Record<Stage, string> = {
  explore: '还在找方向，重点是扩大接触面、验证兴趣',
  prepare: '方向大体确定，重点是简历、项目与表达',
  sprint: '已进入投递与面试节奏，重点是实战与复盘',
}

/** 阶段色的语义类名（6.2：阶段色只用于徽章与进度，不允许用在按钮上） */
export const STAGE_CLASS: Record<
  Stage,
  { chip: string; bar: string; dot: string }
> = {
  explore: {
    chip: 'border-stage-explore/40 bg-stage-explore/12 text-stage-explore',
    bar: 'bg-stage-explore',
    dot: 'bg-stage-explore',
  },
  prepare: {
    chip: 'border-stage-prepare/40 bg-stage-prepare/12 text-stage-prepare',
    bar: 'bg-stage-prepare',
    dot: 'bg-stage-prepare',
  },
  sprint: {
    chip: 'border-stage-sprint/40 bg-stage-sprint/12 text-stage-sprint',
    bar: 'bg-stage-sprint',
    dot: 'bg-stage-sprint',
  },
}

/** 进度点 ●○○ 的显示顺序（黄 → 蓝 → 红） */
export const STAGE_ORDER: Stage[] = [STAGE.EXPLORE, STAGE.PREPARE, STAGE.SPRINT]

/** 2.2 阶段自适应排序：只改顺序，不隐藏功能 */
export const NAV_ORDER_BY_STAGE: Record<Stage, string[]> = {
  explore: ['/', '/chat', '/daily', '/task', '/resume', '/interview'],
  prepare: ['/', '/resume', '/task', '/chat', '/interview', '/daily'],
  sprint: ['/', '/interview', '/resume', '/task', '/chat', '/daily'],
}

/**
 * 2.2 首页首屏主 CTA 文案 —— **仅作兜底**。
 * 真实文案由后端下发（`GET /home/summary` 的 `next_action`，产品「AI 主动性」的落点，
 * 见 `hooks/useStage.ts`）；这里只在 next_action 尚未加载或后端不可用时使用。
 */
export const STAGE_PRIMARY_CTA: Record<Stage, string> = {
  explore: '和 AI 聊聊我的方向',
  prepare: '继续完善我的简历',
  sprint: '来一次全真模拟面试',
}

export const STAGE_PRIMARY_ROUTE: Record<Stage, string> = {
  explore: '/chat',
  prepare: '/resume',
  sprint: '/interview',
}

/** 阶段归一化：兼容后端返回的中文/大写/未知值 */
export function normalizeStage(raw?: string | null): Stage {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'explore' || value === 'prepare' || value === 'sprint') {
    return value
  }
  if (raw?.includes('探索')) return STAGE.EXPLORE
  if (raw?.includes('准备')) return STAGE.PREPARE
  if (raw?.includes('冲刺')) return STAGE.SPRINT
  return STAGE.EXPLORE
}
