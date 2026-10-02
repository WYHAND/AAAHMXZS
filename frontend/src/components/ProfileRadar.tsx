import type { ReactNode } from 'react'
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'

/**
 * 画像雷达（六轴）—— **全站唯一一份实现**（个人中心「画像雷达」+ 首页「我的画像速览」共用）。
 *
 * 为什么不再用三个分数画：`clarity_score / action_score / resume_score` 只有三根轴
 * （一个三角形，信息量还不如三根条形），而且新用户 action/resume 恒为 0 时多边形
 * 会塌成一条线，看着像坏了。真正现成的素材是画像标签：`profile_tags.dimension`
 * 恰好就是六维，`GET /profile` 与 `GET /home/summary` 都在 `tags` 里带
 * `dimension` + `weight`（`ProfileTag` / `HomeTag` 都满足下面的 `EvidenceTag`）。
 *
 * 三条口径（改之前先读完）：
 *   1. **轴的顺序写死在 PROFILE_DIMENSIONS 里，不按值排序** —— 按值排序会让雷达
 *      随数据旋转，每次打开形状都不一样，看不出趋势。顺序来自后端
 *      `daily_question_service.DIMENSION_ROTATION`（前后端同一套六维体系）。
 *   2. **六个维度始终全画**，缺数据的轴值为 0：形状才稳定，也才看得出「这块还没聊到」。
 *   3. 取值 = 该维度下所有标签 `weight` 之和（后端会按对话/简历/测评调权重，
 *      所以这是**证据强度**，不是标签条数）。注意：用户侧的标签认可/否定入口
 *      已按产品要求移除（标签不给用户看，见 ProfilePage 顶部注释），权重只由后端更新。
 *
 * ⚠️ 归一化：`显示值 = 该轴权重和 / 六个轴里的最大值 × 100`（所以总有一根轴满格）。
 *    最大值 ≤ 0（一条标签都没有）时不画图，渲染调用方传进来的 `empty` 空态。
 *    归一化后的图形**看不出绝对长进**，这就是组件里必须把**真实数值**也列出来的原因
 *    （见下面「真实数值」那一行）；真实值一律放在页面上，**不放进 Tooltip**
 *    （触屏点不出来，等于没有）。
 *
 * ⚠️ 语义：这是「你聊过的内容的证据分布」，**不是打分**。痛点/焦虑/认知越靠外
 *    不代表越差，文案里不要出现「越满越好」「能力越强」这类暗示。
 *
 * 用色纪律（6.2 图表纪律）：单系列，主色 + 20% 透明填充，不用彩虹色；只用语义色类。
 * 面试复盘页的雷达语义不同（后端 `dimension_scores`），**不要**收编到这里。
 */

/**
 * 六个维度与**固定顺序**。禁止按值排序，也不要在这里增删维度。
 * 与后端 `daily_question_service.DIMENSION_ROTATION` 保持一致。
 */
const PROFILE_DIMENSIONS = ['兴趣', '能力', '技能', '痛点', '焦虑', '认知'] as const

/** 组件与派生逻辑只依赖这两个字段（ProfileTag / HomeTag 都满足） */
export interface EvidenceTag {
  dimension: string
  weight: number
}

interface ProfileAxis {
  /** 维度中文名（后端存的就是中文，直接展示） */
  dimension: string
  /** 该维度下所有标签 weight 之和 = 证据强度 */
  weight: number
  /** 归一化显示值 0-100：最大轴 = 100 */
  value: number
}

/**
 * 标签 → 六轴（真实权重和 + 归一化显示值）。
 *
 * - 顺序恒为 PROFILE_DIMENSIONS，**不排序**；
 * - 六轴永远都在（没有标签的轴 weight = 0）；
 * - 六轴之外的 dimension 值**不参与**（后端目前只有这六个），不做兜底轴；
 * - 最大值 ≤ 0 时 value 全为 0，组件据此走空态。
 */
function profileAxes(tags: readonly EvidenceTag[]): ProfileAxis[] {
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
 * 真实数值的显示：0 显示 `0`（配合「还没聊到」的说明），10 以下保留两位
 * （0.52 与 0.62 要分得开），10 以上一位小数够了。
 */
function formatEvidence(value: number): string {
  if (!value) return '0'
  return value < 10 ? value.toFixed(2) : value.toFixed(1)
}

export function ProfileRadar({
  tags,
  empty = null,
}: {
  tags: readonly EvidenceTag[]
  /** 一条标签都没有（六轴最大值 ≤ 0）时显示什么 —— 文案由各页面自己给，保持各自的说法 */
  empty?: ReactNode
}) {
  const axes = profileAxes(tags)
  // 最大值 ≤ 0：没有证据可画，走空态
  if (!axes.some((axis) => axis.weight > 0)) return <>{empty}</>

  const hasEmptyAxis = axes.some((axis) => axis.weight === 0)
  const spoken = axes
    .map((axis) => `${axis.dimension} ${formatEvidence(axis.weight)}`)
    .join('、')

  return (
    <div className="flex flex-col gap-3">
      <div className="h-60 w-full" role="img" aria-label={`画像雷达，各方面真实数值：${spoken}`}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={axes} outerRadius="72%">
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
            />
            {/* 这里**不**声明 PolarRadiusAxis：归一化后必有一根轴 = 100，
                recharts 极径轴默认取 [0, 数据最大值]（defaultNumericDomain=[0,'auto']），
                所以半径刻度恒为 0-100，形状稳定。显式加一个极径轴反而有把
                PolarGrid 同心环弄没的风险（网格半径取自极径轴 ticks）。 */}
            <Radar
              dataKey="value"
              stroke="var(--primary)"
              fill="var(--primary)"
              fillOpacity={0.2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* 归一化后的图形总有一根轴满格，看不出绝对长进 —— 真实数值必须在页面上可见，
          且不放进 Tooltip（触屏点不出来）。网格布局保证窄屏也不拥挤、不截断。 */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          真实数值（雷达按最大的那一项等比放大，只有形状可比）
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {axes.map((axis) => (
            <div key={axis.dimension} className="flex items-baseline justify-between gap-2">
              <dt className="text-xs text-muted-foreground">{axis.dimension}</dt>
              <dd className="font-numeric text-xs text-foreground">
                {formatEvidence(axis.weight)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-xs text-muted-foreground">
        六个方面：兴趣、能力、技能、痛点、焦虑、认知。按你聊过的内容算出的证据分布，不是打分；
        哪一项靠外都不代表好或差。
      </p>
      {hasEmptyAxis ? (
        <p className="text-xs text-muted-foreground">
          数值是 0 的方面只是还没聊到，聊到之后就会长出来。
        </p>
      ) : null}
    </div>
  )
}
