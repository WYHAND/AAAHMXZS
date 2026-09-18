/**
 * 流式对话 hook
 *
 * 状态机：idle → connecting → streaming → done
 *                    ↘ error →（自动重试 1 次）→ template_fallback
 *
 * 读流与事件解析实现在 api/sse.ts（纯函数，store 与 hook 共用）。
 * conversationId 必填：后端只有 /chat/conversations/{id}/stream。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '@/api/client'
import { streamChat, type SSEMessage } from '@/api/sse'
import { useAuthStore } from '@/store/authStore'

export type { SSEPayload, SSEMessage } from '@/api/sse'
export { parseSSEEvent as parseSSEChunk } from '@/api/sse'

export type StreamState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'done'
  | 'error'
  | 'template_fallback'

export interface SSEHandlers {
  /** 收到 start 事件：连接建立（connecting → streaming） */
  onOpen?: (message: SSEMessage) => void
  onDelta?: (content: string, message: SSEMessage) => void
  /** 收到 tag 事件：画像变了，触发 profileStore.bumpVersion() */
  onTag?: (message: SSEMessage) => void
  /** 收到 pending 事件：幂等命中（重复提交），不是错误 */
  onPending?: (message: SSEMessage) => void
  onDone?: (message: SSEMessage) => void
  onError?: (error: ApiError) => void
  onEnd?: () => void
}

export interface StartStreamOptions extends SSEHandlers {
  /** 必填：后端路径参数是 UUID */
  conversationId: string
  content: string
  /** 前端生成的 uuid，重试时复用，供后端幂等去重 */
  clientMsgId: string
  /** 自动重试次数，默认 1 */
  retry?: number
}

export interface UseSSEResult {
  start: (options: StartStreamOptions) => Promise<void>
  stop: () => void
  streaming: boolean
  state: StreamState
  retryCount: number
}

export function useSSE(): UseSSEResult {
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const [state, setState] = useState<StreamState>('idle')
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
    }
  }, [])

  const patch = useCallback((next: StreamState) => {
    if (mountedRef.current) setState(next)
  }, [])

  /** stop() 即 ctrl.abort()：保留已收到的文本，不清空 */
  const stop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    patch('idle')
  }, [patch])

  const runOnce = useCallback(
    async (
      options: StartStreamOptions,
      signal: AbortSignal,
    ): Promise<'ok' | 'aborted'> => {
      const token = useAuthStore.getState().token
      return streamChat({
        conversationId: options.conversationId,
        content: options.content,
        clientMsgId: options.clientMsgId,
        token,
        signal,
        onOpen: (message) => {
          patch('streaming')
          options.onOpen?.(message)
        },
        onDelta: options.onDelta,
        onTag: options.onTag,
        onPending: options.onPending,
        onDone: options.onDone,
        onError: options.onError,
        onEnd: options.onEnd,
      })
    },
    [patch],
  )

  const start = useCallback(
    async (options: StartStreamOptions) => {
      const retry = options.retry ?? 1
      const ctrl = new AbortController()
      controllerRef.current = ctrl
      setRetryCount(0)
      patch('connecting')

      try {
        const result = await runOnce(options, ctrl.signal)
        if (result === 'aborted') {
          options.onEnd?.()
          return
        }
        patch('done')
      } catch (error) {
        const apiError = error instanceof ApiError ? error : new ApiError(-1, String(error))

        if (ctrl.signal.aborted) {
          options.onEnd?.()
          return
        }

        // error → 自动重试 1 次 → template_fallback
        if (retry > 0) {
          setRetryCount(1)
          patch('connecting')
          try {
            const retryResult = await runOnce({ ...options }, ctrl.signal)
            if (retryResult === 'aborted') {
              options.onEnd?.()
              return
            }
            patch('done')
            return
          } catch (retryError) {
            const finalError =
              retryError instanceof ApiError
                ? retryError
                : new ApiError(-1, String(retryError))
            patch('template_fallback')
            options.onError?.(finalError)
            return
          }
        }

        patch('error')
        options.onError?.(apiError)
      } finally {
        if (controllerRef.current === ctrl) controllerRef.current = null
      }
    },
    [patch, runOnce],
  )

  return {
    start,
    stop,
    streaming: state === 'streaming' || state === 'connecting',
    state,
    retryCount,
  }
}
