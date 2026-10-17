import type { CSSProperties, ComponentType } from 'react'

import type { BadgeItem } from '@/types'
import { cn } from '@/lib/utils'

/**
 * 奖章动态插画（「我的奖章」右侧那一格）：
 *
 * 三枚奖章各有一幕**动画小剧场**，讲的正是这枚奖章"是怎么拿到的"：
 * | key | 幕 | 讲的事 |
 * | --- | --- | --- |
 * | `first_task` | 一个小人在原地缓缓走，地面往左滚，身后留下一串脚印 | 起步：动手做比想清楚更值钱 |
 * | `five_steps` | 五级台阶一站比一站高，打卡点一格格落上去，一条线把它们连起来 | 坚持：次数攒出来的 |
 * | `profile_shape` | 罗盘指针找方向、摆幅越来越小，最后指向右边；六个点依次亮起连成形状 | 方向：从对话里一点点浮出来 |
 * | 未知 key | 一个逐渐画完的圆环 + 一颗落定的点（永不空白） | 通用「成长」 |
 *
 * **这个文件只管"画什么"，不管"动多久"和"要不要动"**：
 * - 时间表全在 `index.css`（`--bs-loop` / `--bs-lead` / `--bs-lag`），这里只给每个
 *   元素一个序号 `--bs-i`；线条粗细也只有一个 `--bs-stroke`。
 * - 播不播由 CSS 决定：**未获得**（铸模）/ `prefers-reduced-motion` / 打印
 *   一律 `animation: none`，停在完成态。所以组件里没有"要不要动"的判断——
 *   唯一的例外是**结构差异**：没获得的奖章把动画该点亮的部分换成"已经攒到的那几格"。
 *
 * 美术纪律：纯内联 SVG + `.bs-*` 类，颜色只走 `--medal-*`，组件里不出现色值。
 * 六边形顶点、台阶高度、脚印间距都是解析算出来的，不手摆坐标。
 */
export function BadgeScene({ badge, className }: { badge: BadgeItem; className?: string }) {
  const Scene = SCENES[badge.key] ?? FallbackScene
  return (
    <svg
      className={cn('bs-scene', className)}
      data-key={badge.key}
      data-state={badge.obtained ? 'obtained' : 'locked'}
      viewBox="0 0 660 202"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <Scene badge={badge} />
    </svg>
  )
}

export default BadgeScene

type SceneProps = { badge: BadgeItem }

/** 错峰序号：CSS 拿它算延迟（见 index.css 的 `.bs-delay-in`） */
const seq = (i: number) => ({ '--bs-i': i }) as CSSProperties

/* --------------------------- 第一幕：起步行动家 --------------------------- */

/** 脚印条数；间距 70px，和小人 432 的位置留出"刚走过"的一段 */
const PRINTS = [0, 1, 2, 3, 4]

function StrollScene() {
  /* 小人整体放大 1.6 倍：原来那身 58px 的骨架在这一格里读不出"在走路" */
  const walker = 'translate(432 150) scale(1.6)'
  return (
    <g>
      {/* 起点刻线：告诉眼睛"这是从哪儿开始的" */}
      <line className="bs-track bs-line" x1="88" y1="136" x2="88" y2="164" />
      {/* 地面轨道：向左滚 = 小人在往前挪（虚线周期 20px，一圈走 8 个周期 ⇒ 接缝正好对齐） */}
      <line className="bs-track bs-line bs-anim bs-walk-track" x1="48" y1="150" x2="612" y2="150" />
      {/*
        脚印：留在身后慢慢淡掉。**永远渲染**，"未获得"时由 CSS 收起来
        （还没起步的人，地上不该有痕迹）。
      */}
      {PRINTS.map((i) => (
        <ellipse
          key={i}
          className="bs-walk-print bs-anim bs-delay-reverse"
          cx={400 - i * 70}
          cy={150}
          rx="7"
          ry="3"
          style={seq(i)}
        />
      ))}
      {/*
        小人：原地走（腿/臂绕关节摆，身体轻微起伏）。
        ⚠️ 位移写在外层 `<g transform>` 上、动画只挂内层 —— CSS 的 transform 会
        **覆盖** SVG 的 transform 属性，挂同一层上整个人就被甩回原点了。
      */}
      <g transform={walker}>
        <g className="bs-anim bs-walk-figure">
          <circle className="bs-lit-fill" cx="0" cy="-56" r="8" />
          <line className="bs-ink bs-figure-line" x1="0" y1="-48" x2="0" y2="-20" />
          {/* 两条腿 + 两条胳膊：静态就是一前一后（a/b），动起来靠 bs-walk-step 错半拍 */}
          <g className="bs-walk-limb bs-walk-limb-a bs-anim bs-walk-step">
            <line className="bs-ink bs-figure-line" x1="0" y1="-20" x2="0" y2="0" />
          </g>
          <g className="bs-walk-limb bs-walk-limb-b bs-anim bs-walk-step bs-walk-step-late">
            <line className="bs-ink bs-figure-line" x1="0" y1="-20" x2="0" y2="0" />
          </g>
          <g className="bs-walk-limb bs-walk-limb-b bs-anim bs-walk-step bs-walk-step-late">
            <line className="bs-ink bs-figure-line" x1="0" y1="-40" x2="0" y2="-23" />
          </g>
          <g className="bs-walk-limb bs-walk-limb-a bs-anim bs-walk-step">
            <line className="bs-ink bs-figure-line" x1="0" y1="-40" x2="0" y2="-23" />
          </g>
        </g>
      </g>
    </g>
  )
}

/* --------------------------- 第二幕：坚持打卡者 --------------------------- */

/** 五级台阶的解析坐标：底边对齐 y=162，一站比一站高 20px */
const STEP_COUNT = 5
const STEPS = Array.from({ length: STEP_COUNT }, (_, i) => {
  const h = 32 + i * 20
  return { x: 150 + i * 76, y: 162 - h, w: 48, h, cx: 174 + i * 76, cy: 162 - h - 14 }
})

function StepsScene({ badge }: SceneProps) {
  /** 亮到第几格：已获得=全亮；没获得=真实进度（静态铸模图，一格不多） */
  const lit = badge.obtained ? STEP_COUNT : Math.min(badge.progress.current, STEP_COUNT)
  const rail = STEPS.map((s, i) => `${i ? 'L' : 'M'}${s.cx} ${s.cy}`).join(' ')
  /*
    进度线未获得时要**停在进度上**（不是画满），所以给一个按 lit 算的 dashoffset；
    已获得时交给动画（动画的值会盖过这里的内联值）。
  */
  const railStatic = { strokeDasharray: 100, strokeDashoffset: (100 * (STEP_COUNT - lit)) / (STEP_COUNT - 1) }
  return (
    <g>
      <line className="bs-track bs-line" x1="120" y1="162" x2="540" y2="162" />
      {/* 台阶：底下永远压着一级灰的铸模，亮起来的是盖在上面的金 */}
      {STEPS.map((s, i) => (
        <g key={i}>
          <rect className="bs-ghost-fill" x={s.x} y={s.y} width={s.w} height={s.h} rx="6" />
          {i < lit ? (
            <rect
              className="bs-lit-fill bs-anim bs-step-lit bs-delay-in"
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx="6"
              style={seq(i)}
            />
          ) : null}
        </g>
      ))}
      {lit > 1 ? (
        <path
          className="bs-lit bs-line bs-anim bs-step-rail"
          d={rail}
          pathLength="100"
          style={badge.obtained ? undefined : railStatic}
        />
      ) : null}
      {/* 打卡点：从上方落下来就位（位移 12px，不弹） */}
      {STEPS.slice(0, lit).map((s, i) => (
        <circle key={i} className="bs-lit-fill bs-anim bs-step-dot bs-delay-in" cx={s.cx} cy={s.cy} r="5" style={seq(i)} />
      ))}
    </g>
  )
}

/* --------------------------- 第三幕：方向初现 --------------------------- */

const COMPASS = { cx: 176, cy: 101, r: 52 }
/** 六条画像维度 → 正六边形顶点（-90° 起、顺时针，半径 62） */
const SIGNAL_COUNT = 6
const SIGNALS = Array.from({ length: SIGNAL_COUNT }, (_, i) => {
  const a = ((-90 + i * 60) * Math.PI) / 180
  const r = (n: number) => Math.round(n * 10) / 10
  return { cx: r(452 + 62 * Math.cos(a)), cy: r(101 + 62 * Math.sin(a)) }
})
const SIGNALS_PATH = SIGNALS.map((p, i) => `${i ? 'L' : 'M'}${p.cx} ${p.cy}`).join(' ') + ' Z'

function DirectionScene({ badge }: SceneProps) {
  const lit = badge.obtained ? SIGNAL_COUNT : Math.min(badge.progress.current, SIGNAL_COUNT)
  const shapeStatic = { strokeDasharray: 100, strokeDashoffset: 100 - (lit / SIGNAL_COUNT) * 100 }
  return (
    <g>
      {/* 罗盘：外圈 + 12 根刻度 */}
      <circle className="bs-track bs-line" cx={COMPASS.cx} cy={COMPASS.cy} r={COMPASS.r} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180
        const r = (n: number) => Math.round(n * 10) / 10
        return (
          <line
            key={i}
            className="bs-track bs-line"
            x1={r(COMPASS.cx + 43 * Math.cos(a))}
            y1={r(COMPASS.cy + 43 * Math.sin(a))}
            x2={r(COMPASS.cx + 51 * Math.cos(a))}
            y2={r(COMPASS.cy + 51 * Math.sin(a))}
          />
        )
      })}
      {/* 指针：摆幅逐次收小，停在正东（正对着右边的六边形）。南北两半分色，一眼看出指哪头 */}
      <g className="bs-anim bs-needle">
        <path className="bs-lit-fill" d="M176 56 L183 101 L176 146 L169 101 Z" />
        <path className="bs-ghost-fill" d="M176 146 L183 101 L176 101 Z" />
      </g>
      <circle className="bs-ink bs-line" cx={COMPASS.cx} cy={COMPASS.cy} r="5" />
      {/* 六个点 + 把它们连起来的形状：攒够几条画像标签，就亮几个点 */}
      <path className="bs-track bs-line" d={SIGNALS_PATH} />
      <path
        className="bs-lit bs-line bs-anim bs-shape"
        d={SIGNALS_PATH}
        pathLength="100"
        style={badge.obtained ? undefined : shapeStatic}
      />
      {SIGNALS.map((p, i) => (
        <circle
          key={i}
          className={cn(i < lit ? 'bs-lit-fill bs-anim bs-signal bs-delay-in' : 'bs-ghost-fill')}
          cx={p.cx}
          cy={p.cy}
          r="6"
          style={i < lit ? seq(i) : undefined}
        />
      ))}
    </g>
  )
}

/* ------------------------------ 未知 key 兜底 ------------------------------ */

/** 后端加了新奖章而前端还没配幕：画一个正在画完的圆环 + 一颗落定的点，不留空白 */
function FallbackScene() {
  return (
    <g>
      <circle className="bs-track bs-line" cx="330" cy="101" r="46" />
      <path className="bs-lit bs-line bs-anim bs-shape" d="M330 55 A46 46 0 1 1 284 101" pathLength="100" />
      <circle className="bs-lit-fill" cx="330" cy="101" r="7" />
    </g>
  )
}

const SCENES: Record<string, ComponentType<SceneProps>> = {
  first_task: StrollScene,
  five_steps: StepsScene,
  profile_shape: DirectionScene,
}
