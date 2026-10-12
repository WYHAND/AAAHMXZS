/**
 * 画像六轴的取证逻辑（从 `components/ProfileRadar.tsx` 抽出来）。
 *
 * 为什么单独一个文件：组件文件里**只应导出组件**，否则会破坏 React Fast Refresh
 * （oxlint 的 react(only-export-components)）。而首页需要在渲染前先判断
 * 「六轴里到底有没有可画的证据」来决定要不要留容器，所以这个判断不能只藏在组件内部。
 *
 * 口径（与后端一致，改之前先读 ProfileRadar 的说明）：
 * - 六维、顺序固定，见 `PROFILE_DIMENSIONS`（同后端 daily_question_service.DIMENSION_ROTATION）；
 * - 六轴之外的 dimension 不参与，不做兜底轴；
 * - 某轴取值 = 该维度下所有标签 weight 之和（证据强度，不是打分）。
 */

/** 六个维度与**固定顺序**。禁止按值排序，也不要在这里增删维度。 */
export const PROFILE_DIMENSIONS = ['兴趣', '能力', '技能', '痛点', '焦虑', '认知'] as const

/** 组件与派生逻辑只依赖这两个字段（ProfileTag / HomeTag 都满足） */
export interface EvidenceTag {
  dimension: string
  weight: number
}

export interface ProfileAxis {
  /** 维度中文名（后端存的就是中文，直接展示） */
  dimension: string
  /** 该维度下所有标签 weight 之和 = 证据强度 */
  weight: number
  /** 归一化显示值 0-100：最大轴 = 100 */
  value: number
}

/**
 * 标签 → 六轴（真实权重和 + 归一化显示值 0-100）。
 * 顺序恒为 PROFILE_DIMENSIONS，不排序；没有标签的轴 weight = 0。
 */
export function profileAxes(tags: readonly EvidenceTag[]): ProfileAxis[] {
  const axes: ProfileAxis[] = PROFILE_DIMENSIONS.map((dimension) => ({
    dimension,
    weight: 0,
    value: 0,
  }))
  const byDimension = new Map(axes.map((axis) => [axis.dimension, axis]))

  for (const tag of tags) {
    const axis = byDimension.get(String(tag.dimension ?? '').trim())
    if (!axis) continue
    axis.weight += Number(tag.weight) || 0
  }

  const max = Math.max(...axes.map((axis) => axis.weight))
  for (const axis of axes) {
    axis.value = max > 0 ? (axis.weight / max) * 100 : 0
  }
  return axes
}

/**
 * 是否有可画的证据：六轴里至少一项 weight > 0。
 * 只有为 true 时才应该给它留容器 —— 否则会剩下一个空框
 * （六轴之外的 dimension 不参与，所以「有标签」不等于「有可画的轴」）。
 */
export function hasEvidence(tags: readonly EvidenceTag[]): boolean {
  return profileAxes(tags).some((axis) => axis.weight > 0)
}
