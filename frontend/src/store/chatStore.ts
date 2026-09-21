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
  /** 删除会话：成功才动列表；删的是当前会话时把 activeId 让给下一条 */
  deleteConversation: (id: string) => Promise<void>
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

/**
 * 本地对 messages 的写入序号（每本地写一次 +1）。
 *
 * 解决的是什么问题：新建会话时 `ensureConversation()` 会 `set({ activeId })`，
 * 而 ChatPage 有个 `useEffect([activeId])` 会去 `loadMessages()`。那个请求返回时执行
 * `set({ messages: list })` —— **整个数组替换**。但此刻本地已经插入了
 * 「用户消息 + 空的 AI 气泡」，流式增量也正在往里写；而这份"历史"里
 * **只有用户消息**（后端开流前先落库用户消息，AI 回复要等流结束才写库）。
 * 于是气泡被冲掉：delta 按 id 找不到消息 → 界面不显示 → 但后端已落库，
 * 所以「切走再切回 / 刷新」又能看到。表现为「第一次对话的回复不显示」。
 *
 * 解法：`loadMessages` 发请求前记下序号，返回后若序号变了，说明这期间本地写过
 * 消息，这份历史比本地状态旧 → **丢弃它**。标记点覆盖乐观插入与每个流式增量，
 * 因此无论竞态发生在哪个时刻都能拦住。
 */
let localWriteSeq = 0

/** 标记「本地刚写过 messages」 */
function markLocalWrite(): void {
  localWriteSeq += 1
}

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

  async deleteConversation(id) {
    try {
      // 失败文案由这里给（api 层传了 silent，见 chatApi.deleteConversation）
      await chatApi.deleteConversation(id)
    } catch (error) {
      // 失败：**列表一个字节都不动**。后端可能压根没删掉，
      // 前端必须与后端保持一致，不能"看着删了、刷新又回来"。
      toast.error(error instanceof ApiError ? error.message : '删除失败，请稍后再试')
      return
    }

    const { conversations, activeId } = get()
    const index = conversations.findIndex((c) => c.id === id)
    if (index === -1) return
    const rest = conversations.filter((c) => c.id !== id)

    // 删的不是当前会话：只是列表少一条，消息区不动
    if (activeId !== id) {
      set({ conversations: rest })
      return
    }

    /*
     * 删的**正是当前会话**：清空消息区并把 activeId 让给下一条。
     *
     * ⚠️ 这里**有意不碰 profileStore**（不清画像、不 bumpVersion）：
     * 画像标签与成长任务由后端按 user_id 独立存储，删聊天记录**不影响**用户画像 ——
     * 这是产品需求。只有对话里**新抽出标签**才算画像写操作（见 send() 的 onTag）。
     */
    // 正在流式时删掉当前会话：先停流，否则流会继续往一个已删除的会话里写
    if (get().streamState === 'streaming' || get().streamState === 'connecting') get().stop()

    // "下一条"= 原来紧邻它的那一条；它本来就是最后一条时没有下一条 → null，
    // 此时消息区由空态兜住（ChatPage 的 useEffect 只有 activeId 真值才 loadMessages）
    const next = rest[index] ?? null
    set({
      conversations: rest,
      activeId: next?.id ?? null,
      messages: [],
      conclusion: null,
      conclusionReady: false,
      // 追问进度属于会话，必须跟着换：ChatPage 只在 activeId 变化时 loadMessages，
      // 不会重新拉 followup_round / followup_direction，留旧值会显示别的会话的进度
      followupRound: next?.followup_round ?? null,
      followupDirection: next?.followup_direction ?? null,
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
    // 记下"发请求时"的本地写入序号
    const seqAtStart = localWriteSeq
    set({ loading: true })
    try {
      const list = normalizeList(await chatApi.listMessages(conversationId))
      // 这期间本地写过消息（乐观插入 / 流式增量）→ 这份历史是旧的，丢弃，
      // 否则会把正在流式渲染的 AI 气泡冲掉（见 localWriteSeq 的说明）
      if (seqAtStart !== localWriteSeq) return
      // 这期间切换了会话 → 结果已不属于当前会话，同样丢弃
      if (get().activeId !== conversationId) return
      set({ messages: list })
    } catch {
      // 失败时也要遵守同一套护栏，避免把别的会话/正在流式的消息清空
      if (seqAtStart === localWriteSeq && get().activeId === conversationId) {
        set({ messages: [] })
      }
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
    // 乐观插入属于本地写入：让任何在途的 loadMessages 结果作废
    markLocalWrite()

    track('chat_round', { conversation_id: conversationId })

    const appendDelta = (delta: string) => {
      // 每个增量都算一次本地写入：只要流还在推进，在途的历史请求就不该生效
      markLocalWrite()
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

      // 流结束：本地已经握着完整回复，同样让在途的历史请求作废
      markLocalWrite()
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
