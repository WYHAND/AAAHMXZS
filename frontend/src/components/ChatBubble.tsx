import { RotateCw } from 'lucide-react'

import { parseMarkdown, type MarkdownBlock } from '@/utils/markdown'
import { cn } from '@/lib/utils'

/**
 * 消息气泡（设计说明书 3.2 ②、6.5 自建 ChatBubble）
 *
 * - AI 侧白底 + 暖色竖条（ai-inset）；用户侧**中性浅底**（bg-surface-container），
 *   两端都不用主色实心。
 *   ⚠️ 2026-10 收口：用户气泡原来是 `bg-secondary text-secondary-foreground`，
 *   而 --secondary 被改成琥珀棕后整条气泡变成重色。现在 --secondary 已恢复"中性浅底"
 *   语义，这里仍显式写成 surface-container，避免以后再被 token 语义牵着走。
 * - Markdown 渲染但不允许 HTML 注入：**靠 React 的文本节点自动转义**，
 *   不要在 utils/markdown 里手动转义（那会造成双重转义，用户看到 &quot; 这样的实体）。
 * - 中断时不清空内容，尾部显示「（回答中断，点击重试）」。
 */
export interface ChatBubbleProps {
  role: 'user' | 'assistant'
  content: string
  /** 回复失败：尾部显示重试入口（内容可能为空） */
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
              className="my-2 overflow-x-auto rounded-md bg-surface-container-low p-3 text-xs leading-relaxed"
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
      <code className="rounded bg-surface-container px-1 py-0.5 text-xs">{span.text}</code>
    )
  }
  return <>{span.text}</>
}

/**
 * AI 侧气泡的外形（与 ChatBubble 的 AI 分支一致）。
 * 等待占位与真正的回复气泡必须长得一样，回复到了才不会像"换了一个东西"。
 */
const AI_BUBBLE_SHAPE =
  'rounded-bl-[7px] border border-outline-variant/60 bg-card text-on-surface shadow-card'

/**
 * AI「正在回复」的等待占位：三个起伏的点。
 *
 * 回复整条到达后它会被真正的 ChatBubble 替换 —— 新气泡自己的 bubble-pop 负责出场，
 * 所以这里不需要任何"过渡"逻辑。
 */
export function ChatTypingBubble({ className }: { className?: string }) {
  return (
    <div
      data-slot="chat-typing"
      role="status"
      aria-label="AI 正在回复"
      className={cn('flex w-full justify-start', className)}
    >
      <div className={cn('bubble-pop flex items-center gap-1.5 rounded-xl px-4 py-3.5', AI_BUBBLE_SHAPE)}>
        <span className="typing-dot size-1.5 rounded-full bg-on-surface-variant" />
        <span className="typing-dot size-1.5 rounded-full bg-on-surface-variant [animation-delay:150ms]" />
        <span className="typing-dot size-1.5 rounded-full bg-on-surface-variant [animation-delay:300ms]" />
      </div>
    </div>
  )
}

export function ChatBubble({
  role,
  content,
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
          // 出现即弹一下：关键帧/时长/缓动照用户给的 SVG（见 index.css 的 bubble-pop）
          'bubble-pop ai-bubble-text max-w-[85%] rounded-xl px-4 py-3 text-base md:max-w-[75%]',
          // 气泡形状照用户给的 SVG：一个底角收小当作「尾巴」——AI 在左下、用户在右下
          isUser
            ? // 用户=深墨实心、白字；代码块给一层浅色底，避免在深底上看不清
              'rounded-br-[7px] bg-primary text-on-primary [&_code]:bg-on-primary/15 [&_pre]:bg-on-primary/15'
            : // AI 外形见 AI_BUBBLE_SHAPE（用 border 而不是 ring：消息区视口会裁掉外描边）
              AI_BUBBLE_SHAPE,
        )}
      >
        {content ? <Blocks blocks={blocks} /> : null}

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
