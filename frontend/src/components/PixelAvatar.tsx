/**
 * PixelAvatar —— 简历纸右上角照片位里的**像素人物**（纯内联 SVG，不依赖任何图片文件）。
 *
 * 为什么是画出来的而不是一张图：
 * - 仓库里没有、也不该加人物照片资源（版权 / 体积 / 离线打包都要考虑）；
 * - 打印时 SVG 走矢量，纸上是干净的直角色块，不会糊；
 * - 男生 / 女生两套点阵由 `resolveAvatarVariant(basic.gender)` 自动选，用户不用挑。
 *
 * 形状：16 列 × 18 行，每格 10 → `viewBox="0 0 160 180"`；
 * `shape-rendering="crispEdges"` 保证缩放到任何尺寸都是硬边像素、不插值发虚。
 *
 * 动画：眨眼（`px-eye`）与轻微呼吸位移（`px-fig`）的 keyframes 定义在
 * `styles/resume.css`（屏幕态）。打印时由 `print.css` 把两者都停掉 ——
 * 纸上不能出现一只闭着的眼睛。
 *
 * ⚠️ 两张点阵表**逐行必须 16 个字符**（`. ` 表示透明，其余字符查上面的调色板字典）。
 * 改点阵时改错一格不会报错，只会让人物的脸歪掉，所以数清楚再落笔。
 */
import type { ReactElement } from 'react'

/** 点阵字典：字符 → 颜色。`.` 不在字典里 = 透明格，不画。 */
type Palette = Record<string, string | undefined>

/** 男生：深发（`h` 深）＋ 冷蓝上衣（`b`）；肤 `s` / 眼睛 `e` / 嘴 `m` / 领口高光 `w` */
const MALE_PIXELS: string[] = [
  '....oooooooo....',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhsssssshho..',
  '..ohssssssssho..',
  '..osssssssssso..',
  '..osssessessso..',
  '..osssssssssso..',
  '..ossssmmsssso..',
  '..osssssssssso..',
  '...osssssssso...',
  '.....ssssss.....',
  '.obbbbbbbbbbbbo.',
  '.obbbbbbbbbbbbo.',
  'obbbbbbbbbbbbbbo',
  'obbbbwwwwwwbbbbo',
]

/** 女生：长发（`h` 暖棕）＋ 暖调上衣（`b`）；点阵与配色都是另一套 */
const FEMALE_PIXELS: string[] = [
  '...oooooooooo...',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhhhhhhhhho..',
  '..ohhsssssshho..',
  '..ohssssssssho..',
  '..ohssssssssho..',
  '..ohssessessho..',
  '..ohssssssssho..',
  '..ohsssmmsssho..',
  '..ohssssssssho..',
  '..ohhhssssshho..',
  '..ohhhssssshho..',
  '..ohhbbbbbbhho..',
  '.ohhbbbbbbbbhho.',
  'ohhbbbbbbbbbbhho',
  'obbbbwwwwwwbbbbo',
]

const MALE_PALETTE: Palette = {
  o: '#0d1a2b', // 轮廓 / 深墨
  h: '#243247', // 头发（深）
  s: '#f0c39a', // 肤色
  e: '#0d1a2b', // 眼睛（与轮廓同色）
  m: '#c98a6a', // 嘴
  b: '#2f4a6d', // 上衣（冷蓝）
  w: '#eef2f7', // 领口高光
}

const FEMALE_PALETTE: Palette = {
  o: '#4a2b1e',
  h: '#6b4227',
  s: '#f4cba6',
  e: '#4a2b1e',
  m: '#cf7561',
  b: '#b06a4a',
  w: '#faf3ec',
}

const CELL = 10
const VIEW_W = 16 * CELL
const VIEW_H = 18 * CELL

/**
 * 性别 → 人物版本。规则极简：**含「女」就是女生版**，其余（含空串 / 未填 / 「男生」）一律男生版。
 *
 * 为什么不按性别字段精确匹配：AI 或用户可能写成「女生」「女」「女性」——
 * 逐字匹配会漏；而"不选女生就画男生"是这里唯一安全的兜底（照片位不印性别文字，
 * 真正决定纸上有没有字的是基本信息那张字段表）。
 */
export function resolveAvatarVariant(gender: string): 'male' | 'female' {
  return gender.includes('女') ? 'female' : 'male'
}

export interface PixelAvatarProps {
  variant?: 'male' | 'female'
  className?: string
}

/**
 * 像素人物。整张图是装饰（人物不承载任何文字信息），所以对读屏隐藏。
 *
 * ⚠️ 颜色必须走 `fill` 属性而不是类名：这一张图在**打印时**也要保持配色，
 * 不能被 `.resume-sheet * { color }` 那条全局规则改成黑色。
 */
export function PixelAvatar({ variant = 'male', className }: PixelAvatarProps) {
  const rows = variant === 'female' ? FEMALE_PIXELS : MALE_PIXELS
  const palette = variant === 'female' ? FEMALE_PALETTE : MALE_PALETTE

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      shapeRendering="crispEdges"
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <g className="px-fig">
        {rows.map((row, y) => (
          <g key={y}>{paintRow(row, y, palette)}</g>
        ))}
      </g>
    </svg>
  )
}

/** 一行里真正要画的格子（查表取色 + 眼睛挂类名） */
function paintRow(row: string, y: number, palette: Palette): ReactElement[] {
  const cells: ReactElement[] = []
  for (let x = 0; x < row.length; x += 1) {
    const ch = row[x]
    const fill = palette[ch]
    if (!fill) continue
    cells.push(
      <rect
        key={`${x}-${y}`}
        x={x * CELL}
        y={y * CELL}
        width={CELL}
        height={CELL}
        fill={fill}
        className={ch === 'e' ? 'px-eye' : undefined}
      />,
    )
  }
  return cells
}

export default PixelAvatar
