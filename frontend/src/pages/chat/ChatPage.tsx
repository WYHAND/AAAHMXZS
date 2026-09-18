import { useCallback, useEffect, useRef, useState } from 'react'
import { Compass, Plus, Send, Square } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { ChatBubble } from '@/components/ChatBubble'
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
export default function ChatPage() {
  const { isDesktop } = useResponsive()
  const { stage } = useStage()
  const [draft, setDraft] = useState('')
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
    loadMessages,
    send,
    retry,
    stop,
  } = useChatStore()

  const streaming = streamState === 'streaming' || streamState === 'connecting'
  const lastMessage = messages.at(-1)
  const sendDisabled = streaming || !draft.trim()

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
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => setActive(conversation.id)}
                    className={cn(
                      'w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors',
                      conversation.id === activeId
                        ? 'bg-primary-soft text-primary'
                        : 'text-muted-foreground hover:bg-secondary',
                    )}
                  >
                    {conversation.title}
                  </button>
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
              {followupRound == null
                ? '先聊两句，我就能开始记录追问进度'
                : `追问进度 ${followupRound}/3 · 达到 3 轮后我会换一个方向继续挖`}
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
