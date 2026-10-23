import { Outlet, useLocation } from 'react-router-dom'

import { DesktopTitleBar } from '@/components/DesktopTitleBar'

/**
 * 空布局（设计说明书 8）
 * 用于登录 / 注册 / 面试进行中：全屏沉浸，不带侧栏与顶栏。
 *
 * `narrow`（默认 true）保留原来的 448px 居中卡片宽度（登录/注册/404 用）；
 * 传 false 时内容自己决定宽度 —— 面试进行中这类"整屏一题"的页面需要更宽的列，
 * 而不是在 1440px 屏幕上被挤成中间一条。
 *
 * 为什么还要按路径兜底（2026-10）：
 * `/interview/session` 的路由（router/index.tsx:133）写的是 `<BlankLayout />`，
 * 没地方传 `narrow={false}`，而它是**唯一**需要整幅宽度的空布局页面 ——
 * 于是 1440px 屏幕上题目被挤成中间 448px 一条、两侧各留 500px 空白。
 * 默认值仍然是 true（登录/注册一个字都没变），只有面试进行中自动放开；
 * 页面自己用 `mx-auto max-w-3xl` 决定真正的阅读宽度。
 */
export function BlankLayout({ narrow }: { narrow?: boolean }) {
  const { pathname } = useLocation()
  const wide = pathname.startsWith('/interview/session')
  const isNarrow = narrow ?? !wide

  return (
    <div className="flex min-h-svh flex-col bg-canvas">
      {/* 无边框窗口：这一条负责拖拽 + 最小化/最大化/关闭（浏览器里不渲染） */}
      <DesktopTitleBar />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className={isNarrow ? 'w-full max-w-md' : 'w-full'} data-blank-width={isNarrow ? 'md' : 'full'}>
          <Outlet />
        </div>
      </main>
      <footer
        data-print="hide"
        className="pb-6 text-center text-xs text-muted-foreground"
      >
        高校学生 AI 就业辅助系统
      </footer>
    </div>
  )
}

export default BlankLayout
