import { useEffect } from 'react'
import { useRouteError } from 'react-router-dom'

import { Button } from '@/components/ui/button'

/**
 * 全站错误兜底 UI —— 「最后一道网」。
 *
 * 为什么必须有这一层：任何一个页面组件在渲染时抛异常，React 会卸载整棵树，
 * 用户看到的就是一片白屏（或者 React Router 默认那个英文的
 * "Unexpected Application Error!" + "Hey developer 👋" 页面，
 * 对中文用户来说等于"这软件坏了"）。
 *
 * 两件刻意的设计：
 * 1. **文案是人话，错误详情只进 console**：英文堆栈是给开发者看的，
 *    不该出现在用户面前。用户只需要知道"不是你操作错了，可以再来一次"。
 * 2. **只有一个地方的 UI**：'components/ErrorBoundary.tsx'（类组件边界）与
 *    'router/index.tsx' 的路由根 errorElement 都渲染这个组件，
 *    全站不会出现两套长得不一样的报错页。
 *
 * 用色一律走语义 token（bg-card / border / text-muted-foreground），
 * 不写 Tailwind 默认色板类。
 */

interface AppErrorFallbackProps {
  /** 只是为了在开发时写进 console；**不渲染给用户** */
  error?: unknown
  /**
   * 传入时显示「重试」（原地重置边界状态，不刷新页面）。
   * 不传时显示「重新加载」（window.location.reload()）。
   */
  onRetry?: () => void
  /** 覆盖第一句人话（历史调用方用；默认那句就是给用户的固定文案） */
  title?: string
}

/** 兜底页本体（纯展示，不知道错误从哪来） */
export function AppErrorFallback({ error, onRetry, title }: AppErrorFallbackProps) {
  useEffect(() => {
    // 用户看不到堆栈，但开发者要能看到：只往 console 打
    if (error !== undefined && error !== null) console.error('[AppErrorFallback]', error)
  }, [error])

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-card">
        <h1 className="text-base font-semibold text-foreground">
          {title?.trim() || '这个页面出了点问题，我先把它停在这儿。'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          不是你操作错了：页面自己撞到了没预料到的情况，你刚填的东西可能没保存上。
          点「{onRetry ? '重试' : '重新加载'}」再来一次；要是一直这样，先回首页，从别的入口进去。
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button variant="warm" onClick={onRetry}>
              重试
            </Button>
          ) : (
            <Button variant="warm" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          )}
          <Button variant="outline" asChild>
            <a href="/">返回首页</a>
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * React Router v7 路由树的兜底元素 —— 全站**唯一**一处 route errorElement。
 *
 * 挂在 'router/index.tsx' 最外层那个（无 path 的）根路由上：
 * 数据路由里，子路由渲染 / loader 抛出的错误会向上冒到最近的 errorElement，
 * 所以这一处就兜住了 /resume、/chat、/task 等所有页面，不需要每页各写一份。
 * 没有它的话，React Router 会用自带的默认错误页（英文 + "Hey developer 👋"）。
 */
export function RouteErrorFallback() {
  const error = useRouteError()
  return <AppErrorFallback error={error} />
}
