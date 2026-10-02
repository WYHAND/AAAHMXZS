import { create } from 'zustand'
import { toast } from 'sonner'

import { chatApi } from '@/api/chat'
import { ApiError } from '@/api/client'
import { streamChat, type SSEMessage } from '@/api/sse'
import { ERROR_CODE } from '@/constants/errorCode'
import { useAuthStore } from '@/store/authStore'
import {
  resolveLoadFailureAction,
  shouldEnsureOpening,
  type HistoryLoad,
} from '@/store/chatHistory'
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
 * - done → conclusion_ready（结论卡片入口）
 * - code !== 0 / 断流：保留已收内容，尾巴标「（回答中断，点击重试）」，重试复用同一 client_msg_id
 *
 * 不持久化。
 */

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  messages: ChatMessage[]
  streamState: StreamState
  conclusionReady: boolean
  conclusion: ChatConclusionCard | null
  error: string | null
  loading: boolean
  /**
   * 正在拉开场白的会话 id；null 表示没有在途请求。
   * UI 靠它显示等待态（AIThinking），而不是显示静态空态文案。
   */
  openingFor: string | null
  /**
   * 本会话已尝试过拉开场白、但**失败了**（后端 404 / 网络故障）。
   * ⚠️ 只在失败时置位：成功时开场白已经是 messages 里的一条，UI 自然不再是空态，
   * 不需要第二个状态位去表达「成功」。
   */
  openingFailedFor: string | null
  /**
   * **本次「拉历史」的结论**（模块级纯逻辑见 store/chatHistory.ts）。
   *
   * 它存在的唯一理由：`messages` 是"屏幕上有什么"，本条是"服务端说了什么"，
   * 两者必须分开。历史没拉到时 `messages` 可能是空的（屏幕上确实没东西），
   * 但那**不等于**服务端没有消息 —— 旧代码把两者混为一谈，于是拉取失败的那一两秒
   * 会去补一条开场白，把一个 21 条消息的会话显示成"只剩开场白"。
   *
   * 形状刻意是 `{conversationId, status}` 一个值（而不是 `messagesLoadedFor: string`
   * 或裸的 `historyStatus`）：id 与状态绑死，**切会话不需要任何人记得重置** ——
   * id 对不上就等于"没有结论"，后人想误用也没有缝可钻。
   * 判断只走 chatHistory.ts 的 resolveHistoryOutcome / shouldEnsureOpening。
   */
  historyLoad: HistoryLoad | null

  loadConversations: () => Promise<void>
  setActive: (id: string | null) => void
  /** 删除会话：成功才动列表；删的是当前会话时把 activeId 让给下一条 */
  deleteConversation: (id: string) => Promise<void>
  /**
   * 「+ 新对话」：**永远真的新建一个会话并切过去**（而不是只把 activeId 置空）。
   *
   * 之前这里是"当前会话还是空的就复用它"，但用户的意思是「点了新对话就是
   * 想换聊天内容了」—— 复用的表现就是"点了像没反应"。
   * 上一个会话**原样留在侧栏**（产品决定，见实现处的注释：前端不自动删任何会话）。
   */
  newConversation: () => Promise<string | null>
  /** 没有会话时先建一个（流式接口必须带 conversation_id） */
  ensureConversation: () => Promise<string | null>
  /**
   * 空会话自动拉开场白（「AI 主动挖掘」的入口）。
   * 幂等：同一会话并发调用只会发一次请求；已有消息 / 已拉过则直接返回。
   */
  ensureOpening: (conversationId: string) => Promise<void>
  /** 开场白拉取失败后的「再试一次」按钮 */
  retryOpening: () => Promise<void>
  loadMessages: (conversationId: string) => Promise<void>
  /**
   * 历史没拉到时的「重新加载」：重拉一次历史；如果服务端确实说这个会话没有消息，
   * 再把开场白补上。**不**清空任何已有消息（失败就保持原样，由页面提示）。
   */
  reloadMessages: () => Promise<void>
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

/**
 * 换号世代：`reset()` 每跑一次 +1（登出 / 登录 / 注册都会走到）。
 *
 * 它挡的是**迟到的响应**：上一个账号的 `loadConversations()` 可能还挂在网络上，
 * 不拦的话它回来时会 `set({ conversations })` —— 把**上一个账号的会话列表**
 * 灌进新账号的界面，还会顺手把 activeId 设成别人的会话 id（B3 的对齐逻辑
 * 是"列表里没有才置空"，而这份列表里恰恰有）。
 * 发请求前记下世代、落地前比一次即可，不需要任何"我以为请求作废了"的登记。
 */
let sessionGeneration = 0

/* ------------------------- 开场白（AI 主动开口）去重 ------------------------- */

/**
 * 已经为哪些会话拿到过开场白。**模块级**（不进 store state）的理由：
 * 它是"请求簿记"而不是要渲染的数据 —— 进 state 会让每次 set 都触发订阅者重渲染，
 * 而 UI 需要的只是「有没有在途请求 / 有没有失败」这两个状态位。
 *
 * 它的作用是防并发重复请求：切走再切回、React 严格模式的双次 effect、
 * loadMessages 成功后的补拉，都可能在极短时间内对同一会话各发一次。
 */
const openingRequested = new Set<string>()

/**
 * 在途的开场白请求：同一会话共用同一个 Promise，不会发第二次 HTTP
 *
 * ⚠️ 这里**刻意没有**「每个会话的开场白消息 id」这种 Map。
 * 之前有一版是 `openingMessageIds: Map<convId, msgId>`，用来在 `loadMessages`
 * 里把重复的那条开场白剔掉 —— 结果它会被**毒化**：
 * 登记写在「期间切走了会话 → 丢弃这次结果」的 `return` **之前**，
 * 于是簿记说"这个会话的开场白是 X"，但 X 从没进过 messages。
 * 后面两条路径同时失效：`loadMessages` 把服务端**真实存在**的 X 剔掉（messages 永远空），
 * `ensureOpening` 又因为 `has()` 为真而早退（连 openingFor 都不置），
 * 界面三分支全落空 → 落到兜底空态（用户看到的「提问消失」）。
 *
 * 教训：**任何"登记"和"渲染"分离的簿记都会出现这种不一致**。
 * 现在的写法是：去重只看**当轮真实渲染着的 messages**（见 loadMessages），
 * 不保存任何"我以为它渲染过"的副本 —— 渲染了才有记录，没渲染就不可能有记录。
 * 剩下的 requested/inFlight 两个结构只描述**请求**，不描述渲染结果，
 * 因此它们即使因为切走而残留也不会影响任何显示。
 */
const openingInFlight = new Map<string, Promise<ChatMessage | null>>()

/**
 * 会话没了：把它的开场白簿记一并清掉（否则这两个结构里的 id 会慢慢堆积）。
 *
 * 调用方只有两个，语义都是"这个会话对前端而言**已经不存在了**"：
 * 用户主动删除（deleteConversation）与后端说它不存在/不属于我（dropGoneConversation）。
 * ⚠️ 这里清的是**本地簿记**，不发任何删除请求 —— 前端不允许"顺手"替用户删会话，
 * 删会话的唯一入口是用户在侧栏点垃圾桶。
 */
function forgetConversation(id: string): void {
  openingRequested.delete(id)
  openingInFlight.delete(id)
}

/**
 * 后端说「这条记录不存在 / 不属于你」：HTTP 404 → envelope code 2001
 * （见 api/client.ts 的契约，前端文案是「内容不存在」）。
 *
 * 换号后 activeId 还留着上一个账号的会话 id 时，拉历史/拉开场白拿到的就是它。
 */
function isConversationGone(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR_CODE.NOT_FOUND
}

/**
 * 会话被判定为**不存在 / 不属于当前用户**（code 2001）时的统一收尾。
 *
 * 为什么必须有这一步：activeId 指向一个不存在的会话时，界面会陷入
 * 「有选中项、但永远拉不到任何消息」的状态 —— 开场白既没有气泡、也没有失败标记，
 * ChatPage 的 openingPending 就永远为 true，用户看到的是**永远转圈**。
 * 所以这里给它一个明确结局：这个会话对前端而言从此不存在。
 *
 *   conversations 里移除它 → 清掉它的开场白簿记 → activeId 让给列表里的下一条
 *   （没有就置 null）→ messages 清空。界面于是回落到「还没有历史会话」的空态。
 *
 * 复用的是 deleteConversation 那一套：同一个 forgetConversation、同一条"下一条"取法。
 * **不另写一份分散的簿记清理** —— 簿记一旦有两份就一定会不一致（见 openingInFlight
 * 上方那段"登记与渲染分离"的教训）。
 */
function dropGoneConversation(conversationId: string): void {
  // 这个会话没了：两个模块级结构里的条目一次清干净（否则它们会慢慢堆积）
  forgetConversation(conversationId)

  const state = useChatStore.getState()
  if (state.activeId !== conversationId) {
    // 不是当前会话：只是列表里少一条，消息区不动。
    // 但等待态/失败标记可能正好挂在这个会话上（请求在途时用户切走了会话，
    // 该请求随后拿到 2001）—— 一并清掉，别把脏 id 留在状态里。
    useChatStore.setState((current) => ({
      conversations: current.conversations.filter((c) => c.id !== conversationId),
      openingFor: current.openingFor === conversationId ? null : current.openingFor,
      openingFailedFor:
        current.openingFailedFor === conversationId ? null : current.openingFailedFor,
      // 会话都没了，它那份"历史拉到了没有"的结论一并作废
      historyLoad:
        current.historyLoad?.conversationId === conversationId ? null : current.historyLoad,
    }))
    return
  }

  // 正在流式时才发现当前会话没了：先停流，否则流会继续往一个不存在的会话里写
  if (state.streamState === 'streaming' || state.streamState === 'connecting') state.stop()

  const index = state.conversations.findIndex((c) => c.id === conversationId)
  const rest = state.conversations.filter((c) => c.id !== conversationId)
  // "下一条"= 原来紧邻它的那一条（与 deleteConversation 同一取法）；
  // 它本来就是最后一条时没有下一条 → null，消息区由空态兜住
  const next = rest[index] ?? null

  useChatStore.setState({
    conversations: rest,
    activeId: next?.id ?? null,
    messages: [],
    conclusion: null,
    conclusionReady: false,
    // 开场白状态是会话级的：换到"下一条"必须一起重置，
    // 否则会把"这个不存在的会话正在拉开场白"的等待态继续画在屏幕上
    openingFor: null,
    openingFailedFor: null,
    historyLoad: null,
  })
}

/**
 * 后端给开场白写死的 `client_msg_id`（backend chat_service.OPENING_CLIENT_MSG_ID）。
 *
 * 它是这条消息**唯一的身份标记**：有了它就不需要在前端另存一份
 * "哪条是开场白"的簿记 —— 消息自己知道。簿记的代价见上方 openingInFlight 的注释。
 */
const OPENING_CLIENT_MSG_ID = 'sys:opening'

/** 这条消息是不是本会话的 AI 开场白 */
export function isOpeningMessage(message: ChatMessage): boolean {
  return message.client_msg_id === OPENING_CLIENT_MSG_ID
}

/**
 * 一条消息在"两端"的公共身份 = 服务端的幂等键 `client_msg_id`。
 *
 * 不能用本地内部 id：用户消息本地 id 是前端生成的 clientMsgId、服务端是 UUID，
 * 同一条消息两边 id 根本不同，拿它比对会把一条消息当成两条。
 * 兜底的 `id` 只对**服务端那条**有意义（本地遗留的无 key 消息由调用方另行排除）。
 */
function syncKey(message: ChatMessage): string {
  return message.client_msg_id ?? message.id
}

/** 开场白这件事对当前会话**已经有结论**了：成功（有开场白气泡）或失败（有失败标记） */
export function openingSettled(
  state: Pick<ChatState, 'messages' | 'openingFailedFor'>,
  conversationId: string | null,
): boolean {
  if (!conversationId) return false
  return (
    state.messages.length > 0 ||
    state.messages.some(isOpeningMessage) ||
    state.openingFailedFor === conversationId
  )
}

/*
 * 上面这个 helper 的参数用 Pick<ChatState, ...> 是为了从"渲染态"里挑字段：
 * 它读的三个字段全部来自 store，没有一个是模块级簿记 —— 这正是这次修复的要点，
 * 凡是参与"要不要显示/要不要再拉"判断的状态，都必须是真实渲染态。
 */

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  streamState: 'idle',
  conclusionReady: false,
  conclusion: null,
  error: null,
  loading: false,
  openingFor: null,
  openingFailedFor: null,
  // 还没有任何"拉历史"的结论：此刻谁都不知道服务端有没有消息（所以不补开场白）
  historyLoad: null,

  async loadConversations() {
    // 记下"发请求时"的换号世代：落地前要比一次（见 sessionGeneration）
    const generation = sessionGeneration
    set({ loading: true })
    try {
      const list = normalizeList(await chatApi.listConversations())
      // 期间换过号 → 这份列表属于上一个账号，整份丢弃（连 activeId 也不许被它影响）
      if (generation !== sessionGeneration) return
      set({ conversations: list })

      /*
       * 对齐 activeId：**列表请求成功、而 activeId 不在列表里** → 这个 id 已经
       * 不存在或不属于当前用户，置空（换号前留下的旧 id 就属于这种；
       * 不处理的话后面的 loadMessages / ensureOpening 会拿它去请求，
       * 拿到 2001 之后界面就卡在一个不存在的选中项上转圈）。
       *
       * ⚠️ 判据里「请求成功」这个前提不能丢：请求**失败**时列表暂时是空的，
       * 那不等于会话不存在 —— catch 分支保持原状，让用户重试后还能走回来。
       * 也不能拿 message_count / messages 之类的间接信号推断（那些都有别的语义）。
       */
      const { activeId } = get()
      if (activeId && !list.some((conversation) => conversation.id === activeId)) {
        // 会话已经不属于当前用户：它的开场白簿记同样作废
        forgetConversation(activeId)
        set({
          activeId: null,
          messages: [],
          conclusion: null,
          conclusionReady: false,
          openingFor: null,
          openingFailedFor: null,
          // 会话都没了，它那份"历史拉到了没有"的结论一并作废
          historyLoad: null,
        })
      }

      if (!get().activeId && list.length) {
        // 自动选中第一条时也要重置开场白状态，否则会把上一个会话的
        // 失败标记带过来（和 setActive 同样的理由）
        set({
          activeId: list[0].id,
          messages: [],
          openingFor: null,
          openingFailedFor: null,
          historyLoad: null,
        })
      }
    } catch {
      // 后端未就绪时保持空列表，页面由空态兜住
    } finally {
      // 换过号了：这份 loading 属于上一次请求，别去动新账号的加载态
      if (generation === sessionGeneration) set({ loading: false })
    }
  },

  setActive(id) {
    /*
     * 点的是**已经选中**的那一条：什么都不做。
     *
     * 之前这里无条件 `messages: []`。而 activeId 没变 → ChatPage 的
     * `useEffect([activeId])` 不会重跑 → 历史根本不会重新拉；同时"安全网" effect
     * 看到 messages 空了就去补开场白 → 屏幕上只剩一句开场白。
     * 这与本次修的「切走再切回、历史拉失败」是同一个症状的第二条入口，
     * 所以一并堵掉：重选自己 != 清空内容。
     */
    if (id === get().activeId) return
    set({
      activeId: id,
      messages: [],
      conclusion: null,
      conclusionReady: false,
      // 开场白状态是**会话级**的：换会话必须一起重置，
      // 否则会把「A 会话正在拉开场白」的等待态画到 B 会话上
      openingFor: null,
      openingFailedFor: null,
      historyLoad: null,
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

    // 会话说没就没了：把它的开场白簿记一并清掉
    forgetConversation(id)

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
      // 开场白状态同样是会话级的（"下一条"若为空会话，它会自己再拉一次开场白）
      openingFor: null,
      openingFailedFor: null,
      historyLoad: null,
    })
  },

  /**
   * 「+ 新对话」：**永远真的新建一个会话并切过去**。
   *
   * 产品决定（**两个被用户否掉的方案都记在这里**，免得下一个人再"顺手优化"回去）：
   *
   * ① 「当前会话还是空的就复用它、不新建」—— 否掉。点「新对话」就是用户想换
   *    聊天内容了，复用的表现是"点了像没反应"。
   * ② 「新建时顺手把离开的那个 0 用户消息空会话删掉，免得侧栏堆积」—— **同样否掉**。
   *    那些"只有 AI 开场白、用户还没答"的会话不是垃圾，而是 AI 已经替用户开好头的
   *    一个话题（例如开场白「最近有没有什么小事情把你时间占住了呀？」），用户完全
   *    可能过一会儿回来答它 —— 自动删掉 = 用户眼看着上一个话题凭空消失。
   *
   * ⇒ **空会话一律原样留在侧栏，前端不做任何自动删除**；侧栏里多几条空会话不是问题，
   *   要清理由用户自己点会话项上的垃圾桶（deleteConversation —— 那是前端唯一会真的
   *   调 DELETE 接口的路径）。
   *
   * 因此这里只做"新建 + 切过去"，不再有任何按 message_count / 用户消息推断出来的
   * 自动清理（也没有配套的簿记）。
   */
  async newConversation() {
    let conversation: Conversation | null = null
    try {
      conversation = await chatApi.createConversation({})
    } catch {
      // 失败文案由 axios 拦截器统一 toast（这里不 silent），
      // 页面保持原样即可：绝不切到一个并不存在的会话 id 上
      return null
    }
    if (!conversation?.id) return null

    set((state) => ({
      activeId: conversation.id,
      conversations: [conversation, ...state.conversations],
      messages: [],
      conclusion: null,
      conclusionReady: false,
      openingFor: null,
      openingFailedFor: null,
      // 新建的会话还什么都没拉过：结论作废，等 ChatPage 拉完再决定要不要开口
      historyLoad: null,
    }))

    /*
     * 这里**不等**开场白：让按钮尽快结束（activeId 已经切过去了，界面立刻就是新会话）。
     * ChatPage 的 `useEffect([activeId])` 会接着 ensureOpening ——
     * 同一会话的并发调用由 openingInFlight 收口，只会发一次 HTTP。
     */
    return conversation.id
  },

  async ensureConversation() {
    const existing = get().activeId
    if (existing) return existing
    /*
     * 只保留"从一个会话都没有的状态救急建一个"这一条职责。
     * 「+ 新对话」按钮走 newConversation()（每次点击都真的新建一个会话）；
     * send() 也仍然可以走到这里（例如首次进入时 list 为空、用户直接打字）。
     */
    const conversation = await chatApi.createConversation({})
    if (!conversation?.id) return null
    set((state) => ({
      activeId: conversation.id,
      conversations: [conversation, ...state.conversations],
      messages: [],
      openingFor: null,
      openingFailedFor: null,
      historyLoad: null,
    }))
    return conversation.id
  },

  async ensureOpening(conversationId) {
    if (!conversationId) return
    /*
     * 早退条件有三类，且都**不会**把 UI 留在"三分支全落空"的状态：
     *   ① 已经有消息 → 界面有气泡，本来就不是空态；
     *   ② 本次请求已在途 → openingFor 已经是这个 id，界面显示等待态；
     *   ③ 【本次修复新增】**这个会话的历史还没拉成功**（还没拉 / 正在拉 / 拉失败）
     *      → 服务端到底有没有消息，前端此刻**并不知道**。
     * 除此之外**一律往下走并置 openingFor**。这条纪律是上一个 bug 的直接教训：
     * 早退却不置 openingFor，会让页面既没气泡、也没等待态、也没失败态。
     *
     * ⚠️ 判据为什么不能是 `messages.length === 0`（旧代码就是这个）：
     * "屏幕上没有东西"和"服务端没有东西"是两件事。历史没拉到的那一两秒里
     * messages 是空的（甚至是被失败分支清空的），此时去打 `POST /opening`，
     * 后端发现会话已有开场白 → 按幂等**回放**那一条 → 前端把它当成唯一一条消息插进视图。
     * 用户看到的就是「21 条消息的会话只剩一句开场白」。
     * 唯一合法的前提是 shouldEnsureOpening：**本次历史加载成功、且服务端确实没有消息**。
     */
    if (!shouldEnsureOpening(get(), conversationId)) return
    if (openingInFlight.has(conversationId)) return

    /*
     * 「这个会话我已经拉过开场白了」这条簿记 **只有在渲染态能给它作证时才允许早退**。
     *
     * 推理：拉过一次 ≠ 拿到过。真有结论的话渲染态必然有痕迹 ——
     *   成功 → messages 里有那条开场白（shouldEnsureOpening 已经拦掉了）；
     *   失败 → openingFailedFor === conversationId（界面显示「让 AI 先开口」按钮）。
     * 两者都不成立却还留在 openingRequested 里，就说明这条簿记是**脏的**：
     * openingRequested 是模块级 Set（不受 store.reset 管辖、跨账号存活），
     * 只要换号那次 reset 没跑，它就会带着**上一个账号的会话 id** 活下来。
     * 此时静默早退的后果正是用户看到的现象：不发请求、不置成功也不置失败 →
     * openingSettled 永远 false → ChatPage 的 openingPending 永远 true → 一直转圈。
     *
     * 所以这里**不信簿记、只信渲染态**：把它删掉，乖乖重拉一次。
     * 重拉不会造成请求风暴（并发仍由 openingInFlight 收口），
     * 而且无论成功还是失败都会落到一个明确结局上。
     */
    if (openingRequested.has(conversationId)) {
      // "失败过就不自动重发"：上面 shouldEnsureOpening 已经拦过一次，
      // 这里再拦一次只是兜底（别让这条纪律依赖单一判断）
      if (get().openingFailedFor === conversationId) return
      openingRequested.delete(conversationId)
    }

    openingRequested.add(conversationId)
    set({ openingFor: conversationId, openingFailedFor: null })

    const request = (async (): Promise<ChatMessage | null> => {
      try {
        const message = await chatApi.opening(conversationId)
        /*
         * data 为 null：后端「会话已有消息，未生成开场白」的正常分支（不是错误）。
         * 此时**不能**把它当失败 —— 会话里有消息，界面有得显示。
         */
        if (!message?.id) return null
        const record: ChatMessage = { ...message, interrupted: false }

        const state = get()
        // 期间切换了会话 → 结果不属于当前界面，**直接丢弃**（不做任何登记）
        if (state.activeId !== conversationId) return record
        // 期间这条已经在界面上（例如历史里已经带了它）→ 什么都不用做
        if (state.messages.some((m) => syncKey(m) === syncKey(record))) return record
        // 期间本地已经有别的内容（用户抢先说了话）→ 不插到后面，避免时序错乱
        if (state.messages.length) return record

        markLocalWrite()
        set({ messages: [record], openingFailedFor: null })
        return record
      } catch (error) {
        /*
         * 会话不存在 / 不属于当前用户（code 2001）：这次请求的结局**不是**
         * "失败、可以重试"，而是"这个会话对前端已经不存在了"。
         * 交给 dropGoneConversation 统一收尾（移出列表 / 清簿记 / 让位下一条 /
         * 清空消息）—— 只把它当普通失败打上 openingFailedFor 的话，
         * 界面会留着一个已经不存在的选中项，用户点重试也只会再吃一次 2001。
         *
         * 注意这条路径是 silent 的（chatApi.opening 传了 silent），
         * 所以它不会额外弹一个「内容不存在」的 toast。
         */
        if (isConversationGone(error)) {
          dropGoneConversation(conversationId)
          return null
        }
        /*
         * 其余失败（网络故障 / 5xx / 路由没上线）→ 解开"已拉过"的标记，
         * 让用户点「新对话 / 再试一次」时能重试。
         */
        openingRequested.delete(conversationId)
        return null
      } finally {
        openingInFlight.delete(conversationId)
        if (get().activeId === conversationId) {
          /*
           * 收尾时 openingFor / openingFailedFor **必须二选一**：
           * 拿到开场白（或会话本来就有消息）→ 清失败标记；
           * 没拿到 → 打上失败标记，让 ChatPage 显示静态回落 + 重试按钮。
           * 两者都为 null 且 messages 为空就是"提问消失"那个 bug 的现场。
           *
           * 上面 2001 那条路径进来时 activeId 已经被让给"下一条"（或 null），
           * 这个判断自然为假 —— 那些状态由 dropGoneConversation 一次置好，
           * 不会被这里覆盖回等待态。
           */
          set((state) => ({
            openingFor: null,
            openingFailedFor:
              state.messages.length || state.messages.some(isOpeningMessage)
                ? null
                : conversationId,
          }))
        }
      }
    })()

    openingInFlight.set(conversationId, request)
    await request
  },

  async retryOpening() {
    const id = get().activeId
    if (!id) return
    // 清掉失败簿记，允许再发一次
    openingRequested.delete(id)
    set({ openingFailedFor: null })
    /*
     * 先重新拉一次历史：开场白失败可能只是**历史**没拉到（那种情况下连开场白请求
     * 都没必要发，见 ensureOpening 的判据）。历史能拉到就直接结束，
     * 拉不到再走开场白接口 —— 否则一次历史请求失败会让这个会话永久只显示一句话。
     */
    await get().loadMessages(id)
    if (get().messages.length) return
    await get().ensureOpening(id)
  },

  /**
   * 消息区「重新加载」按钮（历史没拉到时显示）。
   *
   * 与 retryOpening 的区别只有一个：它**不**清开场白的失败标记 ——
   * 用户点的是"把这段对话重新读出来"，不是"让 AI 重新开口"。
   * 读出来之后要不要补开场白，仍然由 shouldEnsureOpening 说了算
   * （服务端确实说这个会话没有消息 → 该开口还是得开口，新会话的自动开场不受影响）。
   *
   * ⚠️ 后端真的说"这个会话没有消息"时，这里不会凭空造内容：messages 保持为空，
   * 由 ChatPage 的等待态/兜底空态收尾；历史再次拉不到就还是失败态。
   */
  async reloadMessages() {
    const id = get().activeId
    if (!id) return
    await get().loadMessages(id)
    if (shouldEnsureOpening(get(), id)) await get().ensureOpening(id)
  },

  async loadMessages(conversationId) {
    // 记下"发请求时"的本地写入序号
    const seqAtStart = localWriteSeq
    set({ loading: true })
    /*
     * 发请求前先记"正在拉"，**只记在当前会话上**。
     *
     * 为什么必须比对 activeId：historyLoad 是**单槽**状态，一份属于别的会话的结论
     * 写进来会把它挤掉，让当前会话永远停在 pending（"登记与渲染分离"那个老坑）。
     * 属于别的会话的请求就什么都不记 —— 用户切回去时会重新拉一次，本来也不需要它。
     */
    if (get().activeId === conversationId) {
      set({ historyLoad: { conversationId, status: 'loading' } })
    }
    try {
      const list = normalizeList(await chatApi.listMessages(conversationId))
      // 这期间本地写过消息（乐观插入 / 流式增量）→ 这份历史是旧的，丢弃，
      // 否则会把正在流式渲染的 AI 气泡冲掉（见 localWriteSeq 的说明）
      if (seqAtStart !== localWriteSeq) return
      // 这期间切换了会话 → 结果已不属于当前会话，同样丢弃
      if (get().activeId !== conversationId) return
      /*
       * 把服务端历史合并进视图。
       *
       * ⚠️ 不变量：**绝不能让一条已经在屏幕上渲染的消息消失**。
       * 所以这里不做"按本地 id 过滤掉"（那等于把屏幕上那条从新视图里剔掉），
       * 而是按「服务端的幂等键」去重后**保留服务端那一份**。
       *
       * 为什么键必须用 `client_msg_id`：同一条消息在两边的 id 不一样 ——
       * 用户消息本地 id = 前端生成的 clientMsgId、服务端 id 是 UUID；
       * 只有 `client_msg_id` 两边一致（开场白是后端写死的 `sys:opening`）。
       * 用本地 id 比对会把"同一条消息"误判成"两条不同的消息"。
       *
       * `m.client_msg_id &&` 这个前置条件很重要：本地**还没有落库凭据**的消息
       * （最典型的是流式中的乐观 assistant 气泡 `assistant-<uuid>`，它没有
       * client_msg_id）一律不保留，交给服务端那一份。这里不存在"把屏幕上正在
       * 显示的内容删掉"的风险，因为这种气泡活着就说明流还没结束，而流每来一个
       * 增量都会 markLocalWrite()，使 seqAtStart !== localWriteSeq 在上一行整段丢弃 ——
       * 也就是说：**能走到合并这一步，就说明本地没有未落库的乐观气泡**。
       * 唯一被主动丢掉的"有内容"情况是它，而它的内容本来就会由服务端补回来。
       *
       * 兜底去重（serverKeys 里那条消息没有 client_msg_id 时用服务端 id）：
       * 只可能命中"服务端没给 key、本地却有"的错位场景，此时按 id 再拦一次，
       * 保证同一条消息不会出现两份。
       */
      const serverKeys = new Set(list.map(syncKey))
      const localOnly = get().messages.filter(
        (m) => m.client_msg_id && !serverKeys.has(syncKey(m)),
      )
      /*
       * ready = "服务端这一份历史拿到了，并且它适用于当前会话此刻的视图"。
       * 这是**唯一**能说"服务端没有消息"的状态：只有它 + messages 为空，
       * 才允许补开场白（见 chatHistory.ts 的 shouldEnsureOpening）。
       */
      set({
        messages: localOnly.length ? [...list, ...localOnly] : list,
        historyLoad: { conversationId, status: 'ready' },
      })
    } catch (error) {
      /*
       * 失败只有两种结局，全部由纯函数判定（真值表见 store/chatHistory.ts 的注释）：
       *
       *   ① `drop-gone-conversation`（HTTP 404 → code 2001，会话不存在 / 不属于当前用户）
       *      交给 dropGoneConversation 统一收尾：移出列表 / 清簿记 / activeId 让位下一条 /
       *      清空消息。**这条逻辑没有被本次修复改动。**
       *      （不能只把 messages 清空：那样 activeId 还指着一个不存在的会话，
       *        界面会停在"有选中项、永远拉不到内容"的状态上。)
       *
       *   ② `keep-messages`（网络抖动 / 后端 5xx / `--reload` 重启中）
       *      **只是"这次没拉到"**：
       *      - 屏幕上已有的消息**一个都不许动**。旧代码在这里 `set({ messages: [] })`，
       *        把"暂时拉不到"表达成了"没有消息" —— 这是本次 bug 的第一个错。
       *      - 记一条"历史没拉到"，让消息区给失败态（或"历史不是最新"的轻提示），
       *        并且让 shouldEnsureOpening 不成立 —— 不知道服务端有没有消息时**绝不**
       *        去补开场白（旧代码会补，于是 21 条消息的会话显示成只有开场白）。
       */
      if (resolveLoadFailureAction(isConversationGone(error)) === 'drop-gone-conversation') {
        dropGoneConversation(conversationId)
        return
      }
      if (get().activeId === conversationId) {
        set({ historyLoad: { conversationId, status: 'failed' } })
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
      /*
       * 用户开口之后，这个会话就不再是"等着 AI 开场"的空会话了。
       * 这里**只清失败标记**：不再需要"清掉开场白簿记"这种动作 ——
       * "哪条是开场白"现在由 messages 里的 client_msg_id 自己表达，
       * 开场白气泡也不会被后面的 loadMessages 弄丢（见那里的合并规则）。
       */
      openingFailedFor: null,
    }))
    // 本地已经写过消息 → 这个会话不再需要开场白
    openingRequested.add(conversationId)
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
          if (message.data?.conclusion_ready) {
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
    // 换号世代 +1：上一个账号在途的 loadConversations 回来时会被丢掉
    sessionGeneration += 1
    /*
     * 登出/切换账号：会话 id 全部作废，开场白簿记也必须跟着清空。
     * 这两个模块级结构**不受 store 管辖**（跨组件实例、跨账号存活），
     * 只要漏清一个，新账号就会命中"已经拉过了"的脏簿记 → 永远转圈。
     * 新增任何模块级缓存，都必须在这里（或本文件其它 reset 路径）补一行 clear()。
     */
    openingRequested.clear()
    openingInFlight.clear()
    set({
      conversations: [],
      activeId: null,
      messages: [],
      streamState: 'idle',
      conclusionReady: false,
      conclusion: null,
      error: null,
      // loading 也是按用户的：上一个账号在途的请求不该让新账号停在加载态
      loading: false,
      openingFor: null,
      openingFailedFor: null,
      historyLoad: null,
    })
  },
}))

/** 「生成结论卡片」按钮：后端 conclusion_ready 才可点 */
export async function loadConclusion(conversationId: string): Promise<void> {
  const data = await chatApi.conclusion(conversationId)
  useChatStore.setState({ conclusion: data ?? null })
}
