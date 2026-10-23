import { create } from 'zustand'
import { toast } from 'sonner'

import { chatApi, ChatStreamError } from '@/api/chat'
import { ApiError } from '@/api/client'
import { ERROR_CODE } from '@/constants/errorCode'
import {
  resolveLoadFailureAction,
  shouldEnsureOpening,
  type HistoryLoad,
} from '@/store/chatHistory'
import { useProfileStore } from '@/store/profileStore'
import type {
  ChatConclusionCard,
  ChatMessage,
  ChatStreamStage,
  Conversation,
} from '@/types'
import { uuid } from '@/utils/format'
import { normalizeList } from '@/utils/list'
import { nextReveal } from '@/utils/revealPace'
import { track } from '@/utils/track'

/**
 * chatStore（4.1 / 4.3）
 *
 * 发送**优先走 SSE**（POST .../stream）：回复正文逐块上屏；
 * SSE 请求本身失败（HTTP 非 2xx / fetch 抛错 / 浏览器不支持流）时**自动回退**
 * 到非流式 POST .../messages（同一 client_msg_id，后端幂等），体验不降级。
 *
 * - 幂等：同一 client_msg_id 重试复用，后端不会重复生成
 * - 正文草稿：逐块累积在 `streams`（临时展示态），done 时才落成一条 assistant 消息
 * - 失败：在消息列表末尾放一个「回答中断，点击重试」气泡（interrupted），重试复用同一 client_msg_id
 * - conclusion_ready：回复里带上，结论卡片入口
 *
 * 不持久化。
 */

/**
 * 一个会话**正在流式生成**时的临时状态（只在内存、随流结束清掉）。
 *
 * 只放"还没落成正式消息"的临时态：
 * - `content`：**服务端给到的完整正文**（逐块累积），`done` 提交用的就是它；
 * - `shown`：**当前该显示到哪**（content 的前缀），UI 渲染 `splitReply(shown)`。
 *   它存在的理由是"真人感"：一条回复拆成 2-3 个气泡时，不能几乎同时冒出来，
 *   要隔约 REPLY_BUBBLE_GAP_MS 一格格揭示（见 send 里的 ticker 与 utils/revealPace）。
 * - `status`：生成阶段（reading / thinking / writing）+ 服务端已用时间，
 *   只给用户看"正在干什么"。**刻意只活在这里**：它不进 messages、
 *   不进 message.content —— 阶段是临时展示态，不是消息内容的一部分，
 *   一旦落进消息就会被持久化/被当成正文（见 send 里的 publishStatus）。
 * - 模型内部推理（思维链原文）前端一概不显示，后端也不下发。
 */
export interface ChatStream {
  conversationId: string
  /** 回复正文（逐块累积；done 时才落成一条真正的 assistant 消息） */
  content: string
  /**
   * 当前**已揭示**到哪（永远是 `content` 的前缀）。
   * UI 渲染它（`splitReply(shown)`），而不是 `content` —— 这样多段回复才是
   * "一段一段地说出来"，而不是三个气泡同时出现。初始为 `''`。
   */
  shown: string
  /**
   * 生成阶段状态（reading / thinking / writing）。
   * 正文第一个 delta 到达时清掉（气泡接手）；随所在 ChatStream 一起被
   * clearStream / reset 清掉，不会在离开会话后残留。
   */
  status?: ChatStreamStatus
}

/** 一条阶段状态：文案由服务端给（本地兜底文案见 LOCAL_STATUS_TEXT），elapsedMs 来自服务端 */
export interface ChatStreamStatus {
  stage: ChatStreamStage
  text: string
  /** 服务端已用毫秒（thinking 每 2 秒心跳更新一次，前端不自己飙秒） */
  elapsedMs: number
}

/**
 * 发送瞬间的本地阶段文案。
 *
 * 为什么需要它：SSE 的响应头要等后端 `prepare_stream`（查库 / 组装画像）之后才回来，
 * 那几百毫秒到几秒里如果什么都不显示，用户会以为网卡了。所以在**发请求的同时**
 * 先本地写一条 reading 状态，拿到第一个服务端 status 后立即被替换。
 * 它同样用于 SSE 失败回退非流式（POST /messages）的那条路径 —— 那时没有事件流，
 * 只能由本地文案一直兜着，直到回复到达。
 */
const LOCAL_STATUS_TEXT = '正在看你的画像和资料…'

/**
 * 三个阶段的兜底文案：服务端 status 的 `text` 就是给用户看的那句话，
 * 正常情况下直接用它（不同方向会不一样，例如"正在翻计算机方向的就业资料…"）；
 * 只在下发为空时按阶段兜一句，避免状态行只剩一个秒数。
 */
const STAGE_FALLBACK_TEXT: Record<ChatStreamStage, string> = {
  reading: LOCAL_STATUS_TEXT,
  thinking: '正在想怎么跟你说…',
  writing: '正在把想好的写下来…',
}

/** 一条回复拆成多个气泡时，气泡之间的间隔（毫秒）。用户要求"大概等三秒下一句话再出来"。 */
const REPLY_BUBBLE_GAP_MS = 3000

/**
 * 揭示 ticker 的检查间隔（毫秒）。
 *
 * 只是"来看一眼到点没有"的频率，不是揭示间隔本身（那是 REPLY_BUBBLE_GAP_MS）。
 * 用 setInterval 而不是 requestAnimationFrame：这是"每几秒推进一格"的节奏，
 * 与帧率无关；rAF 在后台标签页会被暂停，反而把节奏拖乱。
 */
const REVEAL_TICK_MS = 200

interface ChatState {
  conversations: Conversation[]
  activeId: string | null
  messages: ChatMessage[]
  /**
   * 正在等 AI 整条回复的会话 id 列表。
   * 列表而不是单值：切到别的会话再发一句时，前一个会话的回复可能还没回来。
   */
  replyingIds: string[]
  /**
   * 正在流式生成的会话（按会话 id）：只放**回复正文草稿**。
   * 流结束（done / 中断 / 回退非流式收尾）后必须清掉对应条目。
   */
  streams: Record<string, ChatStream>
  conclusionReady: boolean
  conclusion: ChatConclusionCard | null
  loading: boolean
  /**
   * 正在拉开场白的会话 id；null 表示没有在途请求。
   * UI 靠它显示等待态（三点加载），而不是显示静态空态文案。
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
  /** 没有会话时先建一个（发送消息必须带 conversation_id） */
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
  reset: () => void
}

/**
 * 本地对 messages 的写入序号（每本地写一次 +1）。
 *
 * 解决的是什么问题：新建会话时 `ensureConversation()` 会 `set({ activeId })`，
 * 而 ChatPage 有个 `useEffect([activeId])` 会去 `loadMessages()`。那个请求返回时执行
 * `set({ messages: list })` —— **整个数组替换**。但此刻本地已经插入了用户消息，
 * 而这份"历史"里还没有 AI 回复（回复要等生成完才落库）。
 * 如果历史是在 AI 回复上屏之前返回的，它会把刚上屏的回复冲掉。
 *
 * 解法：`loadMessages` 发请求前记下序号，返回后若序号变了，说明这期间本地写过
 * 消息，这份历史比本地状态旧 → **丢弃它**。标记点覆盖乐观插入与回复上屏。
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

/**
 * 在途的 SSE 请求控制器：换号 / reset 时统一 abort。
 *
 * 为什么必须有：fetch 的流不会因为 store 被重置而自己停下，它会继续读下去。
 * 虽然回调里有 `generation !== sessionGeneration` 兜底（不会把上一个账号的数据
 * 写进新账号的内存），但让一个已经作废的 AI 生成继续跑纯属浪费，也会让
 * `replyingIds` 之类的收尾逻辑迟到。abort 是"到此为止"的明确信号。
 *
 * ⚠️ 与 openingRequested 一样：**模块级结构必须能在 reset() 里被清掉**
 * （见 store/reset.ts 的纪律 2）。
 */
const streamControllers = new Map<string, AbortController>()

/**
 * 正在跑的「揭示 ticker」（按会话 id）。
 *
 * 它只负责"每隔 REPLY_BUBBLE_GAP_MS 把 shown 推进一段"，是**展示节奏**，
 * 与网络无关。因此它与 streamControllers 一样是模块级结构，**必须在 reset /
 * abortStream 里被 clearInterval 掉**（纪律 2：模块级结构都要能在 reset 里清掉），
 * 否则一个已经作废的会话会留下一个 200ms 的定时器永久空转。
 */
const revealTimers = new Map<string, ReturnType<typeof setInterval>>()

/** 停掉某个会话的揭示 ticker（没有就 no-op） */
function stopReveal(conversationId: string): void {
  const timer = revealTimers.get(conversationId)
  if (timer === undefined) return
  clearInterval(timer)
  revealTimers.delete(conversationId)
}

/** 中止某个会话在途的 SSE（会话被删除 / 判定不存在时调用） */
function abortStream(conversationId: string): void {
  // 揭示 ticker 先停：被中止的流不该再把 shown 往前推
  stopReveal(conversationId)
  const controller = streamControllers.get(conversationId)
  if (!controller) return
  controller.abort()
  streamControllers.delete(conversationId)
  // 被中止的流不会再走到 finally 的收尾（generation 已经变了）：
  // 这里直接把它的临时态（正文草稿 + shown + status 阶段）擦掉，避免残留
  useChatStore.setState((state) => ({ streams: clearStream(state.streams, conversationId) }))
}

/** 清掉某个会话的流式临时态（不改动别的会话） */
function clearStream(
  streams: Record<string, ChatStream>,
  conversationId: string,
): Record<string, ChatStream> {
  if (!(conversationId in streams)) return streams
  const next = { ...streams }
  delete next[conversationId]
  return next
}

/**
 * 流失败/被掐断时的收尾：在列表末尾放一个「回答中断，点击重试」气泡。
 *
 * `partial` 是**已经流出的正文**：用户在读它，绝不能丢（发新的只会重复生成）。
 * 空串则退化成原有行为（一个只有重试入口的空气泡）。
 * 重试复用同一条用户消息的 client_msg_id（见 retry → send）。
 */
function appendInterrupted(conversationId: string, clientMsgId: string, partial: string): void {
  markLocalWrite()
  const failed: ChatMessage = {
    id: `failed-${clientMsgId}`,
    conversation_id: conversationId,
    role: 'assistant',
    content: partial,
    created_at: new Date().toISOString(),
    interrupted: true,
  }
  useChatStore.setState((state) => ({
    messages: state.activeId === conversationId ? [...state.messages, failed] : state.messages,
  }))
}

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
  // 它上面在途的 SSE 一并中止：流继续跑只会等一个已经被丢弃的结果
  abortStream(conversationId)

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
      streams: clearStream(current.streams, conversationId),
      // 会话都没了，它那份"历史拉到了没有"的结论一并作废
      historyLoad:
        current.historyLoad?.conversationId === conversationId ? null : current.historyLoad,
    }))
    return
  }

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
    streams: clearStream(state.streams, conversationId),
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
  replyingIds: [],
  streams: {},
  conclusionReady: false,
  conclusion: null,
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
    // 它上面在途的 SSE 也中止（回复已经没有归属的界面了）
    abortStream(id)

    // 删的不是当前会话：只是列表少一条，消息区不动
    if (activeId !== id) {
      set((state) => ({ conversations: rest, streams: clearStream(state.streams, id) }))
      return
    }

    /*
     * 删的**正是当前会话**：清空消息区并把 activeId 让给下一条。
     *
     * ⚠️ 这里**有意不碰 profileStore**（不清画像、不 bumpVersion）：
     * 画像标签与成长任务由后端按 user_id 独立存储，删聊天记录**不影响**用户画像 ——
     * 这是产品需求。只有对话里**新抽出标签**才算画像写操作（见 send()）。
     */
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
      streams: clearStream(get().streams, id),
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
      // 这期间本地写过消息（乐观插入 / 回复上屏）→ 这份历史是旧的，丢弃，
      // 否则会把刚上屏的 AI 回复冲掉（见 localWriteSeq 的说明）
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
       * 本地保留的只有两类：带 client_msg_id 的用户消息（服务端已落库就按 key 去重，
       * 还没落库就留着）和失败占位（interrupted，服务端本来就没有它）。
       * AI 回复没有本地占位：它上屏时会 markLocalWrite()，让在途的历史请求整份作废，
       * 所以走到这一步时屏幕上不会有"还没落库的回复"被误删。
       *
       * 兜底去重（serverKeys 里那条消息没有 client_msg_id 时用服务端 id）：
       * 只可能命中"服务端没给 key、本地却有"的错位场景，此时按 id 再拦一次，
       * 保证同一条消息不会出现两份。
       */
      const serverKeys = new Set(list.map(syncKey))
      const localOnly = get().messages.filter(
        (m) => (m.client_msg_id || m.interrupted) && !serverKeys.has(syncKey(m)),
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
    if (!text) return
    // 当前会话上一句还在等回复：不重复发（后端也会以「请勿重复提交」拒绝）
    const current = get().activeId
    if (current && get().replyingIds.includes(current)) return

    // 拿不到 conversation_id 就**不发请求**
    let conversationId: string | null = null
    try {
      conversationId = await get().ensureConversation()
    } catch {
      conversationId = null
    }
    if (!conversationId) {
      toast.error('会话创建失败，请稍后再试')
      return
    }
    const generation = sessionGeneration

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
    // 用户气泡立刻上屏（它的弹出动画就是「发送即出现」）；AI 那一条等整条回复到了再加
    set((state) => ({
      messages:
        state.activeId === conversationId ? [...state.messages, userMessage] : state.messages,
      replyingIds: state.replyingIds.includes(conversationId)
        ? state.replyingIds
        : [...state.replyingIds, conversationId],
      /*
       * 用户开口之后，这个会话就不再是"等着 AI 开场"的空会话了。
       * 这里**只清失败标记**：不再需要"清掉开场白簿记"这种动作 ——
       * "哪条是开场白"现在由 messages 里的 client_msg_id 自己表达，
       * 开场白气泡也不会被后面的 loadMessages 弄丢（见那里的合并规则）。
       */
      openingFailedFor: null,
      /*
       * 发送瞬间的即时反馈：此刻请求还没发出去（下面才调 streamMessage），
       * 先在 streams 里放一条本地 reading 状态。正文草稿此刻为空，
       * UI 会显示三点动画 + 这行字（否则等待区只有动画，像网卡了）。
       * 服务端第一个 status 到达时被替换；第一个 delta 到达时整条清掉。
       */
      streams: {
        ...state.streams,
        [conversationId]: {
          conversationId,
          content: state.streams[conversationId]?.content ?? '',
          // 还没揭示任何内容：第 1 段要等它被 `\n\n` 闭合（或整条回复结束）才出现
          shown: '',
          status: { stage: 'reading' as const, text: LOCAL_STATUS_TEXT, elapsedMs: 0 },
        },
      },
    }))
    // 本地已经写过消息 → 这个会话不再需要开场白
    openingRequested.add(conversationId)
    // 乐观插入属于本地写入：让任何在途的 loadMessages 结果作废
    markLocalWrite()

    track('chat_round', { conversation_id: conversationId })

    /**
     * 已经过空值检查的会话 id 常量。
     * 后面所有异步回调（流事件 / set 的 updater）都在闭包里引用它 ——
     * 用 `const` 而不是外层那个 `let`，TS 的收窄才不会在闭包边界上丢掉。
     */
    const convId: string = conversationId

    /**
     * SSE 在途的**回复正文草稿**（只活在这条流的生命周期里）：
     * done 落成正式消息、失败落成中断气泡、回退非流式时丢弃。
     */
    let streamed = ''
    /**
     * **已经揭示到哪**（`streamed` 的前缀）：UI 渲染的是它。
     *
     * 揭示由下面的 ticker 按 REPLY_BUBBLE_GAP_MS 一格格推进 —— 这是"真人感"：
     * 一条回复拆成 2-3 个气泡时，不能几乎同时冒出来，要隔几秒说一句
     * （见 utils/revealPace.nextReveal 的规则）。
     */
    let revealed = ''
    /**
     * 下一次允许揭示的时间戳。初始 0 = "立刻可以揭示第 1 段"：
     * 第一次揭示**不等** REPLY_BUBBLE_GAP_MS（第 1 段通常在第一个 delta 后
     * 不到 1 秒就被 `\n\n` 闭合，那时就该说话了）。
     */
    let nextRevealAt = 0
    /**
     * 挂起的 done：`shown` 还没追上 `content` 时**不能**提交 ——
     * 一提交就等于把还没显示的段落一瞬间全冒出来（正是用户看到的现象）。
     * 所以先记住 done 的 content，等揭示追上（revealed === streamed）再落库。
     * 落库后由 commitStream 用**完整正文**建消息，每一段此前都已显示过，视觉无缝。
     */
    let pendingCommit: { messageId: string; conclusionReady: boolean } | null = null
    let answered = false
    /** 幂等命中：交回非流式路径处理（见下方 finally 前的收尾判断） */
    let duplicated = false
    /** 信封层 error：后端可能随后照常补 done，所以只记录 */
    let envelopeError: ChatStreamError | null = null
    /**
     * 读当前的信封层 error。
     * 用函数而不是直接读变量：`envelopeError` 只在回调里被赋值，
     * TS 的控制流分析看不见，会在下面直接读时把它收窄成 `null`（进而报 never）。
     */
    const readEnvelopeError = (): ChatStreamError | null => envelopeError

    /**
     * 把草稿写进 streams：`content` = 服务端给到的完整正文，`shown` = 已揭示的前缀。
     * ⚠️ 写出来的是**不带 status** 的新条目：第一段一开始，状态行就让位给气泡
     * （注意是"第一段被揭示"，不是"第一个 delta" —— 节奏化之后，delta 到了也还看不见）。
     */
    const publishDraft = (content: string, shown: string) => {
      if (generation !== sessionGeneration) return
      set((state) => ({
        streams: {
          ...state.streams,
          [convId]: { conversationId: convId, content, shown },
        },
      }))
    }

    /**
     * 把服务端下发的生成阶段写进 streams（不碰正文）。
     * 已经有可见正文就忽略：状态行只在"什么都还没显示出来"的等待期有意义 ——
     * 判据是 `revealed`（而不是 `streamed`）：揭示要先等段落闭合，
     * 这期间用户屏幕上还只有动画，状态行必须继续更新（秒数才不会像卡住）。
     */
    const publishStatus = (stage: ChatStreamStage, text: string, elapsedMs: number) => {
      if (generation !== sessionGeneration) return
      if (revealed) return
      set((state) => ({
        streams: {
          ...state.streams,
          [convId]: {
            conversationId: convId,
            content: state.streams[convId]?.content ?? '',
            shown: state.streams[convId]?.shown ?? '',
            status: { stage, text: text || STAGE_FALLBACK_TEXT[stage], elapsedMs },
          },
        },
      }))
    }

    /** done：把草稿落成一条真正的 assistant 消息（正文不再逐块重渲染） */
    const commitStream = (messageId: string, conclusionReady: boolean) => {
      markLocalWrite()
      set((state) => {
        const isActive = state.activeId === convId
        // 切走再切回时，历史可能已经带上了这条回复：按 id 去重
        // （名字避开 revealed/shown：那个是"显示到哪"，这个是"这条消息在不在")
        const alreadyThere = state.messages.some((m) => m.id === messageId)
        const assistant: ChatMessage = {
          id: messageId,
          conversation_id: convId,
          role: 'assistant',
          content: streamed,
          created_at: new Date().toISOString(),
        }
        return {
          messages:
            isActive && !alreadyThere
              ? [...state.messages, { ...assistant, interrupted: false }]
              : state.messages,
          conclusionReady: isActive && conclusionReady ? true : state.conclusionReady,
          streams: clearStream(state.streams, convId),
        }
      })
      // 对话结束属于画像写操作（tag 事件回流也在这一轮里，统一 bump 一次）
      useProfileStore.getState().bumpVersion()
    }

    /** 揭示结束后的收尾：把这条会话的"在途"标记清掉（等价于 finally 里那份，二选一执行） */
    const finishStream = () => {
      stopReveal(convId)
      if (generation !== sessionGeneration) return
      set((state) => ({
        replyingIds: state.replyingIds.filter((id) => id !== convId),
        streams: clearStream(state.streams, convId),
      }))
    }

    /**
     * 推进一格揭示；揭示完了就收尾，该提交的就提交。ticker 每次、以及每个 delta 之后都会调它。
     *
     * 两个条件缺一不可才会揭示：
     *   ① `now >= nextRevealAt` —— 到点了（上一段之后已过 REPLY_BUBBLE_GAP_MS；
     *      第一次时 nextRevealAt=0，所以立刻可揭示）；
     *   ② `(hasBreak || answered)` —— **这一段已经写完**（后面还有 `\n\n`），或者整个回复
     *      已经结束（单段回复：没有段落可节奏化，一次给完 —— 别让用户白等）。
     *      没有 ② 的话，第一块 delta 一到就会把"半句话"当一段揭示出去，然后冻在那 3 秒，
     *      看起来像卡住而不是像在说话。
     */
    const advanceReveal = () => {
      if (generation !== sessionGeneration) return
      const now = Date.now()
      const hasMore = revealed.length < streamed.length
      const hasBreak = streamed.indexOf('\n\n', revealed.length) !== -1
      if (hasMore && now >= nextRevealAt && (hasBreak || answered)) {
        const next = nextReveal(streamed, revealed)
        if (next !== revealed) {
          revealed = next
          // 下一段要等 3 秒：这才是用户要的"真人感"节奏
          nextRevealAt = now + REPLY_BUBBLE_GAP_MS
          publishDraft(streamed, revealed)
        }
      }

      if (revealed.length >= streamed.length) {
        // 全部揭示完：ticker 不再有用，立刻收掉（不养一个 200ms 的空转定时器）
        stopReveal(convId)
        // done 已经到过（挂起中）→ 此刻才真正落库。因为每一段都已经显示过，
        // 提交那一刻界面上的文字**一个都不会多**（见 pendingCommit 的注释）。
        if (pendingCommit) {
          const { messageId, conclusionReady } = pendingCommit
          pendingCommit = null
          commitStream(messageId, conclusionReady)
          finishStream()
        }
      }
    }

    /** 有待揭示内容时才起 ticker（内容全部显示完 advanceReveal 会自己停掉） */
    const ensureTicker = () => {
      if (revealTimers.has(convId)) return
      revealTimers.set(convId, setInterval(advanceReveal, REVEAL_TICK_MS))
    }

    const controller = new AbortController()
    streamControllers.set(convId, controller)

    try {
      await chatApi.streamMessage(
        convId,
        { content: text, client_msg_id: clientMsgId },
        {
          onDelta: (chunk) => {
            // content 照旧逐块累加（done 提交用的就是它）—— 这里**不直接上屏**
            streamed += chunk
            // 正文属于本地写入：让在途的历史请求结果作废（否则会冲掉这段流式正文）
            markLocalWrite()
            /*
             * 每来一块就试一次揭示：第一次揭示不等 3 秒（nextRevealAt 初始为 0），
             * 所以第 1 段一旦被 `\n\n` 闭合就立刻出现；后面的揭示由 ticker 按节奏推进。
             * ticker 同时起上：有些回复没有下一块 delta 了（等 done），得有东西来推它。
             */
            ensureTicker()
            advanceReveal()
          },
          onStatus: (event) => {
            // 只展示"正在干什么 + 已用时间"，不碰 messages / content
            publishStatus(event.stage, event.text, event.elapsed_ms)
          },
          onTag: () => {
            /* 画像标签回流：done 时统一 bumpVersion，这里不额外触发 */
          },
          onPending: () => {
            // 幂等命中：后端不会重复生成，交回非流式路径（它同样会回放/拒绝重复）
            duplicated = true
          },
          onError: (code, message) => {
            envelopeError = new ChatStreamError(message, true, code)
          },
          onDone: (event) => {
            if (generation !== sessionGeneration) return
            answered = true
            if (revealed.length < streamed.length) {
              /*
               * 正文已经收完了，但界面上还没说完 —— **先挂起**，别提交。
               * 提交会立刻把整条回复渲染出来，等于把还没"说出口"的段落一次性冒出，
               * 前面按节奏揭示的努力全白费。等 advanceReveal 把最后一段揭示出来再落库。
               */
              pendingCommit = {
                messageId: event.message_id,
                conclusionReady: event.conclusion_ready,
              }
              ensureTicker()
              advanceReveal()
              return
            }
            commitStream(event.message_id, event.conclusion_ready)
          },
        },
        controller.signal,
      )

      // 期间换过账号：整份丢弃（新账号的界面不许出现上一个账号的回复）
      if (generation !== sessionGeneration) return

      /*
       * 流没有给出可用的正文：
       *   - 幂等命中（pending）→ 交回非流式接口，它会回放那条已有回复；
       *   - 一帧正文都没有就结束 → 视作建流阶段失败，非流式是更可靠的兜底。
       * 两种情况下 `streamed` 都是空串，所以 started=false，回退是安全的。
       * 有正文但没等到 done（连接被掐断）**绝不回退**：重发会重复调用模型，
       * 交给下面的中断分支保住已流出的文字。
       */
      if (!answered) {
        const streamError = readEnvelopeError()
        throw new ChatStreamError(
          streamError?.message ?? (duplicated ? '该消息已提交过' : '流式请求未完成'),
          streamed.length > 0,
          streamError?.code,
        )
      }
    } catch (error) {
      if (generation !== sessionGeneration) return
      if (isConversationGone(error)) {
        dropGoneConversation(convId)
        return
      }

      const aborted = error instanceof Error && error.name === 'AbortError'
      const streamFailure = error instanceof ChatStreamError ? error : null
      /*
       * 回退非流式的条件：
       *   - 不是用户/重置中止；
       *   - 且「流压根没建立」—— 要么是 fetch 本身抛错（非 ChatStreamError），
       *     要么是 ChatStreamError 且 started=false。
       * 只要读到过一帧（started=true）就绝不回退：重发会重复调用模型。
       */
      const fallbackToRest = !aborted && (streamFailure === null || !streamFailure.started)

      if (fallbackToRest) {
        /*
         * 兜底：SSE 请求本身失败（HTTP 非 2xx / fetch 抛错 / 幂等命中）。
         * 用**同一个 client_msg_id** 走原有非流式接口 —— 后端幂等，不会重复生成；
         * 失败文案与处理（中断气泡）沿用原有逻辑，用户体验不比改动前差。
         *
         * 这条路径**没有事件流**，只能一直显示本地 reading 状态
         * （POST /messages 要等整条回复生成完才 resolve），收到回复后随 streams 一起清掉。
         * 若之前已经收到过服务端的 status，这里也统一换回本地文案：
         * 阶段心跳停了却还停在"正在想…"会让用户以为卡死。
         */
        publishStatus('reading', LOCAL_STATUS_TEXT, 0)
        try {
          const reply = await chatApi.sendMessage(convId, {
            content: text,
            client_msg_id: clientMsgId,
          })
          if (generation !== sessionGeneration) return
          markLocalWrite()
          /*
           * 兜底路径**同样按节奏揭示**（用户要求"多个气泡不能同时冒出来"）。
           * 拿到的是整段回复，所以 content = 全文、shown 重新从 '' 开始，
           * 由 ticker 一句一句说出来；揭示完由 advanceReveal 把挂起的提交落成消息
           * （与 SSE 路径是同一套收尾，不另写一份）。
           */
          streamed = reply.assistant_message.content
          answered = true
          revealed = ''
          nextRevealAt = 0
          pendingCommit = {
            messageId: reply.assistant_message.id,
            conclusionReady: reply.conclusion_ready,
          }
          publishDraft(streamed, revealed)
          ensureTicker()
          advanceReveal()
        } catch (fallbackError) {
          if (generation !== sessionGeneration) return
          if (isConversationGone(fallbackError)) {
            dropGoneConversation(convId)
            return
          }
          appendInterrupted(convId, clientMsgId, '')
        }
        return
      }

      /*
       * 流已经建立过（或用户主动中止）：**不能**自动重发。
       * 已收到的正文一定要留住 —— 用户在读它，重发只会重复调用模型。
       */
      appendInterrupted(convId, clientMsgId, streamed)
    } finally {
      streamControllers.delete(convId)
      /*
       * 挂起提交（done 到了但界面上还没说完）时，ticker 必须**继续跑**：
       * 它负责把剩下的段落一段段说出来，然后才落库并收尾（finishStream）。
       * 这一刻清掉 streams / replyingIds 的话，界面上等着的后几段会被整块抽走。
       */
      const keepRevealing = generation === sessionGeneration && pendingCommit !== null
      if (!keepRevealing) {
        // 其余路径（正常提交完 / 失败 / 中断 / 换号 / 中止）ticker 与临时态一起收掉
        stopReveal(convId)
        if (generation === sessionGeneration) {
          set((state) => ({
            replyingIds: state.replyingIds.filter((id) => id !== convId),
            streams: clearStream(state.streams, convId),
          }))
        }
      }
    }
  },

  /**
   * 重试：删掉失败的气泡和它对应的那条用户消息，再按**原 client_msg_id** 重新发一次。
   * 用户消息也要一起拿掉：send() 会用同一个 id 重新插入它，否则会出现两条一模一样的用户气泡。
   */
  async retry(messageId) {
    const { messages } = get()
    const index = messages.findIndex((m) => m.id === messageId)
    if (index <= 0) return
    const userMessage = messages[index - 1]
    if (userMessage.role !== 'user') return

    set({ messages: messages.slice(0, index - 1) })
    await get().send(userMessage.content, userMessage.client_msg_id ?? undefined)
  },

  reset() {
    // 换号世代 +1：上一个账号在途的请求（列表 / 历史 / 回复）回来时会被丢掉
    sessionGeneration += 1
    /*
     * 上一个账号在途的 SSE：主动 abort。只靠世代号兜底也能不写脏数据，
     * 但让一个作废的 AI 生成继续跑纯属浪费，还会让 replyingIds 的收尾迟到。
     */
    for (const controller of streamControllers.values()) controller.abort()
    streamControllers.clear()
    // 在途流的揭示 ticker 一并停掉：换号后它推的 shown 已经不属于新账号的界面
    for (const timer of revealTimers.values()) clearInterval(timer)
    revealTimers.clear()
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
      replyingIds: [],
      // 流式临时态（正文草稿）同样是按用户的，一并清掉
      streams: {},
      conclusionReady: false,
      conclusion: null,
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
