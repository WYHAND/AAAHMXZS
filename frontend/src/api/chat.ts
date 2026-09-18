/**
 * 对话接口 —— 路径对齐后端 app/api/v1/chat.py（prefix="/chat"）
 *
 *   POST /chat/conversations                             创建对话
 *   GET  /chat/conversations                             对话列表（裸数组）
 *   GET  /chat/conversations/{id}/messages?limit=        消息列表（裸数组，用 limit 不是 page）
 *   POST /chat/conversations/{id}/messages               发送消息（非流式完整回复）
 *   POST /chat/conversations/{id}/stream                 SSE 流式（前端正式使用，见 api/sse.ts）
 *   GET  /chat/conversations/{id}/stream?content=        调试端点，前端不调用
 *   GET  /chat/conversations/{id}/conclusion             结论卡片
 *
 * ⚠️ 没有 DELETE /chat/conversations/{id} —— 已删除对应方法。
 */

import { get, post } from '@/api/client'
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
