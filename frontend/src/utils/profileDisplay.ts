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
 * 少于这么多条可见标签就**不画球**，只给下方那三行。
 *
 * 为什么：球体的好看来自"密"——十几个标签在球面上才读得出形状，
 * 5–8 条时它只是一把散点，比列表更难看（实测截图确认）。
 * 新用户就是那个"只有几条"的阶段，所以这条阈值是给他们的。
 */
export const SPHERE_MIN_TAGS = 12

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
