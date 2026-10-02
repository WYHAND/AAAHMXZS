/**
 * 流式对话：fetch + ReadableStream + TextDecoder
 *
 * 路径（后端 app/api/v1/chat.py）：
 *   POST /api/v1/chat/conversations/{conversation_id}/stream   ← 前端唯一使用
 *   GET  /api/v1/chat/conversations/{conversation_id}/stream   ← 调试用，前端不调用
 *
 * conversationId 是**必填**的：后端路径参数是 UUID，没有「无会话」的流式端点
 * （早期版本的 `/chat/stream` 兜底已删除）。
 *
 * 事件是**具名事件**，每个 data 恒为 {code,message,data} 信封，data.type 与 event: 行一致：
 *   start   data:{type:"start",conversation_id}
 *   delta   data:{type:"delta",content,conversation_id}
 *   tag     data:{type:"tag",data:{tags:[...]}}      ← 标签嵌在 data.data.tags
 *   pending data:{type:"pending",user_message_id} 或 {type:"pending",replay_message_id}
 *           或 {type:"pending",pending:true}          ← 幂等命中，不是错误
 *   done    data:{type:"done",message_id,conversation_id,conclusion_ready,...}
 *   error   data:null, code=3001/5000 等
 *   end     data:[DONE]（不要 JSON.parse）
 *
 * 为什么不用 EventSource：不能设置 Authorization header、只能 GET。
 */

import { API_BASE, ApiError } from '@/api/client'
import type { SSEPayload } from '@/types'
import { uuid } from '@/utils/format'

export type { SSEPayload }

/** 解析后的一条 SSE 消息（已解信封） */
export interface SSEMessage {
  event: string
  code: number
  message: string
  data: SSEPayload | null
}

export interface StreamHandlers {
  /** 收到 start 事件：连接建立 */
  onOpen?: (message: SSEMessage) => void
  onDelta?: (content: string, message: SSEMessage) => void
  /** 收到 tag 事件：后端从对话里抽到了新标签 */
  onTag?: (message: SSEMessage) => void
  /** 收到 pending 事件：幂等命中（重复提交），不是错误 */
  onPending?: (message: SSEMessage) => void
  onDone?: (message: SSEMessage) => void
  /** code !== 0 或 HTTP/网络失败，不静默丢弃 */
  onError?: (error: ApiError) => void
  /** 正常收流结束（end / [DONE] / 连接关闭） */
  onEnd?: () => void
}

export interface StreamChatOptions extends StreamHandlers {
  /** **必填**：后端路径参数是 UUID */
  conversationId: string
  content: string
  /** 前端生成的 uuid，重试时复用，供后端幂等去重 */
  clientMsgId: string
  token?: string | null
  signal?: AbortSignal
}

/**
 * 解析单个 SSE 事件块。
 * 返回 null 表示这一块没有可派发的内容（心跳、注释、残缺块）。
 * data 为 `[DONE]` 时返回 `{ event: 'end', code: 0, data: null }`，**不做 JSON.parse**。
 */
export function parseSSEEvent(chunk: string): SSEMessage | null {
  let eventName = 'message'
  const dataLines: string[] = []

  for (const rawLine of chunk.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (!dataLines.length) return null
  const raw = dataLines.join('\n').trim()

  // 结束哨兵：不要 JSON.parse
  if (raw === '[DONE]') {
    return { event: 'end', code: 0, message: 'done', data: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 后端若下发纯文本增量，退化为 delta，不丢内容
    return {
      event: eventName,
      code: 0,
      message: 'success',
      data: { type: 'delta', content: raw },
    }
  }

  const envelope = parsed as { code?: number; message?: string; data?: SSEPayload | null }
  const code = typeof envelope.code === 'number' ? envelope.code : 0

  // 特殊：error 事件的 data 为 null，但 code 非 0
  if (eventName === 'error' && code === 0) {
    return { event: eventName, code: 5000, message: envelope.message ?? 'AI 调用失败', data: null }
  }

  return {
    event: eventName,
    code,
    message: envelope.message ?? '',
    data: envelope.data ?? null,
  }
}

export function chatStreamPath(conversationId: string): string {
  return `/chat/conversations/${conversationId}/stream`
}

/**
 * 执行一次流式对话请求。
 * 正常结束返回 'ok'；用户 abort 返回 'aborted'；其余情况抛 ApiError（由调用方决定重试 / 降级）。
 */
export async function streamChat(options: StreamChatOptions): Promise<'ok' | 'aborted'> {
  const {
    conversationId,
    content,
    clientMsgId,
    token,
    signal,
    onOpen,
    onDelta,
    onTag,
    onPending,
    onDone,
    onError,
    onEnd,
  } = options

  let res: Response
  try {
    res = await fetch(`${API_BASE}${chatStreamPath(conversationId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content, client_msg_id: clientMsgId || uuid() }),
      signal,
    })
  } catch {
    if (signal?.aborted) return 'aborted'
    const error = new ApiError(-2, '网络不太好，稍后再试')
    onError?.(error)
    throw error
  }

  if (!res.ok) {
    // 失败响应也带信封：401/403/404/400/500
    let code = res.status
    let message = `流式请求失败（HTTP ${res.status}）`
    try {
      const body = (await res.json()) as { code?: number; message?: string }
      if (typeof body?.code === 'number') code = body.code
      if (body?.message) message = body.message
    } catch {
      /* body 不是 JSON，保留 HTTP 文案 */
    }
    const error = new ApiError(code, message)
    onError?.(error)
    throw error
  }

  if (!res.body) {
    const error = new ApiError(-3, '当前浏览器不支持流式响应')
    onError?.(error)
    throw error
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  let ended = false

  const dispatch = (message: SSEMessage): boolean => {
    // 先解信封：code !== 0 走错误分支，不静默丢弃
    if (message.code !== 0) {
      const error = new ApiError(
        message.code,
        message.message || 'AI 暂时忙不过来，请稍后再试',
      )
      onError?.(error)
      throw error
    }

    const type = message.data?.type ?? message.event
    switch (type) {
      case 'start':
        onOpen?.(message)
        return false
      case 'delta':
        if (message.data?.content) onDelta?.(message.data.content, message)
        return false
      case 'tag':
        onTag?.(message)
        return false
      case 'pending':
        // 幂等命中：忽略本次流，等待上一轮结果（后端会立刻补 end）
        onPending?.(message)
        return false
      case 'done':
        onDone?.(message)
        return false
      case 'end':
        ended = true
        onEnd?.()
        return true
      default:
        // 未知事件名但带了 delta 文本时也不要丢
        if (message.data?.content) onDelta?.(message.data.content, message)
        return false
    }
  }

  try {
    while (!ended) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        const message = parseSSEEvent(part)
        if (!message) continue
        if (dispatch(message)) break
      }
    }

    // 冲刷残留缓冲（最后一个事件可能没有结尾空行）
    if (!ended && buf.trim()) {
      const message = parseSSEEvent(buf)
      if (message) dispatch(message)
    }
    // 服务端直接关闭连接、没发 end 事件时，也算正常收流结束
    if (!ended) onEnd?.()
  } catch (error) {
    if (signal?.aborted) return 'aborted'
    if (error instanceof ApiError) throw error
    const interrupted = new ApiError(-2, '回答中断，请点击重试')
    onError?.(interrupted)
    throw interrupted
  }

  return 'ok'
}
