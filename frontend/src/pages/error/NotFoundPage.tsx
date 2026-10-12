import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

import { Panel } from '@/components/Panel'
import { Button } from '@/components/ui/button'

/**
 * 404 / 兜底页（设计说明书 2.1 /404、/*）
 * 公开路由：未登录用户也能看到，所以不做守卫。
 *
 * 版式（2026-10 收口）：与登录/注册同一套骨架 —— 卡片用 `Panel`（白底 + 12px 圆角 +
 * 极轻阴影，不画可见描边），标题是真 `<h1>`（26/700），
 * 主按钮「回到首页」是整屏唯一的 warm/lg（规格同登录页：rounded-xl + 15px/600），
 * 「和 AI 聊聊」退成 ghost。
 * 外层不再自铺底色：`BlankLayout` 已经给了 `bg-canvas`，这里再包一层只会写出重复的壳。
 */
export default function NotFoundPage() {
  return (
    <Panel>
      <div className="flex flex-col gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-secondary-fixed text-on-secondary-fixed">
          <Compass className="size-4" aria-hidden />
        </span>
        <h1 className="text-headline-xl font-bold text-primary">这个页面不存在</h1>
        <p className="text-body-md text-on-surface-variant">
          链接可能写错了，或者这个功能还没上线。回首页看看下一步该做什么。
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <Button
          variant="warm"
          size="lg"
          className="w-full rounded-xl text-[15px] font-semibold"
          asChild
        >
          <Link to="/">回到首页</Link>
        </Button>
        <Button variant="ghost" className="w-full" asChild>
          <Link to="/chat">和 AI 聊聊我现在的情况</Link>
        </Button>
      </div>
    </Panel>
  )
}
