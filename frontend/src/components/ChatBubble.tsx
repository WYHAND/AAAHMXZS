import { RotateCw } from 'lucide-react'

import { parseMarkdown, type MarkdownBlock } from '@/utils/markdown'
import { cn } from '@/lib/utils'

/**
 * 消息气泡（设计说明书 3.2 ②、6.5 自建 ChatBubble）
 *
 * - AI 侧浅底（bg-card + 暖色竖条），用户侧 bg-secondary；两端都不用主色实心。
 * - Markdown 渲染但不允许 HTML 注入：由 utils/markdown 先转义再白名单还原。
 * - 中断时不清空内容，尾部显示「（回答中断，点击重试）」。
 */
export interface ChatBubbleProps {
  role: 'user' | 'assistant'
  content: string
  /** 流式中：显示打字机光标 */
  streaming?: boolean
  interrupted?: boolean
  onRetry?: () => void
  className?: string
}

function Blocks({ blocks }: { blocks: MarkdownBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          return (
            <pre
              key={index}
              className="my-2 overflow-x-auto rounded-md bg-secondary p-3 text-xs leading-relaxed"
            >
              <code>{block.text}</code>
            </pre>
          )
        }
        if (block.type === 'heading') {
          return (
            <p key={index} className="mt-2 font-semibold text-foreground">
              {block.spans?.map((span, i) => (
                <Span key={i} span={span} />
              ))}
            </p>
          )
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag
              key={index}
              className={cn(
                'my-1 flex flex-col gap-1 pl-4',
                block.ordered ? 'list-decimal' : 'list-disc',
              )}
            >
              {block.items?.map((item, i) => (
                <li key={i}>
                  {parseMarkdown(item)[0]?.spans?.map((span, j) => (
                    <Span key={j} span={span} />
                  )) ?? item}
                </li>
              ))}
            </Tag>
          )
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {block.spans?.map((span, i) => (
              <Span key={i} span={span} />
            ))}
          </p>
        )
      })}
    </>
  )
}

function Span({ span }: { span: { type: string; text: string } }) {
  if (span.type === 'strong') {
    return <strong className="font-semibold">{span.text}</strong>
  }
  if (span.type === 'code') {
    return (
      <code className="rounded bg-secondary px-1 py-0.5 text-xs">{span.text}</code>
    )
  }
  return <>{span.text}</>
}

export function ChatBubble({
  role,
  content,
  streaming = false,
  interrupted = false,
  onRetry,
  className,
}: ChatBubbleProps) {
  const isUser = role === 'user'
  const blocks = parseMarkdown(content)

  return (
    <div
      data-slot="chat-bubble"
      data-role={role}
      className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start', className)}
    >
      <div
        className={cn(
          'ai-bubble-text max-w-[85%] rounded-lg px-4 py-3 text-base md:max-w-[75%]',
          isUser
            ? 'bg-secondary text-secondary-foreground'
            : 'ai-inset bg-card text-card-foreground shadow-card',
        )}
      >
        {content ? (
          <Blocks blocks={blocks} />
        ) : streaming ? (
          <span className="text-muted-foreground">正在组织语言…</span>
        ) : null}

        {streaming ? (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-ai-accent align-middle"
          />
        ) : null}

        {interrupted ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            <RotateCw className="size-3" />
            （回答中断，点击重试）
          </button>
        ) : null}
      </div>
    </div>
  )
}
