/**
 * 阶段读取（设计说明书 2.2 阶段自适应排序、4.1 profileStore.stage）
 *
 * 同时暴露首页 CTA：
 * - 优先用后端下发的 next_action（GET /home/summary 里的 HomeNextAction，产品「AI 主动性」落点）
 * - 后端不可用时回落到 constants/stage.ts 的阶段固定文案
 */

import { useMemo } from 'react'

import {
  NAV_ORDER_BY_STAGE,
  STAGE_DESC,
  STAGE_LABEL,
  STAGE_PRIMARY_CTA,
  STAGE_PRIMARY_ROUTE,
  type Stage,
} from '@/constants/stage'
import { useProfileStore } from '@/store/profileStore'
import type { HomeNextAction } from '@/types'

export interface UseStageResult {
  stage: Stage
  label: string
  desc: string
  /** 侧栏 / 移动端「我的」里的功能顺序，只改顺序不隐藏 */
  navOrder: string[]
  /** 阶段文案兜底（后端 next_action 拿不到时用） */
  fallbackCta: { text: string; route: string }
  /** 后端下发的下一步建议（GET /home/summary）；未加载时为 null */
  nextAction: HomeNextAction | null
}

export function useStage(): UseStageResult {
  const stage = useProfileStore((s) => s.stage)
  const nextAction = useProfileStore((s) => s.nextAction)

  return useMemo(
    () => ({
      stage,
      label: STAGE_LABEL[stage],
      desc: STAGE_DESC[stage],
      navOrder: NAV_ORDER_BY_STAGE[stage],
      fallbackCta: {
        text: STAGE_PRIMARY_CTA[stage],
        route: STAGE_PRIMARY_ROUTE[stage],
      },
      nextAction,
    }),
    [stage, nextAction],
  )
}
