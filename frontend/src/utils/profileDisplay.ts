/**
 * 「我的画像」卡片的**展示层**规则（勘误 9.24.4 / 9.24.5）。
 *
 * ⚠️ 这里只决定"渲染什么"，不动任何数据：被过滤掉的标签照常入库、
 * 照常进 AI 输入（任务的痛点就从里面挑）、照常计入奖章
 * （「方向初现」的判据是**标签数 ≥ 6**，见手册 11.12）。
 *
 * ⚠️ 维度白名单与后端 `profile_service.VISIBLE_DIMENSIONS` 是**同一套**，
 * 改这里要同步改那里 —— 与「prompt 三处一致」同类纪律。
 *
 * 为什么要过滤而不是全量展示：卡片是一面"你是什么样的用户"的镜子，
 * 而 痛点/焦虑/认知 三类在附录A 里就是**判断类**标签
 * （缺项目/拖延/表达差/迷茫、高/中/低、清晰/模糊/偏差）。
 * 用"整类出局"当规则，而不是维护一张会过期的负面词黑名单。
 */
import { PROFILE_DIMENSIONS } from '@/utils/profileEvidence'
import type { ProfileTag } from '@/types'

/** 三个分组：口语化组名 → 对应的后端维度。数组顺序就是展示顺序。 */
export const DISPLAY_GROUPS = [
  { name: '喜欢的事', dimension: '兴趣' },
  { name: '会做的事', dimension: '技能' },
  { name: '做事的风格', dimension: '能力' },
] as const

/** 卡片可见的维度（= 分组的维度，不要再维护第二份清单）。 */
export const VISIBLE_DIMENSIONS: string[] = DISPLAY_GROUPS.map((group) => group.dimension)

/**
 * 判断类措辞：**即使落在可见维度里也不上卡片**。
 *
 * 为什么光有维度白名单不够 —— 真实库里就有这么一条：
 * `能力/「行动力待提升」`（后端 `profile_service._apply_test_tags` 写进去的），
 * 维度属"能力"，但它是一句判断。实测发现，所以这里必须有第二道。
 *
 * ⚠️ 后端 `profile_service.JUDGMENT_MARKERS` 是**同一份**，改这里要同步改那里。
 */
export const JUDGMENT_MARKERS = [
  '待提升',
  '不足',
  '偏弱',
  '困难',
  '拖延',
  '迷茫',
  '焦虑',
  '模糊',
  '偏差',
]

/** 下方可读列表里每组最多显示几条（球体里仍然有全部）。 */
export const GROUP_LIMIT = 3

/**
 * 可见标签达到这么多条时，球上**只剩真实标签**，不再补维度骨架。
 *
 * ⚠️ 这个常量以前叫 `SPHERE_MIN_TAGS`，是"少于 12 条就整颗球不画"的**显示阈值**。
 * 2026-10-22 用户验收后改口径：球体是这个功能的展示，**新用户也必须第一眼看到**
 * （标签少就藏起来等于告诉用户"功能还没做"）。所以它不再是"画不画球"的开关，
 * 而是"还要不要补六维幽灵字"的分界：真实标签够多了，骨架自然退场。
 */
export const SPHERE_FULL_TAGS = 12

/**
 * 球体上的一个字。
 *
 * - `ghost: false`：用户真的有的标签，实心、加粗；
 * - `ghost: true`：**还没聊到的维度名**（兴趣 / 能力 / 技能 / 痛点 / 焦虑 / 认知），
 *   浅色、细字，只负责把球的形状撑起来，告诉用户"这里以后会长出东西"。
 *
 * ⚠️ 幽灵字**只存在于渲染层**：不写回 `tags`、不算标签数、不进画像统计、
 * 不进 AI 输入、不影响奖章。它和右侧雷达里 weight=0 的轴是同一件事 —— 骨架，不是数据。
 */
export interface SphereLabel {
  text: string
  ghost: boolean
}

/**
 * 球体要显示的条目：真实标签 + （不足 12 条时）还没聊到的维度名。
 *
 * 为什么补维度而不是补"示例标签"：示例标签会被误当成自己的数据，也违反项目
 * "不编造"的纪律；维度名是这套画像本来就有的六个方面（与雷达同一套口径），
 * 补上去既不造假，又能让球在 0 条标签时也有稳定的形状。
 */
export function sphereLabels(tags: ProfileTag[]): SphereLabel[] {
  const visible = visibleTags(tags)
  const real: SphereLabel[] = visible.map((tag) => ({ text: tag.label, ghost: false }))

  if (visible.length >= SPHERE_FULL_TAGS) return real

  const used = new Set(visible.map((tag) => tag.dimension))
  const ghosts: SphereLabel[] = PROFILE_DIMENSIONS.filter((dimension) => !used.has(dimension)).map(
    (dimension) => ({ text: dimension, ghost: true }),
  )

  /*
   * 真实标签在前、幽灵字在后：TagCloud 按 index 在球面上均匀布点，
   * 顺序不影响分布，但让真实标签拿到前面的位置，重排时更稳定。
   */
  return [...real, ...ghosts]
}

/**
 * 稳定性信号：这个标签在**多少个不同的日子**被提到过。
 *
 * 后端写 `extra.seen_days`（同一天只记一次，见 profile_service._merge_extra）。
 * 刻意不按 `weight` 排序 —— weight 是"AI 有多确信"，实测会把「健身」这种
 * 兴趣爱好顶到求职画像的第一行（勘误 9.24.2）。
 */
export function seenDays(tag: ProfileTag): number {
  const days = (tag.extra as { seen_days?: unknown } | null | undefined)?.seen_days
  return Array.isArray(days) ? days.length : 0
}

/** 排序：反复出现过的优先；并列时权重高的靠前（保证次序稳定，不随刷新跳动）。 */
export function sortByStability(tags: ProfileTag[]): ProfileTag[] {
  return [...tags].sort((a, b) => seenDays(b) - seenDays(a) || b.weight - a.weight)
}

/** 可见 + 已排序的标签（球体与下方列表共用这一份，两处顺序一致）。 */
export function visibleTags(tags: ProfileTag[]): ProfileTag[] {
  return sortByStability(
    tags.filter(
      (tag) =>
        VISIBLE_DIMENSIONS.includes(tag.dimension) &&
        !JUDGMENT_MARKERS.some((marker) => tag.label.includes(marker)),
    ),
  )
}

export interface TagGroup {
  name: string
  tags: ProfileTag[]
}

/** 按分组切开：丢掉空组，组内已排序。 */
export function groupTags(tags: ProfileTag[]): TagGroup[] {
  const visible = visibleTags(tags)
  return DISPLAY_GROUPS.map((group) => ({
    name: group.name,
    tags: visible.filter((tag) => tag.dimension === group.dimension),
  })).filter((group) => group.tags.length > 0)
}
