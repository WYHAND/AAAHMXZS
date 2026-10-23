import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

import { Panel } from '@/components/Panel'
import { Button } from '@/components/ui/button'

/**
 * 404 / 兜底页（设计说明书 2.1 /404、/*）
 * 公开路由：未登录用户也能看到，所以不做守卫。
 *
 * 版式（2026-10 收口，方案 A 对齐）：与登录/注册同一套骨架 —— 居中一张 `Panel`，
 * 里面是「空态」那套结构（图标圈 + 一句人话 + 动作），主按钮「回到首页」是
 * 整屏唯一 warm/lg，次动作「去成长任务」退成 ghost。
 * 用色：唯一一处暖色是图标圈的浅赭底（小面积 chip），标题与正文保持墨色。
 *
 * 为什么没有直接用 `EmptyState` 组件：本页需要**页面级**的 `<h1>`
 * （方案 A 的页面标题档 headline-xl = 30/700，与登录/注册/测评页一致），
 * 而 EmptyState 的标题是 16px 的 `<p>`。所以这里复用它的**外观**
 * （居中图标圈 + 标题 + 描述 + 动作），但把标题落成真正的 h1。
 * 若后续统一把 EmptyState 的标题改成可传的语义标签，这里可以收敛。
 *
 * 外层不再自铺底色：`BlankLayout` 已经给了 bg-canvas 与 448px 居中窄栏；
 * 390×844 下本页约 430px 高，一屏放得下、不需要滚动。
 */
export default function NotFoundPage() {
  return (
    <Panel className="mx-auto w-full gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-secondary-fixed text-on-secondary-fixed">
          <Compass className="size-5" aria-hidden />
        </span>
        <h1 className="text-headline-xl font-bold tracking-tight text-primary">这个页面不存在</h1>
        <p className="max-w-[42ch] text-body-lg text-on-surface-variant">
          可能是链接过期了，或者这个功能还没上线。回首页看看下一步该做什么。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Button variant="warm" size="lg" className="w-full" asChild>
          <Link to="/">回到首页</Link>
        </Button>
        <Button variant="ghost" size="sm" className="w-full" asChild>
          <Link to="/task">去成长任务</Link>
        </Button>
      </div>
    </Panel>
  )
}
