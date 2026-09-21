import { useCallback, useEffect, useRef, useState } from 'react'
import { Compass, Plus, Send, Square, Trash2 } from 'lucide-react'
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
import { loadConclusion, useChatStore } from '@/store/chatStore'
import { useResponsive } from '@/hooks/useResponsive'
import { useStage } from '@/hooks/useStage'
import type { Conversation } from '@/types'
import { cn } from '@/lib/utils'

/**
 * AI 职业指导对话（设计说明书 3.2 ②）
 *
 * - 流式中：发送按钮变「停止」（AbortController），禁止重复发送
 * - AI 气泡渲染 Markdown 但不允许 HTML 注入（components/ChatBubble）
 * - 追问进度来自后端 followup_round / followup_direction；为 null 时隐藏进度环
 * - 结论卡片：后端 done 事件 conclusion_ready=true 时浮出可折叠卡片
 * - 中文输入法组合期间回车不发送（compositionstart/end）
 */

/**
 * 追问轮次的上限（开发手册 7.7：同一方向连续追问不超过 3 轮）。
 *
 * ⚠️ 后端有一个**已知的计数问题**：方向未切换时 followup_round 会超过 3
 * （实测出现过 4，导致界面显示「追问进度 4/3」这种不可能的状态）。
 * 那是后端的逻辑问题，本轮先不修，但**不能让它在界面上露出来**——
 * 所以这里对显示值做钳制，保证分子永远不会超过分母。
 * 后端修好之后这个钳制也建议保留，作为防御性显示。
 */
const MAX_FOLLOWUP_PER_DIRECTION = 3

/** 把后端返回的追问轮次钳制到 [1, MAX]；null / 非法值表示「还没开始计数」 */
function displayFollowupRound(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null
  return Math.min(Math.max(Math.trunc(raw), 1), MAX_FOLLOWUP_PER_DIRECTION)
}

export default function ChatPage() {
  const { isDesktop } = useResponsive()
  const { stage } = useStage()
  const [draft, setDraft] = useState('')
  /** 等待二次确认的会话；null 表示弹窗关闭 */
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null)
  /** 删除请求进行中：禁用确认按钮，防连点 */
  const [deleting, setDeleting] = useState(false)
  const composingRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const {
    conversations,
    activeId,
    messages,
    streamState,
    followupRound,
    followupDirection,
    conclusionReady,
    conclusion,
    loadConversations,
    setActive,
    deleteConversation,
    loadMessages,
    send,
    retry,
    stop,
  } = useChatStore()

  const streaming = streamState === 'streaming' || streamState === 'connecting'
  const lastMessage = messages.at(-1)
  const sendDisabled = streaming || !draft.trim()
  // 钳制后的追问轮次：永远落在 [1, MAX]，不会出现 "4/3"
  const shownFollowupRound = displayFollowupRound(followupRound)

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (activeId) void loadMessages(activeId)
  }, [activeId, loadMessages])

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
          <p className="text-sm text-muted-foreground">
            主题：跟着你的阶段走
            {followupDirection ? ` · 正在挖「${followupDirection}」` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setActive(null)} className="gap-1.5">
          <Plus className="size-4" />
          新对话
        </Button>
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
                  还没有历史会话，从下面说第一句话开始。
                </p>
              )}
            </ScrollArea>
          </aside>
        ) : null}

        {/* 消息区 + 输入区 */}
        <Card className="flex min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0">
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
                {streaming && lastMessage?.role === 'assistant' && !lastMessage.content ? (
                  <AIThinking stage={stage} lines={2} className="max-w-[75%]" />
                ) : null}
                <div ref={bottomRef} />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm text-foreground">
                  先别急着定方向，跟我说说你现在最纠结的事。
                </p>
                <p className="text-xs text-muted-foreground">
                  比如「我不知道自己适合什么」「投了几家没回音」
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
                placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"
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
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Compass className="size-3" />
              {shownFollowupRound == null
                ? '先聊两句，我就能开始记录追问进度'
                : `追问进度 ${shownFollowupRound}/${MAX_FOLLOWUP_PER_DIRECTION} · 达到 ${MAX_FOLLOWUP_PER_DIRECTION} 轮后我会换一个方向继续挖`}
            </p>
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
