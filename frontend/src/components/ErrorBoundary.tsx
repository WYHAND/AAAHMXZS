import { Component, type ErrorInfo, type ReactNode } from 'react'

import { AppErrorFallback } from '@/components/AppErrorFallback'

/**
 * 顶层 / 路由级错误边界（设计说明书 9：AI 相关异常必须降级为可点击提示，不能白屏）
 *
 * 说明：这里只负责"捕获"，界面交给 `AppErrorFallback`（**全站最后一道网的那份 UI**）。
 * 路由树内部的崩溃由 `router/index.tsx` 路由根上的 errorElement 兜（同一个 UI），
 * 这个类边界兜的是路由之外的东西（例如 RouterProvider 本身、Toaster）。
 */
interface Props {
  children: ReactNode
  /** 覆盖兜底文案（保留给历史调用方；当前只有 main.tsx 使用默认值） */
  fallbackTitle?: string
  onReset?: () => void
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private handleReset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    // 不再把 error.message（英文堆栈）渲染给用户：只进 console，用户看人话
    return <AppErrorFallback error={error} title={this.props.fallbackTitle} onRetry={this.handleReset} />
  }
}
