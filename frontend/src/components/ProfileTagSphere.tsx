import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import TagCloud from '@/vendor/TagCloud.js'
import type { TagCloudInstance } from '@/vendor/TagCloud.js'
import { cn } from '@/lib/utils'
import type { SphereLabel } from '@/utils/profileDisplay'

/**
 * 「我的画像」中间那颗标签球（勘误 9.24.4，2026-10-22 新用户可见性修订）。
 *
 * 三件必须做对的事：
 *
 * 1. **卸载要销毁**：TagCloud 会往容器里追加一个 div 并自己开 requestAnimationFrame，
 *    不清就是"离开页面还在转"（内存与 CPU 一起漏）。
 * 2. **`prefers-reduced-motion` 要暂停**：仓库本来就有"reduce → 全部关闭"这条纪律
 *    （index.css:582）。球这种持续旋转尤其要停 —— 上游自带 `pause()`，用它。
 * 3. **半径要量出来**：TagCloud 构造时把容器写成 `2*radius` 见方，且**不响应缩放**，
 *    所以尺寸一变就得重建 —— 用 `ResizeObserver` 量出半径，交给 effect 当依赖。
 *
 * 球只负责"感觉"，不负责"读"（背面看不见、一直在转、很难点中）——
 * 可读的那份在卡片下方的分组列表里，两处用的是同一份已排序标签。
 *
 * 2026-10-22 修订：**新用户也必须看到球**。标签少时不再整颗隐藏，而是由
 * `utils/profileDisplay.sphereLabels` 补上"还没聊到的维度名"（`ghost: true`），
 * 用浅色细字画在球上；真实标签是实心粗字。真实标签越多字号越小，骨架越少。
 * 幽灵字只是骨架：不写回画像、不算标签数、不进 AI 输入（见 profileDisplay 的说明）。
 * ⚠️ 球体整体 `aria-hidden`：屏幕阅读器读下方那份可读列表，不读球上的装饰字。
 */

/** 真实标签数 → 字号（越少越大，让稀疏的球也撑得住；多了回到常规 14px） */
function labelFontSize(realCount: number): number {
  if (realCount <= 3) return 22
  if (realCount <= 7) return 19
  if (realCount <= 11) return 16
  return 14
}

/**
 * 幽灵字（维度名）的字号。
 *
 * - 0 条真实标签时，六个维度名就是球的全部内容，用 20px —— 太小会显得像"没加载出来"；
 * - 有真实标签时，幽灵字比真实标签小两档，明确退到背景里。
 * 不用 `text-body-sm` 之类的类名 —— 这些字是 `useHTML` 塞进球里的，
 * 内联样式最稳，也不会被外层 item 的字体类盖掉。
 */
function ghostFontSize(realCount: number): number {
  if (realCount === 0) return 20
  return Math.max(12, labelFontSize(realCount) - 6)
}

/** TagCloud 走 `useHTML` 时必须自己转义：标签来自 AI/用户，不能当 HTML 执行 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

/** 一条球面文字：实心真实标签 / 浅色维度骨架 */
function labelHtml(item: SphereLabel, realCount: number): string {
  if (!item.ghost) {
    return `<span style="font-weight:600;font-size:${labelFontSize(realCount)}px">${escapeHtml(item.text)}</span>`
  }
  return (
    `<span style="font-weight:500;font-size:${ghostFontSize(realCount)}px;` +
    `letter-spacing:.08em;color:var(--on-surface-variant);opacity:.7">${escapeHtml(item.text)}</span>`
  )
}

export function ProfileTagSphere({
  labels,
  className,
}: {
  labels: readonly SphereLabel[]
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<TagCloudInstance | null>(null)
  const reduce = useReducedMotion()
  const [radius, setRadius] = useState(0)

  // 用拼接串当依赖：labels 每次渲染都是新数组，直接当依赖会无限重建。
  // 分隔符用不可能出现在标签里的 NUL，避免标签本身含分隔符时被切坏。
  // `r:` / `g:` 前缀把"真实标签"和"幽灵字"一起编进 key —— 任一项变化都要重建。
  const labelsKey = labels.map((item) => `${item.ghost ? 'g' : 'r'}:${item.text}`).join('\u0000')
  // 真实标签数决定字号与转速；标签变了它才会变，和 labelsKey 同步。
  const realCount = labels.reduce((count, item) => (item.ghost ? count : count + 1), 0)

  // 量容器。TagCloud 的容器是 `2*radius` 见方，而球面可视半径只有 `0.75*radius`
  // （它内部把布点坐标乘了 size/2，size = 1.5*radius）。所以要让**球面**填满这块地方，
  // radius 要取 `短边 / 2 / 0.75`；再乘 0.8 留余量 —— 标签是**以点为中心**画的，
  // 边缘那几个会各向外探出半个字宽，而深度大的还会被放大到 1.33 倍，
  // 不留余量就会压到下面的分隔线（实测截图确认过）。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const measure = () => {
      const side = Math.min(host.clientWidth, host.clientHeight)
      setRadius(side > 0 ? Math.floor((side / 2 / 0.75) * 0.8) : 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // 建 / 重建实例
  useEffect(() => {
    const host = hostRef.current
    if (!host || !radius || !labelsKey) return
    const entries = labelsKey.split('\u0000').map((entry) => ({
      ghost: entry.startsWith('g:'),
      text: entry.slice(2),
    }))
    const instance = TagCloud(
      host,
      entries.map(({ ghost, text }) => labelHtml({ text, ghost }, realCount)),
      {
        radius,
        // 标签少时降速：稀疏的球转快了会像"散点乱飞"，慢下来才像一颗正在成形的星球。
        // 2026-10-17 用户验收的 `normal` 仍然是标签充足时的默认速度。
        maxSpeed: realCount < 8 ? 'slow' : 'normal',
        initSpeed: realCount < 8 ? 'slow' : 'normal',
        direction: 135,
        // keep:true = 鼠标移出球体后仍然跟手，就是预览里那种"甩一下还会顺着转"的手感。
        // ⚠️ 它要求上游把 mousemove 挂在 **window** 上，而上游的 destroy() 不摘监听 ——
        // 所以内联文件里补了具名引用 + `_off()`（见 vendor/README.md 的内联改动 4）。
        keep: true,
        useItemInlineStyles: true, // 定位依赖它，不要关
        // 幽灵字需要单独的字重 / 颜色，只能走 HTML 片段；真实标签已转义。
        useHTML: true,
        itemClass: 'profile-sphere-item',
      },
    )
    instanceRef.current = instance
    return () => {
      // 先 pause 再 destroy：双保险（上游 destroy 现在也会 cancelAnimationFrame，
      // 见 vendor/README.md 的内联改动 3）
      instance.pause()
      instance.destroy()
      instanceRef.current = null
    }
  }, [labelsKey, radius, realCount])

  // 暂停 / 恢复（声明顺序在"建实例"之后，所以同一次渲染里实例已经在了）
  useEffect(() => {
    const instance = instanceRef.current
    if (!instance) return
    if (reduce) instance.pause()
    else instance.resume()
  }, [reduce, labelsKey, radius])

  // ⚠️ 这里**必须自己当居中容器**：TagCloud 往这个 div 里插的是它自己的
  // `2*radius` 方块，而那个方块是**普通流内的 div**。父级不给居中，它就从
  // **左上角**开始铺，球心落在 (radius, radius) 处 —— 看上去整体偏左上，
  // 而不是待在框中间（实测截图确认）。用 flex 居中，方块比框大时也会两边均分。
  //
  // aria-hidden：球是装饰，可读信息在下面的分组列表里；不这样会让读屏器把
  // 六维骨架当成"用户的标签"念出来。
  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={cn('flex items-center justify-center', className)}
    />
  )
}

