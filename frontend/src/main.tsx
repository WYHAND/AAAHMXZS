import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { router } from '@/router'

import '@/index.css'
import '@/styles/print.css'
// 注册埋点上报实现（POST /events），页面里统一调用 track()
import '@/api/events'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* 顶层 ErrorBoundary：AI 相关异常必须降级为可点击提示，不能白屏（9 工程约定） */}
    <ErrorBoundary>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </ErrorBoundary>
  </StrictMode>,
)
