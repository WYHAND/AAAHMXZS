import { Outlet } from 'react-router-dom'

/**
 * 空布局（设计说明书 8）
 * 用于登录 / 注册 / 面试进行中：全屏沉浸，不带侧栏与顶栏。
 */
export function BlankLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
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
