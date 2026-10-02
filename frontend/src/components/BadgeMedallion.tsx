import type { ReactNode } from 'react'

import type { BadgeItem } from '@/types'
import { remainingSteps } from '@/utils/badge'
import { cn } from '@/lib/utils'

/**
 * 奖章美术（纯内联 SVG，无图标库、无 emoji）
 *
 * 结构（坐标基于 128×128 viewBox）：
 *   1. L0 底影（已获得时整体再加一圈很轻的金色光晕）
 *   2. L1 外圈**受光面**：金属渐变盘 + 深色齿轮齿 + 一圈刻度刻痕
 *   3. L2 外缘高光弧（左上受光）
 *   4. L3 内凹环 + 内盘（比外圈暗 → 凹下去的层次）
 *   5. L4 内缘刻线（双圈）
 *   6. L5 底部缎带（**在纹样之下**，只从圆盘底部露出一截）
 *   7. L6 中心纹样（按 key 选，**必有默认纹样兜底**）
 *   8. L7 斜向凸起高光 + （未获得时）右下角小锁；进度环盖在最上层
 *
 * 两套状态：
 *   已获得 → 全彩金属（--medal-gold / -deep / -soft）+ text-medal-gold 光晕
 *   未获得 → 低饱和「铸模」灰（--medal-mute*），但层次**一个不少**：
 *            刻度环、内盘渐变、内缘刻线、缎带、纹样全部保留，只是压暗，
 *            再叠一条 --medal-gold-soft 的进度弧（progress.current / target）
 *            和右下角一枚小锁，所以依然一眼看得出是枚奖章。
 *
 * 配色纪律：只引用 index.css 里的 --medal-* 语义 token（亮/暗各一套），
 * 不出现任何 Tailwind 默认色板类。
 */

/** key → 用户能看懂的主题名（未知 key 一律回落到「成长奖章」，永不空白） */
const BADGE_KEY_LABEL: Record<string, string> = {
  first_task: '起步行动家',
  five_steps: '坚持打卡者',
  profile_shape: '方向初现',
}

export const DEFAULT_BADGE_LABEL = '成长奖章'

/** 未知 key 的兜底主题名 */
export function badgeKeyLabel(key: string): string {
  return BADGE_KEY_LABEL[key] ?? DEFAULT_BADGE_LABEL
}

/* ----------------------------- 中心纹样 ----------------------------- */

/** first_task —— 向上的箭头 + 一串脚印：从「迈出第一步」开始往上走 */
function MotifFootsteps() {
  return (
    <g
      strokeWidth={3.4}
      strokeLinecap="round"
      fill="none"
      className="stroke-medal-gold-deep"
    >
      <path d="M64 92V44" />
      <path d="M53 55 64 42l11 13" />
      <path d="M45 84c-3.4-4.8-1.5-10.2 2.7-10.7 4.2-.5 7.6 3.5 6.8 7.9-.6 3.1-2.9 5.4-5.5 6l-.1 3.4" />
      <path d="M83 84c3.4-4.8 1.5-10.2-2.7-10.7-4.2-.5-7.6 3.5-6.8 7.9.6 3.1 2.9 5.4 5.5 6l.1 3.4" />
    </g>
  )
}

/** five_steps —— 五格日历 / 五道刻痕：一格一格打满的坚持 */
function MotifMilestones() {
  return (
    <g>
      <g
        strokeWidth={2.8}
        fill="none"
        strokeLinecap="round"
        className="stroke-medal-gold-deep"
      >
        <rect x="40" y="46" width="48" height="40" rx="6" />
        <path d="M40 58h48" />
      </g>
      <g className="fill-medal-gold-deep">
        <rect x="49" y="66" width="6" height="12" rx="1.6" />
        <rect x="59" y="66" width="6" height="12" rx="1.6" />
        <rect x="69" y="66" width="6" height="12" rx="1.6" />
      </g>
      <g
        strokeWidth={2.6}
        fill="none"
        strokeLinecap="round"
        className="stroke-medal-gold-deep"
      >
        <path d="M52 41v-6" />
        <path d="M64 41v-6" />
        <path d="M76 41v-6" />
      </g>
    </g>
  )
}

/** profile_shape —— 星图 / 雷达轮廓：方向感开始成形 */
function MotifConstellation() {
  return (
    <g>
      <g
        strokeWidth={2.6}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-medal-gold-deep"
      >
        <path d="M64 39l20 18-20 30-20-30z" />
        <path d="M64 44v40" opacity={0.5} />
        <path d="M46 57h36" opacity={0.5} />
      </g>
      <g className="fill-medal-gold-deep">
        <circle cx="64" cy="39" r="4.6" />
        <circle cx="84" cy="57" r="3.2" />
        <circle cx="44" cy="57" r="3.2" />
        <circle cx="64" cy="87" r="3.6" />
        <circle cx="64" cy="62" r="2.6" />
      </g>
    </g>
  )
}

/**
 * 默认纹样 —— 任何未知 key 都落到这里（「后续可以添加」的硬要求）。
 * 用一个通用的菱形 + 同心环，不指向具体成就，但看着依然是一枚正式奖章。
 */
function MotifGeneric() {
  return (
    <g>
      <g
        strokeWidth={2.6}
        fill="none"
        strokeLinecap="round"
        className="stroke-medal-gold-deep"
      >
        <path d="M64 42l20 22-20 22-20-22z" />
        <circle cx="64" cy="64" r="8.5" />
      </g>
      <circle cx="64" cy="42" r="3.6" className="fill-medal-gold-deep" />
      <circle cx="64" cy="86" r="3.6" className="fill-medal-gold-deep" />
      <circle cx="44" cy="64" r="3.6" className="fill-medal-gold-deep" />
      <circle cx="84" cy="64" r="3.6" className="fill-medal-gold-deep" />
    </g>
  )
}

const MOTIFS: Record<string, () => ReactNode> = {
  first_task: MotifFootsteps,
  five_steps: MotifMilestones,
  profile_shape: MotifConstellation,
}

/* ------------------------------ 小零件 ------------------------------ */

/** 未获得时右下角的小锁：浅色小圆牌 + 深色锁形，尺寸刻意小，不抢奖章本身 */
function LockMark({ dimmed }: { dimmed: boolean }) {
  const glyph = dimmed ? 'fill-medal-mute-deep' : 'fill-medal-gold-deep'
  const stroke = dimmed ? 'stroke-medal-mute-deep' : 'stroke-medal-gold-deep'
  return (
    <g transform="translate(97 76)">
      {/* 浅色底牌，把锁从金属面上「托」出来 */}
      <circle
        cx="0"
        cy="0"
        r="16"
        className={dimmed ? 'fill-medal-mute-soft' : 'fill-medal-gold-soft'}
        opacity="0.95"
      />
      <circle
        cx="0"
        cy="0"
        r="16"
        fill="none"
        strokeWidth="1.4"
        className={dimmed ? 'stroke-medal-mute-deep' : 'stroke-medal-gold-deep'}
        opacity="0.5"
      />
      <g transform="translate(-9.5 -10.5)">
        <path
          d="M5.5 11V8.2a4 4 0 0 1 8 0V11"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
          className={stroke}
        />
        <rect x="3.2" y="10.4" width="12.6" height="10.6" rx="2.6" className={glyph} />
        <circle cx="9.5" cy="15.7" r="1.5" className="fill-medal-sheen" />
      </g>
    </g>
  )
}

/** 底部缎带：压在圆盘下半部（纹样之上、只在圆盘内），燕尾从盘底露出来 */
function Ribbon({ dimmed }: { dimmed: boolean }) {
  const deep = dimmed ? 'fill-medal-mute-deep' : 'fill-medal-gold-deep'
  // 带身：已获得用金色底，铸模态用深灰（--medal-mute 太浅，会糊在盘面上）
  const body = dimmed ? 'fill-medal-mute-deep' : 'fill-medal-gold'

  return (
    <g>
      {/* 带身 + 燕尾（圆盘最低 y=119，燕尾伸到 129） */}
      <path d="M46 100h36l-3 19-7-6-5 22-4-23-4 23-5-22-7 6z" className={deep} />
      {/* 带身上的受光条：白色低透明 —— 两套主题都成立（gold-soft 在暗色下比 gold 暗，不能用来提亮） */}
      <path d="M46 100h18v9H46z" className={body} opacity={0.9} />
      <path d="M64 100h18v9H64z" className={body} opacity={0.6} />
      {/* 上沿一道白色亮边，把缎带从盘面上托起来 */}
      <path d="M46 100h36v1.6H46z" className="fill-medal-sheen" opacity={dimmed ? 0.34 : 0.42} />
    </g>
  )
}

/* ------------------------------ 主组件 ------------------------------ */

export interface BadgeMedallionProps {
  badge: BadgeItem
  /** 视觉直径，默认 112px（用户要求「大一点」） */
  size?: number
  className?: string
}

export function BadgeMedallion({ badge, size = 112, className }: BadgeMedallionProps) {
  const obtained = badge.obtained
  const progress = badge.progress
  const target = Math.max(1, progress.target)
  const ratio = Math.min(1, Math.max(0, progress.current / target))
  const left = remainingSteps(progress)

  const Motif = MOTIFS[badge.key] ?? MotifGeneric
  const ribbonDim = !obtained

  return (
    <div
      data-slot="badge-medallion"
      data-badge-key={badge.key}
      data-obtained={obtained ? 'true' : 'false'}
      className={cn(
        'relative shrink-0',
        // 已获得：一圈很轻的金色光晕（用语义 token，不用彩色 shadow 类）
        obtained && 'text-medal-gold drop-shadow-[0_0_8px_color-mix(in_srgb,var(--medal-gold)_32%,transparent)]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 128 128"
        width="100%"
        height="100%"
        role="img"
        aria-label={
          badge.name
            ? `${badge.name}，${obtained ? '已获得' : `未获得，还差 ${left} 步`}`
            : undefined
        }
      >
        <defs>
          {/* 内盘（凹面）：整体比外圈暗，形成「凹下去」的层次 */}
          <radialGradient id="medal-face-gradient" cx="36%" cy="28%" r="78%">
            <stop offset="0%" stopColor="var(--medal-gold)" />
            <stop offset="58%" stopColor="var(--medal-gold-deep)" />
            <stop offset="100%" stopColor="var(--medal-gold-deep)" />
          </radialGradient>
          {/* 外圈（受光面）：亮金属，左上受光、右下转深 */}
          <linearGradient id="medal-rim-gradient" x1="10%" y1="4%" x2="90%" y2="98%">
            <stop offset="0%" stopColor="var(--medal-gold-soft)" />
            <stop offset="42%" stopColor="var(--medal-gold)" />
            <stop offset="100%" stopColor="var(--medal-gold-deep)" />
          </linearGradient>
          {/* 铸模态的内盘：浅灰凹面 */}
          <linearGradient id="medal-face-gradient-mute" x1="12%" y1="0%" x2="88%" y2="100%">
            <stop offset="0%" stopColor="var(--medal-mute-soft)" />
            <stop offset="62%" stopColor="var(--medal-mute)" />
            <stop offset="100%" stopColor="var(--medal-mute-deep)" />
          </linearGradient>
          {/* 铸模态的外圈：略亮的灰，保证「是枚奖章」的结构仍看得清 */}
          <linearGradient id="medal-rim-gradient-mute" x1="10%" y1="4%" x2="90%" y2="98%">
            <stop offset="0%" stopColor="var(--medal-mute-soft)" />
            <stop offset="55%" stopColor="var(--medal-mute)" />
            <stop offset="100%" stopColor="var(--medal-mute-deep)" />
          </linearGradient>
          {/* 上缘高光：一条渐隐的浅色带，做「受光」而不是打光效 */}
          <linearGradient id="medal-gloss-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--medal-gold-soft)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--medal-gold-soft)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* L0 底影：低透明暖褐，不用彩色阴影 */}
        <ellipse
          cx="64"
          cy="120"
          rx="40"
          ry="5"
          className={obtained ? 'fill-medal-gold-deep' : 'fill-medal-mute-deep'}
          opacity={0.18}
        />

        <g>
          {/* L1 外圈金属盘：**受光面**（比内盘亮），金属感的关键在这层与 L3 的明暗反转 */}
          <circle
            cx="64"
            cy="64"
            r="55"
            fill={obtained ? 'url(#medal-rim-gradient)' : 'url(#medal-rim-gradient-mute)'}
          />
          {/* 外缘压边（一条细的深色描边，让金属盘有厚度） */}
          <circle
            cx="64"
            cy="64"
            r="54.6"
            fill="none"
            strokeWidth="1.2"
            className={obtained ? 'stroke-medal-gold-deep' : 'stroke-medal-mute-deep'}
            opacity="0.6"
          />
          {/* 齿轮齿：深色，从外缘探出（radius 55 → 61） */}
          <g className={obtained ? 'fill-medal-gold-deep' : 'fill-medal-mute-deep'} opacity={obtained ? 0.9 : 0.8}>
            {Array.from({ length: 20 }).map((_, index) => (
              <rect
                key={`tooth-${index}`}
                x="61.7"
                y="5"
                width="4.6"
                height="6.4"
                rx="1.6"
                transform={`rotate(${index * 18 + 9} 64 64)`}
              />
            ))}
          </g>
          {/* 刻度：金属盘上的刻痕 */}
          <g
            strokeWidth="2"
            strokeLinecap="round"
            className={obtained ? 'stroke-medal-gold-deep' : 'stroke-medal-mute-deep'}
            opacity={obtained ? 0.5 : 0.45}
          >
            {Array.from({ length: 16 }).map((_, index) => (
              <line
                key={`tick-${index}`}
                x1="64"
                y1="12.5"
                x2="64"
                y2="18.5"
                transform={`rotate(${index * 22.5} 64 64)`}
              />
            ))}
          </g>
          {/* 右上缘的暗侧压边（一侧受光、一侧转暗，金属才有体积） */}
          <path
            d="M64 114A50 50 0 0 0 114 64"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className={obtained ? 'stroke-medal-gold-deep' : 'stroke-medal-mute-deep'}
            opacity={obtained ? 0.4 : 0.35}
          />

          {/* L2 外缘高光弧（左上受光） */}
          <path
            d="M64 14A50 50 0 0 0 14 64"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            stroke="url(#medal-gloss-gradient)"
            opacity={obtained ? 0.9 : 0.5}
          />

          {/* L3 内凹环 + 内盘（受光渐变，比外圈暗 → 凹下去的观感） */}
          <circle
            cx="64"
            cy="64"
            r="45"
            fill="none"
            strokeWidth="4"
            className={obtained ? 'stroke-medal-gold-deep' : 'stroke-medal-mute-deep'}
            opacity={obtained ? 0.7 : 0.6}
          />
          <circle
            cx="64"
            cy="64"
            r="42"
            fill={obtained ? 'url(#medal-face-gradient)' : 'url(#medal-face-gradient-mute)'}
          />

          {/* L4 内缘刻线（双圈） */}
          <circle
            cx="64"
            cy="64"
            r="38"
            fill="none"
            strokeWidth="1.4"
            className={obtained ? 'stroke-medal-gold-deep' : 'stroke-medal-mute-deep'}
            opacity="0.5"
          />
          <circle
            cx="64"
            cy="64"
            r="36.5"
            fill="none"
            strokeWidth="0.8"
            className={obtained ? 'stroke-medal-gold-soft' : 'stroke-medal-mute-soft'}
            opacity="0.45"
          />

          {/* L5 缎带：**在纹样之下**，只从圆盘底部露一截，不挡中心图案 */}
          <Ribbon dimmed={ribbonDim} />

          {/* L6 中心纹样（key 未知 → MotifGeneric） */}
          <Motif />

          {/* L7 凸起高光：一条斜向的受光带 */}
          <ellipse
            cx="51"
            cy="41"
            rx="17"
            ry="10"
            className={obtained ? 'fill-medal-gold-soft' : 'fill-medal-mute-soft'}
            opacity={obtained ? 0.34 : 0.22}
            transform="rotate(-28 51 41)"
          />

          {/* L7 未获得：小锁 */}
          {!obtained ? <LockMark dimmed /> : null}
        </g>

        {/* 未获得：进度环（盖在最上层，顺时针从 12 点走） */}
        {!obtained ? (
          <g>
            <circle
              cx="64"
              cy="64"
              r="61"
              fill="none"
              strokeWidth="3.6"
              strokeLinecap="round"
              strokeDasharray="383.27"
              strokeDashoffset="0"
              className="stroke-medal-mute-soft"
              opacity="0.5"
              transform="rotate(-90 64 64)"
            />
            <circle
              cx="64"
              cy="64"
              r="61"
              fill="none"
              strokeWidth="3.6"
              strokeLinecap="round"
              strokeDasharray="383.27"
              strokeDashoffset={383.27 * (1 - ratio)}
              className="stroke-medal-gold"
              transform="rotate(-90 64 64)"
            />
          </g>
        ) : null}
      </svg>
    </div>
  )
}
