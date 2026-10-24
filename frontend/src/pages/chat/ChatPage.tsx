import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Send, Trash2 } from 'lucide-react'

import { ChatBubble, ChatTypingBubble } from '@/components/ChatBubble'
import { Panel } from '@/components/Panel'
import { PageHeader } from '@/components/PageHeader'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { ROUTES } from '@/constants/routes'
import { useResponsive } from '@/hooks/useResponsive'
import { useStage } from '@/hooks/useStage'
import { resolveHistoryOutcome, shouldEnsureOpening } from '@/store/chatHistory'
import { isOpeningMessage, openingSettled, useChatStore } from '@/store/chatStore'
import { useProfileStore } from '@/store/profileStore'
import type { Conversation } from '@/types'
import { cn } from '@/lib/utils'

/**
 * AI 职业指导对话（设计说明书 3.2 ②）
 *
 * 布局（桌面端）：CSS grid 两列 —— 左栏 240px，右列吃剩余宽度，对话列在右列里居中（最宽 720px）。
 * - 左栏：当前阶段 + 「AI 对你的了解」（画像标签，说明 AI 只看画像）+ 新对话 + 历史会话
 * - 右列：页头 + 对话区 + 悬浮输入框
 * 不再用运行时量出来的负边距对齐（旧方案会在侧栏宽度变化后跑偏）。
 * 移动端没有左栏：会话改成顶部可横滑的胶囊，「+ 新对话」放在第一个。
 *
 * - **AI 主动开场**：进入空会话时自动拉开场白（POST .../opening），
 *   等待期间显示三点加载，**不再**先给用户看一段"你先说"的静态文案 ——
 *   产品卖点是「AI 主动挖掘」，让用户先开口就是跑题。
 *   只有开场白拉取失败（后端未上线 / 网络故障）时才回落到静态提示。
 *   ⚠️ 补开场白的前提是**本次历史加载成功、且服务端确实说这个会话没有消息**
 *   （store/chatHistory.ts 的 shouldEnsureOpening），**不是** messages 为空。
 * - **历史拉取失败**：有内容就保留内容 + 一条轻提示；没内容就给失败态 + 「重新加载」，
 *   绝不静默空白，也绝不用一条回放的开场白装作"有内容"。
 * - **发送优先 SSE 流式**：正文逐块上屏；流本身失败时 store 自动回退到非流式
 *   POST /messages，体验不降级。等待期间输入框发送按钮禁用。
 *   发送瞬间输入框向上抬一下（liftComposer）。
 * - **多气泡按真人节奏揭示**：一条回复拆出的 2-3 个气泡**不能同时冒出来** ——
 *   store 的 ticker 每约 3 秒才把 `shown` 推进一段，这里渲染 `stream.shown`
 *   （不是完整的 `content`）；最后一段显示完才落成正式消息，提交那一刻不跳字。
 * - **等待区不只有动画**：三点动画上方再给一行真实阶段（正在看你的画像和资料 /
 *   正在翻…资料 / 正在想怎么跟你说… Ns），文案与已用时间都来自服务端 status 事件。
 *   只显示"在干什么"，**不显示**模型思维链原文；正文第一个 delta 到达即让位给气泡。
 * - 悬浮输入框叠在对话区底部之上（底部留白 + 渐隐，内容可以滚到它后面）。
 * - AI 气泡渲染 Markdown 但不允许 HTML 注入（components/ChatBubble）
 * - 中文输入法组合期间回车不发送（compositionstart/end）
 */

/**
 * 发送瞬间：输入框向上抬一下再落回，与用户气泡的弹出同时发生。
 * 用 Web Animations API 直接在元素上播，不改 class，不会因为重渲染被打断。
 * 减少动态效果时不动。
 */
function liftComposer(el: HTMLElement | null) {
  if (!el || typeof el.animate !== 'function') return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  el.animate(
    [
      { transform: 'translateY(0)' },
      { transform: 'translateY(-14px)', offset: 0.35 },
      { transform: 'translateY(0)' },
    ],
    { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  )
}

/** 左栏「AI 对你的了解」最多展示的标签数（按权重排序） */
const RAIL_TAG_LIMIT = 6

export default function ChatPage() {
  const navigate = useNavigate()
  const { isDesktop } = useResponsive()
  const { desc, label: stageLabel } = useStage()
  const tags = useProfileStore((s) => s.tags)
  const profileVersion = useProfileStore((s) => s.version)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const [draft, setDraft] = useState('')
  /** 等待二次确认的会话；null 表示弹窗关闭 */
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null)
  /** 删除请求进行中：禁用确认按钮，防连点 */
  const [deleting, setDeleting] = useState(false)
  /**
   * 「+ 新对话」请求进行中：防连点。
   * 它挡的是**并发**创建（同一瞬间点两下各建一个会话），不是"连点几下只能有一个
   * 会话"—— 按用户的意思，每一次点击都要真的换成一个新会话。
   */
  const [creating, setCreating] = useState(false)
  const composingRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /**
   * 消息区是否已经离开顶部（scrollTop > 0）。
   *
   * 只用来决定「顶部渐隐」开不开：停在顶部时内容不会被切，戴渐隐会白白把第一条
   * 消息的上沿擦掉（短会话尤其明显）；一旦滚动过，上沿才开始有被裁掉的气泡残片，
   * 这时才需要渐隐把它收掉。见 index.css 的 `.chat-scroll-faded`。
   */
  const [chatScrolled, setChatScrolled] = useState(false)

  const {
    conversations,
    activeId,
    messages,
    replyingIds,
    streams,
    openingFor,
    openingFailedFor,
    historyLoad,
    loading,
    loadConversations,
    setActive,
    deleteConversation,
    newConversation,
    loadMessages,
    reloadMessages,
    ensureOpening,
    retryOpening,
    send,
    retry,
  } = useChatStore()

  /** 当前会话的 AI 整条回复还没回来：显示三点加载，发送按钮禁用 */
  const replying = activeId !== null && replyingIds.includes(activeId)
  const sendDisabled = replying || !draft.trim()

  /**
   * 当前会话正在流式生成的**临时态**：`content` 是服务端给到的完整正文，
   * `shown` 是**已揭示**到哪（UI 渲染的是它，见下面 stream.shown 那处渲染）。
   * 按 activeId 取：切到别的会话不会把上一个会话的草稿画上来。
   */
  const stream = activeId ? (streams[activeId] ?? null) : null

  /**
   * 当前会话正在进行的**生成阶段**（reading / thinking / writing）。
   *
   * 它是"AI 到底在干什么"的唯一来源：文案 + 服务端已用时间。刻意**不含**思维链原文 ——
   * 用户要的是"没卡住"的确定感，而不是模型的思考过程。
   * 它只在"屏幕上还什么都看不到"的等待期存在：第一段被揭示出来的那一刻，
   * store 的 publishDraft 写出不带 status 的条目，状态行让位给气泡。
   * （注意不是"第一个 delta" —— 揭示要等段落被 `\n\n` 闭合，那之前用户屏幕上
   *   确实只有动画，状态行反而更该在。）
   */
  const streamStatus = stream?.status ?? null
  /**
   * thinking 阶段显示服务端的已用秒数（每 2 秒被心跳刷新一次）。
   * 直接换算 elapsed_ms，前端**不自己跑秒**：否则断线时数字还会一直涨，
   * 那就成了一种"看起来在动、其实早就死了"的假象。
   */
  const streamStatusElapsedSec = streamStatus ? Math.floor(streamStatus.elapsedMs / 1000) : 0

  /** 画像标签按权重取前几个，给左栏「AI 对你的了解」用 */
  const railTags = [...tags].sort((a, b) => b.weight - a.weight).slice(0, RAIL_TAG_LIMIT)

  /**
   * 「这段会话的历史到底拉到了没有」—— 消息区渲染的**唯一**判据，来自 store 的
   * `historyLoad`（拉历史的结论）而不是 `messages.length`（屏幕上有没有东西）。
   *
   * 两者必须分开：切走再切回时，历史可能只是**这次没拉到**（网络抖动 / 后端重启），
   * 那时 messages 是空的，但服务端明明有 21 条 —— 把"空"当成"没有消息"，
   * 就会去补一条开场白，把 21 条对话显示成只剩开场白。
   * 判定逻辑集中在 store/chatHistory.ts（纯函数，有真值表）。
   */
  const historyOutcome = resolveHistoryOutcome({ activeId, messages, historyLoad })

  /**
   * 开场白对当前会话已经有结论了（有开场白气泡 / 有失败标记）。
   * 见 store 的 openingSettled：判据全部来自"渲染态"，没有需要手工同步的副本。
   */
  const openingFinished = openingSettled({ messages, openingFailedFor }, activeId)
  /**
   * 正在为当前会话拉开场白：**要么请求在途，要么还没拿到结论**（含"历史还在拉"）。
   * 后半个条件让"刚切进一个空会话、请求还没发出去"的那几帧也显示等待态，
   * 不会闪一下兜底空态。
   *
   * 注意顺序：拉历史失败（historyOutcome === 'failed'）的消息区分支排在它**前面**，
   * 否则那几帧的等待态会把失败态盖掉，用户就一直看到"正在想…"。
   */
  const openingPending = activeId !== null && (openingFor === activeId || !openingFinished)
  /** 开场白拉取失败：**只有这时**才回落到静态提示 */
  const openingFailed = openingFailedFor !== null && openingFailedFor === activeId
  /**
   * 当前会话已有 AI 发言、但用户还一句话没说 —— 也就是"等着用户回应开场白"。
   * 输入框上方只给一条很轻的提示，不再用大段文案引导用户先开口。
   */
  const awaitingUserReply =
    messages.length > 0 && !messages.some((m) => m.role === 'user') && !replying
  // 屏幕上那条开场白在不在（用于"回复 AI 的问题"这类上下文文案）——
  // 直接问消息自己（client_msg_id === 'sys:opening'），不查任何"哪条是开场白"的副本
  const hasOpening = messages.some(isOpeningMessage)

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  // 左栏的画像标签随全局画像版本刷新（对话里新抽出标签 → bumpVersion）
  useEffect(() => {
    void fetchProfile()
  }, [fetchProfile, profileVersion])

  /*
   * 消息区的滚动状态（只决定顶部渐隐开不开）。
   * 监听 Radix 的 Viewport：ScrollArea 根节点上收不到 scroll（scroll 不冒泡）。
   * 阈值 4px 留一点余量，避免触控板回弹的 0.5px 抖动把渐隐闪开。
   */
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>(
      '[data-radix-scroll-area-viewport]',
    )
    if (!viewport) return
    const sync = () => setChatScrolled(viewport.scrollTop > 4)
    sync()
    viewport.addEventListener('scroll', sync, { passive: true })
    return () => viewport.removeEventListener('scroll', sync)
  }, [])

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    /*
     * 顺序是**刻意**的：先拉历史，再判断要不要开场白。
     * 反过来的话，messages 里还留着上一个会话的消息，
     * ensureOpening 会因为"已经有消息"直接返回 —— 新会话就永远不开口了。
     *
     * ⚠️ 拉完之后**不能无条件**补开场白（旧代码就是无条件的，这是"对话丢失"那个
     * bug 的第一环）：只有"这次历史真的拉到了、而且服务端说这个会话没有消息"
     * 才补。历史没拉到（网络抖动 / 5xx / 后端 `--reload` 重启中）时，
     * "messages 是空的"只说明**屏幕上**没东西，不代表服务端没有消息 ——
     * 那时候去调 `POST /opening`，后端会按幂等回放那条已有的开场白，
     * 21 条消息的会话就显示成只剩开场白。
     *
     * 这里读 getState() 而不是闭包里的值：await 之后闭包里的 messages / historyLoad
     * 还是这次 effect 开始时的旧值，拿它判断等于判断了个过期快照。
     */
    void (async () => {
      await loadMessages(activeId)
      if (cancelled) return
      if (shouldEnsureOpening(useChatStore.getState(), activeId)) {
        await ensureOpening(activeId)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeId, loadMessages, ensureOpening])

  useEffect(() => {
    if (!activeId) return
    if (loading) return
    /*
     * 安全网：历史**已经拉到**、服务端**确实说这个会话没有消息**、而且本次进入
     * 还没拉过开场白 → 补拉一次（典型场景：点侧栏里一个空的旧会话）。
     *
     * 它保证「空会话」在结构上有唯一去向：要么有一次在途请求（显示三点加载），
     * 要么有失败标记（显示静态回落 + 重试按钮），绝不会出现"既没气泡、
     * 也没等待态、也没失败态"。
     *
     * ⚠️ 判据**不是** messages.length（那正是本次 bug：把"这次没拉到"当成
     * "服务端没有消息"），而是 shouldEnsureOpening —— 它只认"加载成功且服务端为空"。
     * 历史拉失败时它一律为假，所以这里**不会**再给一个拉不到历史的会话补开场白。
     * 幂等由 store 的 openingRequested / openingInFlight 兜住，重复触发不会多发请求。
     */
    if (!shouldEnsureOpening(useChatStore.getState(), activeId)) return
    void ensureOpening(activeId)
  }, [activeId, loading, messages, openingFailedFor, historyLoad, ensureOpening])

  // 新消息（或等待占位出现、或流式正文增长）滚到底；
  // 底部留白在消息列表末尾，保证最后一条不被输入框遮住。
  // 依赖里带上流式正文长度，否则逐块增长时不会跟随滚动。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, replying, stream?.shown.length])

  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text || replying) return
    setDraft('')
    liftComposer(composerRef.current)
    void send(text)
  }, [draft, replying, send])

  /**
   * 「+ 新对话」：**立即**建一个新会话并切过去（见 store 的 newConversation：
   * 每次点击都真的新建，上一个会话**原样留在侧栏**（前端不自动删任何会话：
   * 每个会话都是 AI 已经开好头的一个话题，要清理由用户点侧栏的垃圾桶）。
   *
   * 上一句还在等回复也可以直接新开：那一句的回复会留在它自己的会话里，
   * 切回去时就能看到（后端已经保存）。
   */
  const handleNewConversation = useCallback(async () => {
    if (creating) return
    setCreating(true)
    try {
      await newConversation()
    } finally {
      setCreating(false)
    }
  }, [creating, newConversation])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // 中文输入法组合态：回车用于选词，不发送
    if (composingRef.current || event.nativeEvent.isComposing) return
    event.preventDefault()
    handleSend()
  }

  /**
   * 确认删除。store 内部已经 catch 了失败（toast 报错且不改列表），不会抛，
   * 所以这里 finally 一定能关弹窗。
   */
  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteConversation(deleteTarget.id)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, deleting, deleteConversation])

  /*
   * 高度 = 视口 − 外壳占掉的那一段，而且必须**正好等于 main 的内容盒高度**：
   * 多一点页面就会滚。这一页的规矩是「对话再长也只有对话区滚，页面本身不动」。
   *   · 桌面：main 的竖向内边距 = pt-shell(76) + pb-margin(32) = --spacing-shell-total(108)
   *   · 移动：pb-margin 被换成了 pb-24(96) = --spacing-tabbar(64) + --spacing-margin(32)，
   *           所以再扣掉一个 --spacing-tabbar
   * ⚠️ 早先写的是 `100svh - --spacing-shell`（少扣了底部那 32px），实测桌面端页面
   * 恒定多出 32px 可以滚；再配一个 `min-h-[560px]`，矮窗口（1440×560）整页能滚 108px。
   * 那个 min-h 已经删掉：它和「页面不可滚」是直接矛盾的，矮窗口宁可把对话区压扁。
   * 根上再加 `overflow-hidden` 兜底 —— 就算某个子树撑出高度，也绝不会把整页顶出滚动条。
   */
  return (
    <div className="mx-auto grid h-[calc(100svh-var(--spacing-shell-total))] w-full grid-cols-1 gap-4 overflow-hidden max-md:h-[calc(100svh-var(--spacing-shell-total)-var(--spacing-tabbar))] lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-6">
      {/* 左栏（桌面端）：阶段 + AI 对你的了解 + 新对话 + 历史会话 */}
      {isDesktop ? (
        <aside className="flex min-h-0 flex-col gap-3">
          {/* 侧栏退后：卡外浅底 + 去阴影，白卡与赭金都留给对话本身 */}
          <Panel className="shrink-0 gap-3 bg-surface-container-low shadow-none">
            <div className="flex flex-col gap-2">
              <p className="text-caption tracking-wide text-caption-foreground">当前阶段</p>
              {/* 侧栏的赭金预算为零：阶段只留中性圆点 + 名称，阶段说明就在下一行 */}
              <span className="flex items-center gap-2 self-start text-label-md font-medium text-primary">
                <span className="size-1.5 rounded-full bg-on-surface-variant/50" aria-hidden />
                {stageLabel}
              </span>
              <p className="text-body-sm text-on-surface-variant">{desc}</p>
            </div>

            <div className="h-px bg-outline-variant/50" />

            <div className="flex flex-col gap-2">
              <p className="text-caption tracking-wide text-caption-foreground">AI 对你的了解</p>
              {railTags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {railTags.map((tag) => (
                    <span
                      key={tag.id}
                      className="rounded-full bg-surface-inset px-2.5 py-1 text-body-sm text-on-surface-variant"
                    >
                      {tag.label}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-body-sm text-on-surface-variant">
                  还没有标签。聊几轮，AI 会记下你的情况。
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(ROUTES.profile)}
                className="self-start px-0 text-body-sm text-on-surface-variant hover:bg-transparent hover:text-primary"
              >
                查看完整画像 →
              </Button>
            </div>
          </Panel>

          <Button
            variant="outline"
            onClick={() => void handleNewConversation()}
            disabled={creating}
            className="shrink-0 gap-1.5 bg-surface-inset"
          >
            <Plus className="size-4" />
            新对话
          </Button>

          <Panel padded={false} className="min-h-0 flex-1 overflow-hidden bg-surface-container-low py-2 shadow-none">
            <p className="px-4 pt-2 pb-2 text-caption tracking-wide text-caption-foreground">历史会话</p>
            {/* px/py：给列表项留出余量 —— 选中态是外描边(ring)，ScrollArea 的 Viewport 会
                裁掉溢出，贴边时圆角和描边就会被切平（实拍踩过）。
                右侧 pr-3.5(14px) 是给滚动条留的专用窄道（滚动条 w-2.5=10px）：
                两栏挤在同一像素列上时，滚动条会盖住行尾的删除按钮，点不到（实拍踩过）。

                `[&>div>div]:block!` 不是装饰，是这条列表能截断的前提：
                Radix 在 Viewport 里多塞了一层 `<div style="min-width:100%;display:table">`
                （见 @radix-ui/react-scroll-area/dist/index.mjs）。结构是 Root > Viewport > 这层 div，
                所以选择器要写成 `>div>div` 才命中；table 宽度按内容撑开，
                而标题是 whitespace-nowrap，最小宽度=整句标题 → 整行被撑得比侧栏还宽：
                选中底/描边溢出面板被裁、标题省略号落在容器外（等于不截断）、
                删除按钮 `right-1` 跟着跑到可视区右边之外，怎么调透明度都看不见。
                内联 style 只能用 !important 压住；压成 block 后行宽=可视宽，
                truncate 与按钮定位才都回到面板内。 */}
            <ScrollArea className="min-h-0 flex-1 py-1 pr-3.5 pl-2 [&>div>div]:block!">
              {conversations.length ? (
                conversations.map((conversation) => (
                  /*
                   * 会话项 = 「切换会话」按钮 + 右侧删除按钮的兄弟组合。
                   * 不用"按钮套按钮"（非法 HTML、点击目标也会打架）。
                   */
                  <div key={conversation.id} className="group relative text-body-sm">
                    <button
                      type="button"
                      onClick={() => setActive(conversation.id)}
                      className={cn(
                        // pr-8 给右侧删除图标留位，标题仍然 truncate
                        'w-full truncate rounded-md py-2 pr-8 pl-3 text-left transition-colors',
                        conversation.id === activeId
                          ? // 选中态：比侧栏浅一档的小底 + 主墨；不抢对话区的白卡
                            'bg-surface-inset font-medium text-primary ring-1 ring-inset ring-outline-variant/70'
                          : // 侧栏退后：14px + 次要墨色，不和正文的 15px 主墨抢
                            'text-on-surface-variant hover:bg-surface-inset/70 hover:text-primary',
                      )}
                    >
                      {conversation.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`删除会话「${conversation.title}」`}
                      disabled={deleting}
                      // 图标是会话项的兄弟节点，理论上不会冒泡到"切换会话"；
                      // 这里显式拦一层，防止以后挪进按钮内部时悄悄变成"删完顺手切走"
                      onClick={(event) => {
                        event.stopPropagation()
                        setDeleteTarget(conversation)
                      }}
                      className={cn(
                        'absolute top-1/2 right-1 z-10 -translate-y-1/2 rounded-sm p-1',
                        // 常显：原先 opacity-0 + group-hover 才出现，鼠标没停在行上时
                        // 用户根本看不到删除入口（截图里整行只有标题）。现在常态半透明，
                        // hover / 键盘聚焦时加深并转红，既不抢标题又随时可点。
                        'text-caption-foreground/60 transition-colors',
                        'hover:bg-surface-inset hover:text-destructive active:text-destructive',
                        // 键盘 Tab 到它时也要看得见
                        'focus-visible:bg-surface-inset focus-visible:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        // 触摸设备没有 hover：直接给足对比度
                        'pointer-coarse:text-caption-foreground',
                        'disabled:pointer-events-none disabled:opacity-50',
                      )}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="px-2 py-3 text-body-sm text-on-surface-variant">
                  还没有历史会话，点「新对话」我来先开口。
                </p>
              )}
            </ScrollArea>
          </Panel>
        </aside>
      ) : null}

      {/*
        右列：页头 + 对话区。对话列在右列里居中（最宽 720px），页头与它对齐。

        2026-10-22：页头（含移动端会话胶囊）整体包进一层 `relative z-10 bg-surface`
        的容器；原来的 `gap-4` 换成容器自己的 `pb-4`，让页头的实底一直铺到
        滚动区上沿，中间不留缝。

        黑条的真正来源（当天实测纠正）：不是 bubble-pop 的合成层逃逸，而是
        **一条用户气泡刚好滚到视口上沿之外** —— 只剩底部 17px 的深墨圆角露在
        视口里，没有文字，看起来就像一条悬空的黑条。ScrollArea 的裁剪本身是对的
        （hit-test 和像素都停在视口上沿）。
        所以修法不是继续加遮罩，而是给视口顶部一段**渐隐**（滚动过才挂
        `.chat-scroll-faded`，见 index.css / 本文件的 chatScrolled）：顶部 18px
        完全透明、到 48px 才完全显现，17px 的气泡残片直接看不见；正常滚动时消息
        从顶部柔和淡入，也不会被硬切。停在顶部时不挂，短会话的第一条消息不受影响。
      */}
      <div className="mx-auto flex min-h-0 min-w-0 w-full max-w-[720px] flex-col">
        <div className="relative z-10 flex shrink-0 flex-col gap-4 bg-surface pb-4">
          <PageHeader
            title="把求职里的困惑聊开"
            /*
              2026-10-22：这句压成一行。原句 44 字，在 1440 宽下被右侧「生成简历」
              挤成两行、末行只剩「像。」一个词；现在仍说同一件事（跟着阶段走 /
              新对话不带记忆 / 只看画像），但能一行放完。
            */
            description="主题：跟着你的阶段走。新对话重新开始，只看你的画像。"
            actions={
              /*
                这里**不说**"AI 自动生成"：简历页只润色用户写的内容，不替他编经历。
              */
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/resume')}
                className="gap-1.5"
              >
                <FileText className="size-4" />
                生成简历
              </Button>
            }
          />

          {/* 移动端没有左侧会话栏：用一排可横滑的胶囊代替，「+ 新对话」放第一个 */}
          {!isDesktop ? (
            <div className="flex shrink-0 gap-2 overflow-x-auto px-1 pb-1 text-body-sm">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleNewConversation()}
                disabled={creating}
                className="shrink-0 gap-1 rounded-full"
              >
                <Plus className="size-3.5" />
                新对话
              </Button>
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setActive(conversation.id)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1 transition-colors',
                    conversation.id === activeId
                      ? 'bg-surface-inset font-medium text-primary ring-1 ring-inset ring-outline-variant/70'
                      : 'text-on-surface-variant ring-1 ring-inset ring-outline-variant/60 hover:bg-surface-inset hover:text-primary',
                  )}
                >
                  {conversation.title}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/*
            历史这次没拉到、但屏幕上还有内容：**保留内容**，只在最上面加一条很轻的提示
            （放在滚动区**外面**才不会被"新消息滚到底"顶出视野）。

            两种情况必须分开取舍：
              - 有内容时（这里）：用户能看到的东西比"一个干净的报错页"更有价值，
                缺的只是"最新那几条"，所以绝不能用失败态把已有内容盖掉；
              - 没内容时（下面 messages 为空那个分支）：屏幕上什么都没有，
                就必须给明确的失败态 + 「重新加载」，否则就是静默空白。
            两条路径都**没有**"清空 messages"这类动作。
          */}
          {historyOutcome === 'stale-content' ? (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-outline-variant/50 px-1 py-2">
              <p className="text-body-sm text-on-surface-variant">
                最新的聊天记录这次没读出来，下面看到的可能不是最新的。
              </p>
              <Button variant="outline" size="sm" onClick={() => void reloadMessages()}>
                重新加载
              </Button>
            </div>
          ) : null}

          {/*
            对话区 + 输入框：输入框**浮在对话区之上**，消息从它后面滚过 ——
            输入区那一条用画布色实底（不是渐隐），滚过去的文字被整块盖住，不会露头。
            对话区底部留出与输入区等高的内边距，保证最后一条能完整滚到输入框上方。
          */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* 高度交给 flex（旧写法死高 440px，窗口一矮就出现"卡内再滚一层"的双重滚动条） */}
            {/*
              ⚠️ 上下留白**不能**加在 ScrollArea 的 className 上：它的 Viewport 是
              `size-full`，根上的内边距会把可视区一起缩小，于是裁切边出现在输入框上方
              24px 处、输入框够不到（滚动时能看见气泡被切一半）。
              留白一律加在**滚动内容**里：可视区一直延伸到容器底部（藏在输入框后面）。
            */}
            <ScrollArea
              ref={scrollRef}
              className={cn(
                'chat-scroll min-h-0 flex-1 px-3',
                chatScrolled && 'chat-scroll-faded',
              )}
            >
              {messages.length ? (
                <div className="flex flex-col gap-4 pt-4">
                  {messages.map((message) => (
                    <ChatBubble
                      key={message.client_msg_id ?? message.id}
                      role={message.role === 'assistant' ? 'assistant' : 'user'}
                      content={message.content}
                      interrupted={message.interrupted}
                      onRetry={() => void retry(message.id)}
                    />
                  ))}
                  {/*
                    流式生成中：正文逐块增长的气泡。
                    它不在 messages 里 —— done 时才用服务端 message_id 落成正式消息。
                  */}
                  {/*
                    这里渲染的是 `shown`（**已揭示**的前缀），不是 `content`（服务端给到的完整正文）。
                    多段回复由 store 的 ticker 按 3 秒一段推进 shown —— 所以气泡是
                    "一句一句说出来"的，而不是同一瞬间全部冒出来。
                  */}
                  {stream?.shown ? (
                    <ChatBubble key={`stream-${activeId}`} role="assistant" content={stream.shown} />
                  ) : null}
                  {/*
                    还没有可展示的正文时：三点加载占位 + 一行"正在干什么"。
                    三点动画是"还活着"的信号，状态文字是"具体在干什么"——
                    两者都要有，光有动画用户会以为是网卡了。
                  */}
                  {replying && !stream?.shown ? (
                    <div className="flex w-full flex-col gap-1.5">
                      <ChatTypingBubble />
                      {streamStatus ? (
                        <p className="pl-4 text-body-sm text-on-surface-variant tabular-nums">
                          {streamStatus.text}
                          {/*
                            reading / writing 是瞬时阶段，只有 text；
                            thinking 是每 2 秒一次的心跳，带上服务端的已用秒数。
                          */}
                          {streamStatus.stage === 'thinking'
                            ? ` ${streamStatusElapsedSec}s`
                            : null}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {/*
                    尾部占位块（不是 padding）：scrollIntoView(block:'end') 会把它的
                    底边对齐到可视区底边 —— 它本身占满输入区的高度，滚到底时最后一条
                    正好停在输入框上方。用 padding 的话滚不到真正的底部（会差一整个高度）。
                    h-32 覆盖三行输入的上限（max-h-24）与「答不上来」提示的余量，
                    输入框长高时最后一条气泡也不会被盖住。
                  */}
                  <div ref={bottomRef} className="h-32" />
                </div>
              ) : historyOutcome === 'failed' ? (
                /*
                 * 历史**这次没拉到**、屏幕上也没有任何内容 → 明确的失败态 + 重新加载。
                 *
                 * 这个分支必须排在 openingPending 前面：拉不到历史时开场白也不该补
                 * （见两个 effect 的判据），若不拦在这里，页面上那几帧的等待态
                 * 会一路转下去，或者更糟 —— 被一条回放的开场白装作"有内容"。
                 *
                 * 文案刻意**不说**"记录没了"：一条都没少，只是这次没读出来。
                 */
                <div className="flex min-h-full flex-col items-center justify-center gap-3 pt-4 pb-24 text-center">
                  <p className="text-body-md text-primary">这段对话这次没读出来。</p>
                  <p className="text-body-sm text-on-surface-variant">
                    你说的每一句都还在，只是网络这次没把记录送过来。
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void reloadMessages()}>
                    重新加载
                  </Button>
                </div>
              ) : openingPending ? (
                /*
                 * AI 正在准备开场白：显示三点加载（和 AI 回复时的等待占位是同一个东西）。
                 * 这里**绝不能**回落到静态空态文案 —— 那等于在说"该你先开口了"，
                 * 与「AI 主动挖掘」的卖点正好相反。
                 */
                <div className="flex flex-col gap-4 pt-4 pb-24">
                  <ChatTypingBubble />
                </div>
              ) : openingFailed ? (
                /*
                 * 开场白拉取失败（后端不可用 / 网络故障 / 路由未上线）：才回落到静态提示，
                 * 并且**允许用户直接输入**（输入框任何时候都可用），不把人卡在等待态。
                 * 文案必须说清楚是「服务没连上」，不能含糊成"AI 不想说话"。
                 */
                <div className="flex min-h-full flex-col items-center justify-center gap-3 pt-4 pb-24 text-center">
                  <p className="text-body-md text-primary">AI 服务暂时没连上。</p>
                  <p className="text-body-sm text-on-surface-variant">
                    你可以先说说自己的情况，也可以点下面的按钮让 AI 重新开口。
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void retryOpening()}>
                    让 AI 先开口
                  </Button>
                </div>
              ) : (
                /*
                 * 兜底空态：正常情况下走不到这里（空会话一定有在途请求或失败标记）。
                 * 文案刻意**不推责任给用户** —— 不说"你先说点什么"，而是说明
                 * "我这边还没开口，点新对话我就先问"。定位是 AI 主动挖掘，
                 * 让用户面对空白输入框自己找话题就是跑题。
                 */
                <div className="flex min-h-full flex-col items-center justify-center gap-2 pt-4 pb-24 text-center">
                  <p className="text-body-md text-on-surface-variant">
                    还没有开始聊的会话。点「新对话」，我先把第一个问题问出来。
                  </p>
                </div>
              )}
            </ScrollArea>

            {/*
              输入区：一个胶囊（内含透明的自动增高输入）+ 右侧圆形发送按钮。
              发送瞬间整块上抬（liftComposer），与用户气泡的弹出同步。
            */}
            <div ref={composerRef} className="absolute inset-x-0 bottom-0 bg-canvas px-3 pt-2 pb-3 md:pb-4">
              {/*
                很轻的一条兜底提示：AI 开场后用户可能"答不上来"。
                只放一行小字 —— 不用大段静态文案去引导用户先开口（那是"假主动"）。
              */}
              {awaitingUserReply ? (
                <p className="mb-2 px-4 text-body-sm text-on-surface-variant">
                  答不上来也没关系，说半句、说错都行，我顺着往下问。
                </p>
              ) : null}
              <div className="flex items-end gap-2 rounded-2xl bg-card py-1.5 pr-1.5 pl-4 shadow-pop ring-1 ring-outline-variant/50">
                {/*
                  输入框跟随内容长高，但封顶 max-h-24（约三行）：再长就在框内滚，
                  否则输入区会一路顶到对话区、把最后几条气泡盖住（移动端 390×844 尤其明显）。
                  字号必须写死 15px（body-md）：Textarea 自带 text-base / md:text-sm 会在 CSS 顺序上
                  把同名 text-* token 顶掉，所以这里直接取 token 的 CSS 变量落 font-size。
                */}
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => {
                    composingRef.current = true
                  }}
                  onCompositionEnd={() => {
                    composingRef.current = false
                  }}
                  rows={1}
                  maxLength={2000}
                  placeholder={
                    hasOpening
                      ? '回答 AI 的问题…（Enter 发送，Shift+Enter 换行）'
                      : '说点什么…（Enter 发送，Shift+Enter 换行）'
                  }
                  className="max-h-24 min-h-0 resize-none overflow-y-auto border-0 bg-transparent px-0 py-2 leading-[1.6] shadow-none [font-size:var(--text-body-md)] focus-visible:ring-0"
                />
                {/* 本页唯一的赭金实心块：发送。别再在页面别处加第二处赭金底 */}
                <Button
                  variant="warm"
                  size="icon-lg"
                  onClick={handleSend}
                  disabled={sendDisabled}
                  aria-label="发送"
                  className="shrink-0 rounded-full bg-secondary text-on-secondary transition-colors hover:bg-secondary/90"
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/*
        删除二次确认（整页共用一个：每个会话项各挂一份 state 没必要，
        而且 isDesktop 切到移动端时会话列表会整块卸载，共用的这份不受影响）。
        AlertDialogAction 默认"点完就关"，这里 preventDefault 拦住，
        等请求结束再手动关 —— 中间按钮是 disabled，连点无效。
      */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          // 删除进行中不接受 ESC / 遮罩点击关闭，避免"以为取消了其实已经删了"
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个会话？</AlertDialogTitle>
            <AlertDialogDescription>
              对话记录会被删除，且无法恢复。你不受影响——画像和成长任务都会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmDelete()
              }}
            >
              {deleting ? '删除中…' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
