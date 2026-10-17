import type { ReactNode } from 'react'
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'

import { profileAxes, type EvidenceTag } from '@/utils/profileEvidence'

/**
 * 画像雷达（六轴）—— **全站唯一一份实现**（个人中心「画像雷达」+ 首页「我的画像速览」共用）。
 *
 * 为什么不再用三个分数画：`clarity_score / action_score / resume_score` 只有三根轴
 * （一个三角形，信息量还不如三根条形），而且新用户 action/resume 恒为 0 时多边形
 * 会塌成一条线，看着像坏了。真正现成的素材是画像标签：`profile_tags.dimension`
 * 恰好就是六维，`GET /profile` 与 `GET /home/summary` 都在 `tags` 里带
 * `dimension` + `weight`（`ProfileTag` / `HomeTag` 都满足 `EvidenceTag`）。
 *
 * 三条口径（改之前先读完）：
 *   1. **轴的顺序写死在 PROFILE_DIMENSIONS 里，不按值排序** —— 按值排序会让雷达
 *      随数据旋转，每次打开形状都不一样，看不出趋势。顺序来自后端
 *      `daily_question_service.DIMENSION_ROTATION`（前后端同一套六维体系）。
 *   2. **六个维度始终全画**，缺数据的轴值为 0：形状才稳定，也才看得出「这块还没聊到」。
 *   3. 取值 = 该维度下所有标签 `weight` 之和（后端会按对话/简历/测评调权重，
 *      所以这是**证据强度**，不是标签条数）。
 *
 * ⚠️ 归一化：`显示值 = 该轴权重和 / 六个轴里的最大值 × 100`（所以总有一根轴满格）。
 *    最大值 ≤ 0（一条可画的标签都没有）时不画图，渲染调用方传进来的 `empty` 空态。
 *    归一化后的图形**看不出绝对长进**，这就是组件里必须把**真实数值**也列出来的原因
 *    （见下面「真实数值」那一行）；真实值一律放在页面上，**不放进 Tooltip**
 *    （触屏点不出来，等于没有）。
 *
 * ⚠️ 语义：这是「你聊过的内容的证据分布」，**不是打分**。痛点/焦虑/认知越靠外
 *    不代表越差，文案里不要出现「越满越好」「能力越强」这类暗示。
 *
 * 网格线纪律（2026-10-17 修订）：**两级层次，网格永远退到数据后面**。
 * 起因：用户看完说「雷达的六边形线条做的突出一点，可以让用户看清」。
 * 实测（`tools/render-check/radar-lines-probe.mjs`，探针列了卡内每个 SVG 元素的
 * computed stroke 与对白卡 #ffffff 的对比度）：
 *   - 同心环 `path.recharts-polar-grid-concentric-polygon` ×5 与 6 根辐条 `line`
 *     都来自 `<PolarGrid>`，原来 `stroke="var(--border)"` = 浅色主题的
 *     `rgba(226,232,240,0.45)`，45% 透明混到白卡上只有 **≈1.1:1** —— 肉眼等于没有，
 *     这就是"看不清"的全部原因（不是线太细）。
 *   - 最外圈六边形**被画了两遍**：PolarGrid 的最外环，与 `<PolarAngleAxis>` 的
 *     `axisLine`（`path.recharts-polar-angle-axis-line`，同半径、完全重合，见探针里
 *     两条几何完全一致的 `d`）。但 axisLine 默认**不带 stroke**（computed stroke=none），
 *     等于白画 —— 所以外层强调**不用自己写 SVG**，把 stroke 传给 axisLine 即可。
 *     它的默认 zIndex 是 500（高于 grid 的 -100），这里**刻意改成 90**：高于 PolarGrid
 *     （能压在环上），低于 Radar 的 100 —— 六维权重恰好全相等时，数据多边形正好贴在
 *     最外圈上，那时该压在上面的是数据（缺省 500 实测会把数据那圈 --primary 盖掉）。
 * 于是：环 + 辐条 `--outline-variant`（#c5c6cd，**1.70:1**，"看得见但退后"）；
 * 最外圈 `--outline`（#75777d，**4.48:1**）—— 全卡最清楚的网格线，仍远弱于数据多边形的
 * --primary（18.4:1）；数据多边形 `strokeWidth={1.75}`（recharts 默认 1px，屏幕上太飘）。
 * 实测值见 `tools/render-check/audit/radar-lines-after.txt`。
 *
 * ⚠️ 不把 `--outline` / `--outline-variant` 补进 `index.css` 的 `.dark` 块：实测
 *    `document.documentElement.className === ''`，全站固定浅色主题（没有主题开关，
 *    `sonner` 里也写明"不引入 next-themes"），那份暗色块是预置、运行时不挂载。
 *
 * 用色纪律（2026-10-11 修订）：单系列，**一屏只有一个多边形**，不用彩虹色。
 * 颜色由 `tone` 给：缺省 `ink`（主墨，个人中心与任何报表沿用）；
 * 首页「AI 发现」传 `signal`（语义蓝 --signal + 更低透明度的同色填充），
 * 用来和右边琥珀/绿的状态色区分"这是聊出来的证据，不是成绩"。
 * 面试复盘页的雷达语义不同（后端 `dimension_scores`），**不要**收编到这里。
 *
 * 说明：轴的派生逻辑（PROFILE_DIMENSIONS / profileAxes / hasEvidence）在
 * `@/utils/profileEvidence`，这样组件文件只导出组件（Fast Refresh），首页也能在渲染前
 * 用 `hasEvidence(tags)` 判断要不要留容器。
 */

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
  compact = false,
  tone = 'ink',
  fill = false,
}: {
  tags: readonly EvidenceTag[]
  /** 一条可画的标签都没有时显示什么 —— 文案由各页面自己给，保持各自的说法 */
  empty?: ReactNode
  /**
   * 紧凑模式：只画雷达本身（高度更小），隐藏「真实数值」表与说明文字。
   * 给首页这种「一眼看形状」的场景用；个人中心详细页保持默认（false）。
   */
  compact?: boolean
  /**
   * 多边形配色：缺省 `ink`（主墨，与旧版一致）；`signal` 用语义蓝，
   * 只给首页（那里右列已经有琥珀/绿/红三种状态色，雷达再用墨色会糊在一起）。
   */
  tone?: 'ink' | 'signal'
  /**
   * 撑满父容器（个人中心用）。父卡是 grid 里的一员，会被拉高到与左卡等高，
   * 于是图下面是 120~145px 的死白（实测 1100~1920px 都这样）。
   * `fill` 把那段高度**还给雷达本身**：图 `flex-1` 长高（下界仍是 240px），
   * 文字块不动 —— 比"拉大字号"更像一个刻意的版式，而不是把字撑肿。
   * 仅在父容器是 flex 列（Panel）且自己有确定高度时有效；首页 compact 不传。
   */
  fill?: boolean
}) {
  const axes = profileAxes(tags)
  // 最大值 ≤ 0：没有证据可画，走空态
  if (!axes.some((axis) => axis.weight > 0)) {
    // 空态在撑满模式下居中，否则整卡又只剩顶部一小块 + 下面一整片白
    return fill ? (
      <div className="flex flex-1 items-center justify-center">{empty}</div>
    ) : (
      <>{empty}</>
    )
  }

  const strokeColor = tone === 'signal' ? 'var(--signal-ink)' : 'var(--primary)'
  const fillColor = tone === 'signal' ? 'var(--signal)' : 'var(--primary)'

  const hasEmptyAxis = axes.some((axis) => axis.weight === 0)
  const spoken = axes
    .map((axis) => `${axis.dimension} ${formatEvidence(axis.weight)}`)
    .join('、')

  const chart = (
    <div
      className={
        compact
          ? 'h-56 w-full'
          : fill
            ? 'min-h-60 w-full flex-1'
            : 'h-60 w-full'
      }
      role="img"
      aria-label={`画像雷达，各方面真实数值：${spoken}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={axes} outerRadius="72%">
          {/* 环 + 辐条：可见但退后（--outline-variant 1.70:1，原来 --border 只有 ≈1.1:1） */}
          <PolarGrid stroke="var(--outline-variant)" />
          {/* 轴标签 13px + on-surface-variant：与下面的「真实数值」表同一档说明字号 */}
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fontSize: 13, fill: 'var(--on-surface-variant)' }}
            /* 最外圈六边形走 axisLine（与 PolarGrid 最外环同半径，zIndex 更高，
               正好压在环上）；不给它 stroke 时它默认 stroke=none，等于白画一整天。
               用 --outline（4.48:1）+ 略粗，比内环明显一档，但仍弱于数据多边形。
               zIndex=90 是刻意的：比 PolarGrid(-100) 高（压在环上），比 Radar(100) 低
               —— 六维权重恰好全相等时数据多边形会正好贴在最外圈上，这时该压在上面的是
               数据（实测 zIndex 缺省 500 时，axisLine 会把数据多边形那圈 --primary 盖掉）。 */
            axisLine={{ stroke: 'var(--outline)', strokeWidth: 1.5 }}
            zIndex={90}
          />
          {/* 这里**不**声明 PolarRadiusAxis：归一化后必有一根轴 = 100，
              recharts 极径轴默认取 [0, 数据最大值]（defaultNumericDomain=[0,'auto']），
              所以半径刻度恒为 0-100，形状稳定。显式加一个极径轴反而有把
              PolarGrid 同心环弄没的风险（网格半径取自极径轴 ticks）。 */}
          <Radar
            dataKey="value"
            stroke={strokeColor}
            fill={fillColor}
            fillOpacity={0.2}
            strokeWidth={1.75}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )

  // 紧凑模式：只给图，不给表与说明（首页只要形状）
  if (compact) return chart

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col gap-3' : 'flex flex-col gap-3'}>
      {chart}

      {/* 归一化后的图形总有一根轴满格，看不出绝对长进 —— 真实数值必须在页面上可见，
          且不放进 Tooltip（触屏点不出来）。网格布局保证窄屏也不拥挤、不截断。 */}
      <div className="flex flex-col gap-1.5">
        <p className="text-body-sm text-on-surface-variant">
          真实数值（雷达按最大的那一项等比放大，只有形状可比）
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {axes.map((axis) => (
            <div key={axis.dimension} className="flex items-baseline justify-between gap-2">
              <dt className="text-body-sm text-on-surface-variant">{axis.dimension}</dt>
              <dd className="text-body-sm font-medium text-primary">
                {formatEvidence(axis.weight)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-body-sm text-on-surface-variant">
        六个方面：兴趣、能力、技能、痛点、焦虑、认知。按你聊过的内容算出的证据分布，不是打分；
        哪一项靠外都不代表好或差。
      </p>
      {hasEmptyAxis ? (
        <p className="text-body-sm text-on-surface-variant">
          数值是 0 的方面只是还没聊到，聊到之后就会长出来。
        </p>
      ) : null}
    </div>
  )
}

export default ProfileRadar
