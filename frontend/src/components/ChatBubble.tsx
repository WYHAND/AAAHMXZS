import { RotateCw } from 'lucide-react'

import { parseMarkdown, type MarkdownBlock } from '@/utils/markdown'
import { splitReply } from '@/utils/splitReply'
import { cn } from '@/lib/utils'

/**
 * 消息气泡（设计说明书 3.2 ②、6.5 自建 ChatBubble）
 *
 * - 方案 A（2026-10-22）：用户侧**墨蓝实心 + 白字**（bg-primary），AI 侧白卡 + 主墨，
 *   左侧 3px 赭金竖条（ai-inset）。两端的底色差拉满，一眼能分清谁在说话；
 *   赭金在这一页只出现在竖条与发送按钮上，气泡里不再有第二个强调色。
 * - 正文 `text-body-md`（15px），行高 1.75（ai-bubble-text + leading-[1.75]）：
 *   长回复按段落读，不挤成一片。caption 只留给重试这类装饰性小字。
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
              className="my-2 max-w-full overflow-x-auto rounded-md bg-surface-container-low p-3 text-body-sm leading-[1.6]"
            >
              <code>{block.text}</code>
            </pre>
          )
        }
        if (block.type === 'heading') {
          return (
            <p key={index} className="mt-2 text-body-md font-semibold">
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
              /*
               * ⚠️ 这里**不能**用 flex：ul/ol 一旦成为 flex 容器，它的 li 会被
               * blockify（`display:list-item` 被覆盖），**列表符号整体消失** ——
               * 400-900 字、带列表的回复会退化成"看起来像段落"的一堆文字。
               * 用 space-y 保持项间距即可。
               */
              className={cn(
                'my-1 space-y-1 pl-4',
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
      <code className="rounded bg-surface-container-low px-1 py-0.5 text-body-sm break-words">{span.text}</code>
    )
  }
  return <>{span.text}</>
}

/**
 * AI 侧气泡的外形（与 ChatBubble 的 AI 分支一致）。
 * 等待占位与真正的回复气泡必须长得一样，回复到了才不会像"换了一个东西"。
 * 白卡 + 主墨 + 1px 中性描边（原来就是这个样子；不要加彩色竖条）。
 */
const AI_BUBBLE_SHAPE =
  'rounded-bl-[7px] border border-outline-variant/60 bg-card text-primary shadow-card'

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
      <div className={cn('bubble-pop flex max-w-full items-center gap-1.5 rounded-xl px-4 py-3.5', AI_BUBBLE_SHAPE)}>
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
  /*
   * 长回复分条（用户要求：一次别给太多字）：超过约 240 字的 AI 回复会被拆成 2-3 个气泡。
   * ⚠️ 用户自己打的字**不拆** —— 那是他自己的话，拆开像被系统改过。
   * 拆法是纯函数、确定性的（见 utils/splitReply）：历史消息与流式草稿拆出来一模一样，
   * 刷新不会变形状。
   */
  const parts = isUser ? [content] : splitReply(content)
  const bubbles = parts.length ? parts : ['']

  return (
    <div
      data-slot="chat-bubble"
      data-role={role}
      data-parts={bubbles.length}
      className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start', className)}
    >
      {/* 多气泡时纵向排列、间距 2：视觉上是"连发了几条"，仍属于同一条消息 */}
      <div
        className={cn(
          // 字号挂在容器上：text-body-md 与气泡上的文字色同属 text-* 组，
          // 放进同一个 cn() 会被 tailwind-merge 判成“颜色冲突”而丢掉字号。
          'flex min-w-0 max-w-[95%] flex-col gap-2 text-body-md md:max-w-[82%]',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        {bubbles.map((part, index) => (
          <div
            key={index}
            className={cn(
              // 出现即弹一下：关键帧/时长/缓动照用户给的 SVG（见 index.css 的 bubble-pop）。
              // 每个分条各自弹一次，读起来就是"连发了两条"。
              // 正文 15px（字号来自外层容器）；行高 1.75 保证长回复的段落不挤
              // （ai-bubble-text 也兜了换行规则）。
              'bubble-pop ai-bubble-text min-w-0 max-w-full rounded-xl px-4 py-3 leading-[1.75]',
              /*
               * 段间距：Markdown 的每个块各自是一个 <p>/<ul>/<pre>，而 preflight 把
               * 段落 margin 清零 —— 不加这一条，多段落的回复会**糊成一片**。
               * 只给非首个子段落加上间距；列表/标题/代码块自带 margin，不会叠加。
               */
              '[&>p:not(:first-child)]:mt-2',
              // 气泡形状照用户给的 SVG：一个底角收小当作「尾巴」——AI 在左下、用户在右下
              isUser
                ? // 用户=深墨实心、白字；代码块给一层浅色底，避免在深底上看不清
                  'rounded-br-[7px] bg-primary text-on-primary [&_code]:bg-on-primary/15 [&_pre]:bg-on-primary/15'
                : // AI 外形见 AI_BUBBLE_SHAPE（用 border 而不是 ring：消息区视口会裁掉外描边）
                  AI_BUBBLE_SHAPE,
            )}
          >
            {part ? <Blocks blocks={parseMarkdown(part)} /> : null}

            {/* 重试入口只挂在最后一条上，否则每条都挂一个按钮 */}
            {interrupted && index === bubbles.length - 1 ? (
              <button
                type="button"
                onClick={onRetry}
                className={cn(
                  'mt-2 inline-flex items-center gap-1 underline underline-offset-2 transition-colors',
                  isUser
                    ? 'text-on-primary/85 hover:text-on-primary'
                    : 'text-on-surface-variant hover:text-on-surface',
                )}
              >
                <RotateCw className="size-3.5" />
                <span className="text-body-sm">（回答中断，点击重试）</span>
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
