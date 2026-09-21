/**
 * 对话接口 —— 路径对齐后端 app/api/v1/chat.py（prefix="/chat"）
 *
 *   POST   /chat/conversations                           创建对话
 *   GET    /chat/conversations                           对话列表（裸数组）
 *   DELETE /chat/conversations/{id}                      删除对话
 *   GET    /chat/conversations/{id}/messages?limit=      消息列表（裸数组，用 limit 不是 page）
 *   POST   /chat/conversations/{id}/messages             发送消息（非流式完整回复）
 *   POST   /chat/conversations/{id}/stream               SSE 流式（前端正式使用，见 api/sse.ts）
 *   GET    /chat/conversations/{id}/stream?content=      调试端点，前端不调用
 *   GET    /chat/conversations/{id}/conclusion           结论卡片
 *
 * DELETE 契约（后端新增）：需登录；成功 → HTTP 200 + {code:0,message:"success",data:null}；
 * 会话不存在 / 不属于当前用户 → HTTP 404 + {code:2001}（前端映射成「内容不存在」）。
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
   * 所以这里按 resumeApi.downloadFile 的先例直接用 client.delete。
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

  conclusion: (conversationId: string) =>
    get<ChatConclusionCard>(`/chat/conversations/${conversationId}/conclusion`),
}
