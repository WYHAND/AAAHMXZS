import { RouterProvider } from 'react-router-dom'

import { router } from '@/router'

/**
 * App（设计说明书 8 目录结构）
 *
 * 顶层装配（ErrorBoundary / Toaster / TooltipProvider）在 main.tsx；
 * 这里保留可独立复用的应用外壳，便于 Electron 渲染层或测试直接挂载。
 */
export default function App() {
  return <RouterProvider router={router} />
}
