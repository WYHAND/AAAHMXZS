import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { ERROR_CODE, errorText } from '@/constants/errorCode'

/**
 * 顶层 / 路由级错误边界（设计说明书 9：AI 相关异常必须降级为可点击提示，不能白屏）
 */
interface Props {
  children: ReactNode
  /** 覆盖兜底文案 */
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

    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-card">
          <h1 className="text-base font-semibold text-foreground">
            {this.props.fallbackTitle ?? errorText(ERROR_CODE.SERVER_ERROR)}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            页面渲染时出错了。可以重试，或先回到首页。
          </p>
          {import.meta.env.DEV ? (
            <pre className="mt-3 max-h-32 overflow-auto rounded-md bg-secondary p-2 text-left text-xs text-muted-foreground">
              {error.message}
            </pre>
          ) : null}
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" onClick={this.handleReset}>
              重试
            </Button>
            <Button variant="warm" asChild>
              <a href="/">回到首页</a>
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
