import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Send, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { ChatBubble } from '@/components/ChatBubble'
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
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { isOpeningMessage, loadConclusion, openingSettled, useChatStore } from '@/store/chatStore'
import { resolveHistoryOutcome, shouldEnsureOpening } from '@/store/chatHistory'
import { useResponsive } from '@/hooks/useResponsive'
import { useStage } from '@/hooks/useStage'
import type { Conversation } from '@/types'
import { cn } from '@/lib/utils'

/**
 * AI 职业指导对话（设计说明书 3.2 ②）
 *
 * - **AI 主动开场**：进入空会话时自动拉开场白（POST .../opening），
 *   等待期间显示 AIThinking，**不再**先给用户看一段"你先说"的静态文案 ——
 *   产品卖点是「AI 主动挖掘」，让用户先开口就是跑题。
 *   只有开场白拉取失败（后端未上线 / 网络故障）时才回落到静态提示。
 *   ⚠️ 补开场白的前提是**本次历史加载成功、且服务端确实说这个会话没有消息**
 *   （store/chatHistory.ts 的 shouldEnsureOpening），**不是** messages 为空 ——
 *   拉不到历史时补开场白，会让"21 条消息的会话"显示成只剩一句开场白。
 * - **历史拉取失败**：有内容就保留内容 + 一条轻提示；没内容就给失败态 + 「重新加载」，
 *   绝不静默空白，也绝不用一条回放的开场白装作"有内容"。
 * - 流式中：发送按钮变「停止」（AbortController），禁止重复发送
 * - AI 气泡渲染 Markdown 但不允许 HTML 注入（components/ChatBubble）
 * - 结论卡片：后端 done 事件 conclusion_ready=true 时浮出可折叠卡片
 * - 中文输入法组合期间回车不发送（compositionstart/end）
 */

export default function ChatPage() {
  const navigate = useNavigate()
  const { isDesktop } = useResponsive()
  const { stage } = useStage()
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

  const {
    conversations,
    activeId,
    messages,
    streamState,
    conclusionReady,
    conclusion,
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
    stop,
  } = useChatStore()

  const streaming = streamState === 'streaming' || streamState === 'connecting'
  const lastMessage = messages.at(-1)
  const sendDisabled = streaming || !draft.trim()

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
   * 输入框下面只给一条很轻的提示，不再用大段文案引导用户先开口。
   */
  const awaitingUserReply =
    messages.length > 0 && !messages.some((m) => m.role === 'user') && !streaming
  // 屏幕上那条开场白在不在（用于"回复 AI 的问题"这类上下文文案）——
  // 直接问消息自己（client_msg_id === 'sys:opening'），不查任何"哪条是开场白"的副本
  const hasOpening = messages.some(isOpeningMessage)

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

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
     * 它保证「空会话」在结构上有唯一去向：要么有一次在途请求（显示 AIThinking），
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

  // 新消息滚到底（长对话后续可换虚拟列表，见第 7 章风险）
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, lastMessage?.content])

  const handleSend = useCallback(() => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    void send(text)
  }, [draft, send, streaming])

  /**
   * 「+ 新对话」：**立即**建一个新会话并切过去（见 store 的 newConversation：
   * 每次点击都真的新建，上一个会话**原样留在侧栏**（前端不自动删任何会话：
   * 每个会话都是 AI 已经开好头的一个话题，要清理由用户点侧栏的垃圾桶）。
   * 不再只把 activeId 置为 null —— 那样连会话都不存在，"AI 先开口"根本无从谈起。
   *
   * ⚠️ 流式期间**不新建**，而是给一条轻提示：
   * `stop()` 中断这一轮之后，后端不会把已生成的部分落库（后端是在流式循环
   * 正常结束后才 `_save_assistant_message`，客户端断开会让生成器在 yield 处
   * 被取消，落库那几行永远不会执行），而前端的中断分支只把 streamState 置回 idle，
   * 既不打 `interrupted` 标记、也没有任何重试入口（ChatBubble 的重试按钮只在
   * `interrupted` 为真时才渲染）。也就是说：中断 = 这段回复在历史里静默消失、
   * 用户还无从重试 —— 那不能替用户做这个决定，只能如实告诉他先等这一轮说完。
   */
  const handleNewConversation = useCallback(async () => {
    if (creating) return
    if (streaming) {
      toast.info('上一轮还在回复，等它说完再开新对话')
      return
    }
    setCreating(true)
    try {
      await newConversation()
    } finally {
      setCreating(false)
    }
  }, [creating, streaming, newConversation])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    // 中文输入法组合态：回车用于选词，不发送
    if (composingRef.current || event.nativeEvent.isComposing) return
    event.preventDefault()
    handleSend()
  }

  const handleGenerateConclusion = () => {
    if (!activeId) {
      toast.info('先选一个会话')
      return
    }
    void loadConclusion(activeId)
      .then(() => toast.success('结论卡片已生成'))
      .catch(() => toast.error('还差一点信息，再多聊两句'))
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

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold text-foreground">职业指导对话</h1>
          <p className="text-sm text-muted-foreground">主题：跟着你的阶段走</p>
          {/*
            文案之所以要点明「新对话 = 重新开始」：这是**产品决定**（用户确认过）——
            每个新对话都是一次全新的陪伴，它**故意不知道**你上一段聊了什么，
            只带着你的画像档案（标签/任务）从零开口。
            不写清楚的话，用户会以为是 AI 失忆、或者"怎么又问一遍"。
          */}
          <p className="text-xs text-muted-foreground">
            新对话是重新开始：不带上一段聊天的记忆，只看你的画像。
          </p>
        </div>
        {/*
          两个次级动作并排：生成简历（去 /resume 自己填）与 + 新对话。
          这里**不说**"AI 自动生成"：简历页只润色用户写的内容，不替他编经历。
        */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/resume')}
            className="gap-1.5"
          >
            <FileText className="size-4" />
            生成简历
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleNewConversation()}
            disabled={creating}
            // 流式期间不禁用按钮（禁用等于"点了没反应"），而是点出提示；
            // 悬停时也把原因说清楚
            title={streaming ? '上一轮还在回复，等它说完再开新对话' : undefined}
            className="gap-1.5"
          >
            <Plus className="size-4" />
            新对话
          </Button>
        </div>
      </header>

      <div className={cn('flex gap-4', isDesktop ? 'flex-row' : 'flex-col')}>
        {/* 会话列表（桌面端左栏） */}
        {isDesktop ? (
          <aside className="w-[200px] shrink-0">
            <ScrollArea className="h-[520px] rounded-xl border bg-card p-2">
              {conversations.length ? (
                conversations.map((conversation) => (
                  /*
                   * 会话项 = 「切换会话」按钮 + 右侧删除按钮的兄弟组合。
                   * 不用"按钮套按钮"（非法 HTML、点击目标也会打架）。
                   */
                  <div key={conversation.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setActive(conversation.id)}
                      className={cn(
                        // pr-8 给右侧删除图标留位，标题仍然 truncate
                        'w-full truncate rounded-md py-2 pr-8 pl-3 text-left text-sm transition-colors',
                        conversation.id === activeId
                          ? 'bg-primary-soft text-primary'
                          : 'text-muted-foreground hover:bg-secondary',
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
                        'absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-1 text-muted-foreground',
                        'opacity-0 transition-opacity group-hover:opacity-100',
                        // 键盘 Tab 到它时也要看得见
                        'focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        // 触摸设备没有 hover：常显，否则用户根本看不到入口
                        'pointer-coarse:opacity-100',
                        'hover:text-destructive disabled:pointer-events-none disabled:opacity-50',
                      )}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))
              ) : (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  还没有历史会话，点上面的「新对话」我来先开口。
                </p>
              )}
            </ScrollArea>
          </aside>
        ) : null}

        {/* 消息区 + 输入区 */}
        <Card className="flex min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <p className="text-xs text-muted-foreground">
                最新的聊天记录这次没读出来，下面看到的可能不是最新的。
              </p>
              <Button variant="outline" size="xs" onClick={() => void reloadMessages()}>
                重新加载
              </Button>
            </div>
          ) : null}
          <ScrollArea className="h-[440px] px-4 py-4">
            {messages.length ? (
              <div className="flex flex-col gap-4">
                {messages.map((message, index) => (
                  <ChatBubble
                    key={message.id}
                    role={message.role === 'assistant' ? 'assistant' : 'user'}
                    content={message.content}
                    streaming={
                      streaming && message.role === 'assistant' && index === messages.length - 1
                    }
                    interrupted={message.interrupted}
                    onRetry={() => void retry(message.id)}
                  />
                ))}
                {streaming && !openingPending && lastMessage?.role === 'assistant' && !lastMessage.content ? (
                  <AIThinking stage={stage} lines={2} className="max-w-[75%]" />
                ) : null}
                <div ref={bottomRef} />
              </div>
            ) : historyOutcome === 'failed' ? (
              /*
               * 历史**这次没拉到**、屏幕上也没有任何内容 → 明确的失败态 + 重新加载。
               *
               * 这个分支必须排在 openingPending 前面：拉不到历史时开场白也不该补
               * （见两个 effect 的判据），若不拦在这里，页面上那几帧的 waiting 态
               * 会一路转下去，或者更糟 —— 被一条回放的开场白装作"有内容"。
               *
               * 文案刻意**不说**"记录没了"：一条都没少，只是这次没读出来。
               */
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-foreground">这段对话这次没读出来。</p>
                <p className="text-xs text-muted-foreground">
                  你说的每一句都还在，只是网络这次没把记录送过来。
                </p>
                <Button variant="outline" size="sm" onClick={() => void reloadMessages()}>
                  重新加载
                </Button>
              </div>
            ) : openingPending ? (
              /*
               * AI 正在准备开场白：显示等待态。
               * 这里**绝不能**回落到静态空态文案 —— 那等于在说"该你先开口了"，
               * 与「AI 主动挖掘」的卖点正好相反。
               */
              <div className="flex h-full flex-col justify-center">
                <AIThinking stage={stage} text="正在想从哪一件事问起…" lines={2} />
              </div>
            ) : openingFailed ? (
              /*
               * 开场白拉取失败（例如后端 /opening 路由还没上线）：才回落到静态提示，
               * 并且**允许用户直接输入**（输入框任何时候都可用），不把人卡在等待态。
               */
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm text-foreground">
                  先别急着定方向，跟我说说你现在最纠结的事。
                </p>
                <p className="text-xs text-muted-foreground">
                  比如「我不知道自己适合什么」「投了几家没回音」
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
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm text-muted-foreground">
                  还没有开始聊的会话。点右上角「新对话」，我先把第一个问题问出来。
                </p>
              </div>
            )}
          </ScrollArea>

          {/* 结论卡片（后端 done 事件 conclusion_ready=true 才浮出） */}
          {conclusionReady ? (
            <Collapsible className="border-t px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {conclusion ? '收起结论卡片' : '展开结论卡片'}
                  </Button>
                </CollapsibleTrigger>
                <Button variant="outline" size="sm" onClick={handleGenerateConclusion}>
                  生成结论卡片
                </Button>
              </div>
              <CollapsibleContent className="pt-3">
                {conclusion ? (
                  <div className="flex flex-col gap-3 text-sm">
                    {conclusion.summary ? (
                      <p className="text-foreground">{conclusion.summary}</p>
                    ) : null}
                    {conclusion.pain_points.length ? (
                      <div>
                        <p className="font-medium text-foreground">痛点</p>
                        <ul className="list-disc pl-5 text-muted-foreground">
                          {conclusion.pain_points.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {conclusion.suggestions.length ? (
                      <div>
                        <p className="font-medium text-foreground">建议</p>
                        <ul className="list-disc pl-5 text-muted-foreground">
                          {conclusion.suggestions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {conclusion.next_actions.length ? (
                      <div>
                        <p className="font-medium text-foreground">下一步可以直接做</p>
                        <ul className="list-disc pl-5 text-muted-foreground">
                          {conclusion.next_actions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    点「生成结论卡片」，我会把这几轮聊的内容收成几条。
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {/* 输入区 */}
          <div className="flex flex-col gap-2 border-t px-4 py-3">
            <div className="flex items-end gap-2">
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
                disabled={streaming}
                rows={2}
                maxLength={2000}
                placeholder={
                  hasOpening
                    ? '回答 AI 的问题…（Enter 发送，Shift+Enter 换行）'
                    : '说点什么…（Enter 发送，Shift+Enter 换行）'
                }
                className="min-h-[44px] resize-none"
              />
              {streaming ? (
                <Button variant="outline" onClick={stop} className="gap-1.5">
                  <Square className="size-4" />
                  停止
                </Button>
              ) : (
                /* 本页唯一实心主按钮 */
                <Button
                  variant="warm"
                  onClick={handleSend}
                  disabled={sendDisabled}
                  className="gap-1.5"
                >
                  <Send className="size-4" />
                  发送
                </Button>
              )}
            </div>
            {/*
              很轻的一条兜底提示：AI 开场后用户可能"答不上来"。
              只放一行小字 —— 不用大段静态文案去引导用户先开口（那是"假主动"）。
            */}
            {awaitingUserReply ? (
              <p className="text-xs text-muted-foreground">
                答不上来也没关系，说半句、说错都行，我顺着往下问。
              </p>
            ) : null}
          </div>
        </Card>
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
