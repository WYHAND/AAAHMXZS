/**
 * 极简 Markdown 清洗与渲染（设计说明书 3.2 ②：AI 气泡渲染 Markdown，但不允许 HTML 注入）。
 * 不做完整 Markdown 实现：只切块 + 行内粗体/代码。
 * 支持：标题 / 有序无序列表 / 粗体 / 行内代码 / 代码块 / 换行。
 *
 * ⚠️ **这里刻意不做 HTML 转义**（曾经做过，是个 bug，见下）：
 * 本模块的输出全部通过 React 的**文本节点**渲染（`<span>{text}</span>`），
 * 而 React 在把字符串放进 DOM 时会**自动转义**，`<script>` 只会被当成文字显示，
 * 不存在注入风险。如果再手动转义一次，就会变成「双重转义」：
 *
 *     AI 原文：  现在最"热"的其实是…
 *     手动转义： 现在最&quot;热&quot;的其实是…      ← 存进了 block 里
 *     React 渲染：把 &quot; 当普通文字显示 → 用户看到 &quot;
 *
 * 正确做法是**只信任 React**。只有当你改用 `dangerouslySetInnerHTML`
 * 直接把字符串当 HTML 插入时，才需要自己转义——本项目没有任何一处这么用。
 */

export interface MarkdownBlock {
  type: 'paragraph' | 'heading' | 'list' | 'code'
  /** 段落、标题、代码块的文本 */
  text?: string
  /** 列表项 */
  items?: string[]
  ordered?: boolean
  /** 行内粗体/代码切分后的片段 */
  spans?: MarkdownSpan[]
}

export interface MarkdownSpan {
  type: 'text' | 'strong' | 'code'
  text: string
}

/** 行内解析：**粗体** 与 `代码` */
export function parseInline(raw: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw)) !== null) {
    if (match.index > last) {
      spans.push({ type: 'text', text: raw.slice(last, match.index) })
    }
    const token = match[0]
    if (token.startsWith('**')) {
      spans.push({ type: 'strong', text: token.slice(2, -2) })
    } else {
      spans.push({ type: 'code', text: token.slice(1, -1) })
    }
    last = match.index + token.length
  }
  if (last < raw.length) {
    spans.push({ type: 'text', text: raw.slice(last) })
  }
  return spans.length ? spans : [{ type: 'text', text: raw }]
}

/** 把 Markdown 文本切成块。**不做 HTML 转义**，转义交给 React（见文件头说明）。 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = source.split(/\r?\n/)
  let index = 0

  while (index < lines.length) {
    const line = lines[index]

    // 代码块 ```
    if (line.trimStart().startsWith('```')) {
      const buffer: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trimStart().startsWith('```')) {
        buffer.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ type: 'code', text: buffer.join('\n') })
      continue
    }

    // 标题
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        text: heading[2],
        spans: parseInline(heading[2]),
      })
      index += 1
      continue
    }

    // 列表
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      const items: string[] = []
      const isOrdered = Boolean(ordered)
      while (index < lines.length) {
        const m = isOrdered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[index])
          : /^\s*[-*]\s+(.*)$/.exec(lines[index])
        if (!m) break
        items.push(m[1])
        index += 1
      }
      blocks.push({ type: 'list', items, ordered: isOrdered })
      continue
    }

    // 空行
    if (line.trim() === '') {
      index += 1
      continue
    }

    // 段落：连续非空行合并
    const paragraph: string[] = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[index]) &&
      !lines[index].trimStart().startsWith('```') &&
      !/^#{1,4}\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    const merged = paragraph.join('\n')
    blocks.push({ type: 'paragraph', text: merged, spans: parseInline(merged) })
  }

  return blocks
}
