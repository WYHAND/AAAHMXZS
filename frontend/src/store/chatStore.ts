import { create } from 'zustand'
import { toast } from 'sonner'

import { chatApi } from '@/api/chat'
import { ApiError } from '@/api/client'
import { streamChat, type SSEMessage } from '@/api/sse'
import { useAuthStore } from '@/store/authStore'
import { useProfileStore } from '@/store/profileStore'
import type { ChatConclusionCard, ChatMessage, Conversation, StreamState } from '@/types'
import { uuid } from '@/utils/format'
import { normalizeList } from '@/utils/list'
import { track } from '@/utils/track'

/**
 * chatStore（4.1 / 4.3 + 后端 SSE 契约）
 *
 * - streamState 驱动 UI：streaming 时显示「停止」、禁用输入、打字机光标
 * - start → 连接建立；delta → 追加到当前 assistant 消息
 * - tag → 后端抽到新标签 → profileStore.bumpVersion()
 * - pending → 幂等命中（重复提交），不是错误：提示用户等上一轮
 * - done → followup_round（驱动追问进度环）/ conclusion_ready（结论卡片入口）
 * - code !== 0 / 断流：保留已收内容，尾巴标「（回答中断，点击重试）」，重试复用同一 client_msg_id
 *
 * 不持久化。
 */

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  messages: ChatMessage[]
  streamState: StreamState
  /** 追问轮次；null 表示后端拿不到画像标签，前端隐藏进度环 */
  followupRound: number | null
  followupDirection: string | null
  conclusionReady: boolean
  conclusion: ChatConclusionCard | null
  error: string | null
  loading: boolean

  loadConversations: () => Promise<void>
  setActive: (id: string | null) => void
  /** 没有会话时先建一个（流式接口必须带 conversation_id） */
  ensureConversation: () => Promise<string | null>
  loadMessages: (conversationId: string) => Promise<void>
  /** clientMsgId 传入时复用（重试幂等），否则新生成 */
  send: (content: string, clientMsgId?: string) => Promise<void>
  retry: (messageId: string) => Promise<void>
  stop: () => void
  reset: () => void
}

/** 模块级 AbortController：stop() 即 ctrl.abort() */
let streamCtrl: AbortController | null = null

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  streamState: 'idle',
  followupRound: null,
  followupDirection: null,
  conclusionReady: false,
  conclusion: null,
  error: null,
  loading: false,

  async loadConversations() {
    set({ loading: true })
    try {
      const list = normalizeList(await chatApi.listConversations())
      set({ conversations: list })
      if (!get().activeId && list.length) {
        set({
          activeId: list[0].id,
          followupRound: list[0].followup_round ?? null,
          followupDirection: list[0].followup_direction ?? null,
        })
      }
    } catch {
      // 后端未就绪时保持空列表，页面由空态兜住
    } finally {
      set({ loading: false })
    }
  },

  setActive(id) {
    set({
      activeId: id,
      messages: [],
      conclusion: null,
      conclusionReady: false,
      followupRound: null,
      followupDirection: null,
    })
  },

  async ensureConversation() {
    const existing = get().activeId
    if (existing) return existing
    const conversation = await chatApi.createConversation({})
    if (!conversation?.id) return null
    set((state) => ({
      activeId: conversation.id,
      conversations: [conversation, ...state.conversations],
    }))
    return conversation.id
  },

  async loadMessages(conversationId) {
    set({ loading: true })
    try {
      const list = normalizeList(await chatApi.listMessages(conversationId))
      set({ messages: list })
    } catch {
      set({ messages: [] })
    } finally {
      set({ loading: false })
    }
  },

  async send(content, reuseClientMsgId) {
    const text = content.trim()
    const busy = get().streamState === 'streaming' || get().streamState === 'connecting'
    if (!text || busy) return

    // Fix A：拿不到 conversation_id 就**不发请求**（后端没有无会话的流式端点）
    let conversationId: string | null = null
    try {
      conversationId = await get().ensureConversation()
    } catch {
      conversationId = null
    }
    if (!conversationId) {
      const message = '会话创建失败，请稍后再试'
      set({ streamState: 'error', error: message })
      toast.error(message)
      return
    }

    // 重试时复用同一个 client_msg_id，供后端幂等去重
    const clientMsgId = reuseClientMsgId ?? uuid()
    const userMessage: ChatMessage = {
      id: clientMsgId,
      conversation_id: conversationId,
      role: 'user',
      content: text,
      client_msg_id: clientMsgId,
      created_at: new Date().toISOString(),
    }
    const assistantId = `assistant-${clientMsgId}`
    const assistantMessage: ChatMessage = {
      id: assistantId,
      conversation_id: conversationId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
    }

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      streamState: 'connecting',
      error: null,
    }))

    track('chat_round', { conversation_id: conversationId })

    const appendDelta = (delta: string) => {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === assistantId ? { ...m, content: m.content + delta } : m,
        ),
      }))
    }

    const interrupt = (message: string) => {
      set((state) => ({
        streamState: 'error',
        error: message,
        messages: state.messages.map((m) =>
          m.id === assistantId ? { ...m, interrupted: true } : m,
        ),
      }))
    }

    streamCtrl = new AbortController()
    try {
      await streamChat({
        conversationId,
        content: text,
        clientMsgId,
        token: useAuthStore.getState().token,
        signal: streamCtrl.signal,
        onOpen: () => set({ streamState: 'streaming' }),
        onDelta: (delta) => appendDelta(delta),
        onTag: (message: SSEMessage) => {
          // 后端从对话里抽到新标签：画像变了，广播全局失效
          const count = message.data?.data?.tags?.length ?? 0
          if (count) useProfileStore.getState().bumpVersion()
        },
        onPending: () => {
          // 幂等命中：同一条消息已在生成或已完成，后端不会重复生成
          set((state) => ({
            streamState: 'done',
            messages: state.messages.filter((m) => m.id !== assistantId),
          }))
          toast.info('这句话已经提交过了，正在等上一轮的结果')
          void get().loadMessages(conversationId)
        },
        onDone: (message: SSEMessage) => {
          const data = message.data
          if (data?.followup_round !== undefined) {
            set({ followupRound: data.followup_round ?? null })
          }
          if (data?.followup_direction !== undefined) {
            set({ followupDirection: data.followup_direction ?? null })
          }
          if (data?.conclusion_ready) {
            set({ conclusionReady: true })
          }
        },
        onError: (error: ApiError) => set({ error: error.message }),
      })

      if (streamCtrl?.signal.aborted) {
        set({ streamState: 'idle' })
        return
      }

      set({ streamState: 'done' })
      // 对话结束属于画像写操作
      useProfileStore.getState().bumpVersion()
    } catch (error) {
      if (streamCtrl?.signal.aborted) {
        set({ streamState: 'idle' })
        return
      }
      const message = error instanceof ApiError ? error.message : '回答中断，请点击重试'
      interrupt(message)
      // AI 失败类 toast 带「重试」action（6.5）
      toast.error(message, {
        action: { label: '重试', onClick: () => void get().retry(assistantId) },
      })
    } finally {
      streamCtrl = null
    }
  },

  /** 重试：删掉失败的气泡，重新发送上一条用户消息（复用原 client_msg_id） */
  async retry(messageId) {
    const { messages } = get()
    const index = messages.findIndex((m) => m.id === messageId)
    if (index <= 0) return
    const userMessage = messages[index - 1]
    if (userMessage.role !== 'user') return

    set({ messages: messages.slice(0, index), streamState: 'idle', error: null })
    await get().send(userMessage.content, userMessage.client_msg_id ?? undefined)
  },

  stop() {
    streamCtrl?.abort()
    streamCtrl = null
    set({ streamState: 'idle' })
  },

  reset() {
    streamCtrl?.abort()
    streamCtrl = null
    set({
      conversations: [],
      activeId: null,
      messages: [],
      streamState: 'idle',
      followupRound: null,
      followupDirection: null,
      conclusionReady: false,
      conclusion: null,
      error: null,
    })
  },
}))

/** 「生成结论卡片」按钮：后端 conclusion_ready 才可点 */
export async function loadConclusion(conversationId: string): Promise<void> {
  const data = await chatApi.conclusion(conversationId)
  useChatStore.setState({ conclusion: data ?? null })
}
