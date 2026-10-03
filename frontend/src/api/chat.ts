/**
 * 对话接口 —— 路径对齐后端 app/api/v1/chat.py（prefix="/chat"）
 *
 *   POST   /chat/conversations                           创建对话
 *   GET    /chat/conversations                           对话列表（裸数组）
 *   DELETE /chat/conversations/{id}                      删除对话
 *   GET    /chat/conversations/{id}/messages?limit=      消息列表（裸数组，用 limit 不是 page）
 *   POST   /chat/conversations/{id}/messages             发送消息（非流式完整回复）
 *   POST   /chat/conversations/{id}/opening              AI 主动开场白（幂等，见下）
 *   POST   /chat/conversations/{id}/stream               SSE 流式（前端正式使用，见 api/sse.ts）
 *   GET    /chat/conversations/{id}/stream?content=      调试端点，前端不调用
 *   GET    /chat/conversations/{id}/conclusion           结论卡片
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

import { client, get, post } from '@/api/client'
import type {
  ChatConclusionCard,
  ChatMessage,
  ChatRequest,
  ChatResponse,
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

  /** 非流式发送：流式不可用时的降级路径 */
  sendMessage: (conversationId: string, payload: ChatRequest) =>
    post<ChatResponse>(`/chat/conversations/${conversationId}/messages`, payload),

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

  conclusion: (conversationId: string) =>
    get<ChatConclusionCard>(`/chat/conversations/${conversationId}/conclusion`),
}
