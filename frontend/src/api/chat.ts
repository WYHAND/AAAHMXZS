/**
 * 对话接口 —— 路径对齐后端 app/api/v1/chat.py（prefix="/chat"）
 *
 *   POST   /chat/conversations                           创建对话
 *   GET    /chat/conversations                           对话列表（裸数组）
 *   DELETE /chat/conversations/{id}                      删除对话
 *   GET    /chat/conversations/{id}/messages?limit=      消息列表（裸数组，用 limit 不是 page）
 *   POST   /chat/conversations/{id}/messages             发送消息（非流式，**SSE 的兜底**）
 *   POST   /chat/conversations/{id}/stream               发送消息（SSE 流式，前端首选）
 *   POST   /chat/conversations/{id}/opening              AI 主动开场白（幂等，见下）
 *
 * SSE 契约（后端 `_to_sse_payload`，解析见本文件 streamMessage）：
 *   每帧 `event: <type>` + `data: {"code","message","data":{"type":...}}`，
 *   流末尾固定一帧 `event: end` + `data: [DONE]`。type 取值：
 *     start / status（生成阶段：reading / thinking / writing）
 *     / delta（回复正文片段）/ tag（画像标签回流）
 *     / done / pending（幂等命中）/ error（信封层，data 为 null）
 *   ⚠️ 后端的 error 事件**之后仍可能补 done**（例如「AI 中断，已切换兜底话术」时
 *   先发兜底正文再发 error，然后照常落库并 done），所以 error 只记录、不终止流。
 *   ⚠️ 未知 type（例如后端将来新增的展示类事件）一律忽略，不当作错误。
 *
 * DELETE 契约（后端新增）：需登录；成功 → HTTP 200 + {code:0,message:"success",data:null}；
 * 会话不存在 / 不属于当前用户 → HTTP 404 + {code:2001}（前端映射成「内容不存在」）。
 *
 * OPENING 契约（后端新增，产品「AI 主动挖掘」的入口）：
 *   → ApiResponse[MessageResponse]，即**一条** role=assistant 的开场消息（不是数组）。
 *   **幂等**：会话已有任何消息时不重复生成，直接返回已有的那条 —— 因此前端
 *   重复调用是安全的，但仍应用 chatStore 里的去重标记避免并发重复请求。
 *   后端 AI 失败时有模板兜底，**不会报错**；只有「后端还没上线该路由」这类情况才会 404，
 *   那时前端回落到静态提示（见 ChatPage 的空态分支）。
 */

import { API_BASE, client, get, getAuthToken, post } from '@/api/client'
import { getApiKeyHeaders } from '@/lib/apiKeys'
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamDoneEvent,
  ChatStreamPendingEvent,
  ChatStreamStartEvent,
  ChatStreamStatusEvent,
  Conversation,
  ListPayload,
} from '@/types'

export const chatApi = {
  listConversations: () => get<ListPayload<Conversation>>('/chat/conversations'),

  createConversation: (payload?: { title?: string }) =>
    post<Conversation>('/chat/conversations', payload ?? {}),

  /**
   * 删除会话。
   *
   * client.ts 刻意没有 del 助手（见那里的注释：原先后端没有任何 DELETE 路由），
   * 所以这里直接调 client.delete，把 silent 当成请求配置传进去。
   * 拦截器已把信封解开 → 这里拿到的是 data(null)。
   * silent：失败提示统一由 chatStore.deleteConversation 负责（它还要保证
   * 「失败就一个字节都不改列表」），交给拦截器会变成两个 toast。
   */
  deleteConversation: (id: string) =>
    client.delete(`/chat/conversations/${id}`, { silent: true }) as unknown as Promise<null>,

  /** 后端用 limit（1-500），没有 page/page_size */
  listMessages: (conversationId: string, limit = 100) =>
    get<ListPayload<ChatMessage>>(`/chat/conversations/${conversationId}/messages`, {
      params: { limit },
    }),

  /** 发送一句话，AI 整条回复生成完才返回（期间前端显示加载动画） */
  sendMessage: (conversationId: string, payload: ChatRequest) =>
    post<ChatResponse>(`/chat/conversations/${conversationId}/messages`, payload),

  /**
   * 发送一句话（SSE 流式）：正文逐块回调，流结束才 resolve。
   *
   * ⚠️ 失败语义见 ChatStreamError：`started === false` 才是「请求本身失败」，
   * 调用方（chatStore.send）据此回退到 sendMessage；流已经建立后失败由调用方
   * 把已有正文标成「回答中断，点击重试」，**不**自动重发。
   */
  streamMessage: streamMessage,

  /**
   * AI 主动开场白：让 AI 在新对话里**先开口**，而不是等用户先说话。
   *
   * 幂等（后端保证）：会话已有任何消息时返回已有的那条，不会生成第二条。
   * silent：调用方（chatStore.ensureOpening）有自己的失败降级路径 ——
   * 失败时要安静地回落到静态空态，**不能**弹一个用户看不懂的全局报错 toast。
   */
  opening: (conversationId: string) =>
    post<ChatMessage>(
      `/chat/conversations/${conversationId}/opening`,
      undefined,
      { silent: true },
    ),
}

/* =============================== SSE 流式对话 ===============================
 *
 * 为什么用 fetch 而不是 axios：SSE 需要**逐块**读响应体（ReadableStream），
 * axios 在浏览器端要等整份响应回来才 resolve。EventSource 也不行 —— 它带不了
 * Authorization 头和 JSON body（后端因此把 POST /stream 做成了前端正式入口）。
 * 代价是绕过了 axios 拦截器，所以这里自己取 token、自己解信封。
 */

/**
 * SSE 建流前/流中断的失败。
 *
 * `started` 是**唯一**决定调用方能否回退的关键：
 *   - `false`：HTTP 非 2xx / fetch 直接抛错 / 连一帧都没读到。
 *     此时没有产生任何正文，调用方可以安全地用同一个 client_msg_id 回退到
 *     POST /messages（后端幂等去重），用户体验与改动前一致。
 *   - `true`：流已经建立过（读到过至少一帧）。**绝不能**自动重发 ——
 *     模型可能已经在生成/已经落库，重发会重复调用与重复上屏。
 *     调用方应把已收到的正文标成「回答中断，点击重试」。
 */
export class ChatStreamError extends Error {
  started: boolean
  /** 后端信封里的 error code（HTTP 层失败时没有） */
  code?: number

  constructor(message: string, started: boolean, code?: number) {
    super(message)
    this.name = 'ChatStreamError'
    this.started = started
    this.code = code
  }
}

/** streamMessage 的回调集合：正文逐块回调 */
export interface ChatStreamHandlers {
  onStart?: (event: ChatStreamStartEvent) => void
  /**
   * 生成阶段（reading / thinking / writing）。
   * ⚠️ 只有阶段文案与已用时间，**没有**模型思维链原文 —— 前端只拿来显示"在干什么"。
   */
  onStatus?: (event: ChatStreamStatusEvent) => void
  /** 回复正文片段 */
  onDelta?: (content: string) => void
  /** 画像标签回流（数组形状与后端 tag 事件一致） */
  onTag?: (tags: Record<string, unknown>[]) => void
  onDone?: (event: ChatStreamDoneEvent) => void
  /** 幂等命中；调用方按现有非流式路径处理（见 ChatStreamPendingEvent） */
  onPending?: (event: ChatStreamPendingEvent) => void
  /** 信封层 error（data 为 null）。⚠️ 它**不代表流结束**，可能之后还有 done */
  onError?: (code: number, message: string) => void
}

/** 一帧的 data 恒是这个信封；这里只做最小校验，不引入业务分支 */
interface SseEnvelope {
  code?: number
  message?: string
  data?: unknown
}

/**
 * 解析一个 SSE 块（帧）：取出 `event:` 名与拼接后的 `data:` 原文。
 * 兼容 `:` 注释行、字段名后带/不带空格、以及多行 data。
 */
export function parseSseFrame(frame: string): { event: string; data: string } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const raw of frame.split(/\r?\n/)) {
    if (!raw || raw.startsWith(':')) continue
    const colon = raw.indexOf(':')
    const field = colon === -1 ? raw : raw.slice(0, colon)
    let value = colon === -1 ? '' : raw.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }
  if (!dataLines.length) return null
  return { event, data: dataLines.join('\n') }
}

/**
 * 按空行（`\n\n` / `\r\n\r\n`）切分 SSE 缓冲：
 * 返回**已经完整**的帧与本轮末尾**仍然不完整**的残留缓冲（留给下一个 chunk 拼接）。
 */
export function takeSseFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = []
  let rest = buffer
  for (;;) {
    const match = /\r?\n\r?\n/.exec(rest)
    if (!match) break
    frames.push(rest.slice(0, match.index))
    rest = rest.slice(match.index + match[0].length)
  }
  return { frames, rest }
}

/** HTTP 非 2xx 时尽量用信封里的 message（后端失败也返回同一个信封） */
async function readHttpError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as unknown
    if (body && typeof body === 'object' && typeof (body as SseEnvelope).message === 'string') {
      return (body as SseEnvelope).message as string
    }
  } catch {
    // 不是 JSON（HTML 错误页等）：用状态码兜底
  }
  return `HTTP ${response.status}`
}

/**
 * 消费 `POST /chat/conversations/{id}/stream`。
 *
 * 返回值不携带正文 —— 正文通过 handlers 逐块交给调用方，避免在这里
 * 复制一份「拼接结果」这种必然与回调状态不一致的副本。
 */
export async function streamMessage(
  conversationId: string,
  payload: ChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAuthToken()
  const response = await fetch(`${API_BASE}/chat/conversations/${conversationId}/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...getApiKeyHeaders(),
    },
    body: JSON.stringify(payload),
    signal,
  })

  if (!response.ok) {
    throw new ChatStreamError(await readHttpError(response), false)
  }
  if (!response.body) {
    // 极老浏览器：拿不到 ReadableStream，交调用方回退非流式
    throw new ChatStreamError('当前浏览器不支持流式响应', false)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  /** 是否读到过至少一帧（决定失败能否回退，见 ChatStreamError） */
  let started = false
  let finished = false
  let errorCode: number | undefined
  let errorMessage: string | undefined

  const dispatch = (frame: string) => {
    const parsed = parseSseFrame(frame)
    if (!parsed) return
    const { event, data } = parsed
    // 流末尾的服务端收尾帧：不是业务事件
    if (event === 'end' || data === '[DONE]') return

    let envelope: SseEnvelope
    try {
      envelope = JSON.parse(data) as SseEnvelope
    } catch {
      return
    }
    if (!envelope || typeof envelope !== 'object') return

    // 信封层错误（data 为 null）：只记录，不终止 —— 后端可能随后照常补 done
    if (typeof envelope.code === 'number' && envelope.code !== 0) {
      started = true
      errorCode = envelope.code
      errorMessage = envelope.message
      handlers.onError?.(envelope.code, envelope.message ?? 'AI 回复中断')
      return
    }

    const body = (envelope.data ?? {}) as Record<string, unknown>
    // 分派优先用 data.type（与 API 文档一致），退到 SSE 的 event 行
    const type = typeof body.type === 'string' ? body.type : event

    switch (type) {
      case 'start':
        started = true
        handlers.onStart?.({
          type: 'start',
          conversation_id:
            typeof body.conversation_id === 'string' ? body.conversation_id : conversationId,
        })
        break
      case 'status': {
        /*
         * 阶段帧 = 流已经建立（prepare_stream 之后才会下发），所以 started 置真：
         * 若此后连接断掉，调用方不能再自动回退重发（那会重复调用模型）。
         * 未知 stage 一律忽略，不当作错误，也不影响正文。
         */
        started = true
        const stage = body.stage
        if (stage === 'reading' || stage === 'thinking' || stage === 'writing') {
          handlers.onStatus?.({
            type: 'status',
            stage,
            text: typeof body.text === 'string' ? body.text : '',
            elapsed_ms:
              typeof body.elapsed_ms === 'number' && Number.isFinite(body.elapsed_ms)
                ? body.elapsed_ms
                : 0,
          })
        }
        break
      }
      case 'delta': {
        started = true
        const content = typeof body.content === 'string' ? body.content : ''
        if (content) handlers.onDelta?.(content)
        break
      }
      case 'tag': {
        const tags = (body.data as { tags?: unknown } | undefined)?.tags
        handlers.onTag?.(Array.isArray(tags) ? (tags as Record<string, unknown>[]) : [])
        break
      }
      case 'pending': {
        started = true
        handlers.onPending?.({
          type: 'pending',
          client_msg_id: typeof body.client_msg_id === 'string' ? body.client_msg_id : undefined,
          user_message_id:
            typeof body.user_message_id === 'string' ? body.user_message_id : undefined,
          replay_message_id:
            typeof body.replay_message_id === 'string' ? body.replay_message_id : undefined,
          pending: body.pending === true,
        })
        break
      }
      case 'done': {
        started = true
        finished = true
        handlers.onDone?.({
          type: 'done',
          message_id: typeof body.message_id === 'string' ? body.message_id : '',
          conversation_id:
            typeof body.conversation_id === 'string' ? body.conversation_id : conversationId,
        })
        break
      }
      default:
        break
    }
  }

  try {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = takeSseFrames(buffer)
        buffer = rest
        for (const frame of frames) dispatch(frame)
        // 收到 done 就收工：后面的 end 帧没有业务价值
        if (finished) break
      }
      // flush 解码器里最后几字节，处理"最后一帧没有空行结尾"的脏情况
      buffer += decoder.decode()
      if (!finished && buffer.trim()) dispatch(buffer)
    } catch (readError) {
      // 用户/重置主动中止：原样抛出，调用方靠 error.name === 'AbortError' 识别
      if (readError instanceof Error && readError.name === 'AbortError') throw readError
      /*
       * 读流期间的任何异常（连接被掐断、解码失败…）都归一成 ChatStreamError。
       * started 保留真实值：已经读过事件的流绝不能被调用方当成"可安全回退"，
       * 否则会拿同一个 client_msg_id 再发一次 → 重复生成。
       */
      throw new ChatStreamError(
        readError instanceof Error ? readError.message : '回答中断',
        started,
        errorCode,
      )
    }
  } finally {
    // 释放底层连接（正常读完时是 no-op；done 后提前 break 时才是必要的）
    await reader.cancel().catch(() => {})
  }

  if (!finished) {
    // 流没走到 done：可能是 error 事件收尾，也可能连接被掐断。
    // started=true ⇒ 调用方不自动重发，把已收到的正文标成中断
    throw new ChatStreamError(errorMessage ?? '回答中断', started, errorCode)
  }
}
