import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import TagCloud from '@/vendor/TagCloud.js'
import type { TagCloudInstance } from '@/vendor/TagCloud.js'
import { cn } from '@/lib/utils'

/**
 * 「我的画像」中间那颗标签球（勘误 9.24.4）。
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
 */
export function ProfileTagSphere({ labels, className }: { labels: string[]; className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<TagCloudInstance | null>(null)
  const reduce = useReducedMotion()
  const [radius, setRadius] = useState(0)

  // 用拼接串当依赖：labels 每次渲染都是新数组，直接当依赖会无限重建。
  // 分隔符用不可能出现在标签里的 NUL，避免标签本身含分隔符时被切坏。
  const labelsKey = labels.join('\u0000')

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
    const instance = TagCloud(host, labelsKey.split('\u0000'), {
      radius,
      // 2026-10-17 用户验收后调快：`slow`(0.5×) 太温吞，`normal`(1×) 正是预览里的观感。
      // 这两个值同时决定"空转速度"与"跟手时的转向速度"（想更快就再改成 'fast'）。
      maxSpeed: 'normal',
      initSpeed: 'normal',
      direction: 135,
      // keep:true = 鼠标移出球体后仍然跟手，就是预览里那种"甩一下还会顺着转"的手感。
      // ⚠️ 它要求上游把 mousemove 挂在 **window** 上，而上游的 destroy() 不摘监听 ——
      // 所以内联文件里补了具名引用 + `_off()`（见 vendor/README.md 的内联改动 4）。
      keep: true,
      useItemInlineStyles: true, // 定位依赖它，不要关
      itemClass: 'profile-sphere-item',
    })
    instanceRef.current = instance
    return () => {
      // 先 pause 再 destroy：双保险（上游 destroy 现在也会 cancelAnimationFrame，
      // 见 vendor/README.md 的内联改动 3）
      instance.pause()
      instance.destroy()
      instanceRef.current = null
    }
  }, [labelsKey, radius])

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
  return <div ref={hostRef} className={cn('flex items-center justify-center', className)} />
}
