/**
 * 长回复分条展示：一条很长的 AI 回复 -> 连续 2-3 个气泡。
 *
 * ## 为什么放在展示层，而不是让后端存成多条消息
 *
 * 用户要解决的是"一次看太多字"的**阅读问题**（原话：「改成连续发两条或多条回复，
 * 减少用户一次看太多文字的问题」）。这件事有两个硬要求：
 *
 * 1. **刷新后形状必须一样**：如果只在流式过程中拆、落库仍是一条，刷新就会变回一大坨；
 *    反过来，如果让后端真的存成 N 条消息，历史、message_count、幂等、画像回流
 *    全都要跟着改，而它们跟"读起来累"没有关系。
 * 2. **不能靠模型自觉**：让它"自己分成两条"，等于又多一条软约束（这个项目已经反复
 *    验证过软约束不生效）。
 *
 * 所以拆法是**确定性的纯函数**：同一段文本，无论来自流式草稿还是历史消息，
 * 永远拆成同样的几段。后端一个字都不用改。
 *
 * ## 切在哪（按优先级）
 *
 * 1. **空行**（段落边界）—— 最自然，"一段话说一件事"；
 * 2. **换行**（列表项）—— 列表项整体不拆，否则第二条会丢掉 `- ` 变成普通段落；
 * 3. **句末标点**（。！？；!?;）—— 一段特别长的段落内部找句子边界；
 * 4. **硬切** —— 连标点都没有的极端情况（代码 / 长串英文），按长度切。
 *
 * ⚠️ **代码块永远不拆**（``` 包住的部分整体作为一个原子），拆开就不成代码了。
 */

export interface SplitReplyOptions {
  /** 每条的**目标**长度（不是硬上限：为了一句完整的话，允许略超） */
  maxChars?: number
  /** 每条的下限：太短就别硬拆，宁可少一条 */
  minChars?: number
  /** 最多拆成几条（再多就像刷屏了） */
  maxBubbles?: number
  /** 整段不超过这个长度就**不拆**（一句话回完的，不该变成两个气泡） */
  singleBubbleUpTo?: number
}

const DEFAULTS: Required<SplitReplyOptions> = {
  maxChars: 300,
  minChars: 120,
  maxBubbles: 3,
  singleBubbleUpTo: 240,
}

/**
 * 多段文本的**最低总长**：低于这个长度就不拆。
 *
 * 用户原话（配图）：「类似这句话就可以分成三句话来发出」—— 那张图是 **3 个自然段、
 * 总共一百四十来字**。所以"拆不拆"看的是**有没有多个成段的块**，不是总长度；
 * 但两三个字的碎句（"行。你什么专业？"）拆开只会像刷屏，所以留一个很低的总长门槛。
 */
const MIN_SPLIT_TOTAL = 60

/** 句末标点（含中文分号/问号/叹号）：在这些位置断开最像"换了口气" */
const SENTENCE_END = /[。！？；!?;]/

interface Atom {
  /** 原文片段（不含前面的分隔空白） */
  text: string
  /** 原文里它前面的空白（拼接时原样保留，避免把单换行变成双换行） */
  sep: string
  /** 标题这类"必须跟着下一段一起走"的原子 */
  glueNext?: boolean
}

/**
 * 把原文切成"不许再拆"的原子。
 *
 * - 围栏代码块（``` 开头到下一个 ``` 或结尾）整体一个原子；
 * - 其余按行扫描：空行是段落边界，行内按句末标点拆长句；
 * - 列表项（`- ` / `* ` / `1. `）**整行一个原子**；超长的列表项才按句拆（见下）。
 */
function toAtoms(text: string, maxChars: number): Atom[] {
  const lines = text.split('\n')
  const atoms: Atom[] = []

  // ``pendingSep`` = 下一个原子前面该放什么空白（'' 表示它是第一个原子）。
  // 空行 -> 段落边界（\n\n）；列表项之间 -> 单换行（保证同一个列表不散架）。
  let pendingSep = ''
  let buffer: string[] = []

  const pushBlock = (blockLines: string[], sep: string) => {
    const block = blockLines.join('\n').trim()
    if (!block) return
    // 标题：让它跟着下一段，避免"标题孤零零一个气泡，内容在下一个"
    if (/^#{1,6}\s/.test(block)) {
      atoms.push({ text: block, sep, glueNext: true })
      return
    }
    // 列表项整行保留（拆了会丢 `- ` 前缀，第二条会变成普通段落）
    const isListItem = /^\s*(?:[-*+]|\d+\.)\s/.test(block)
    if (!isListItem && block.length > maxChars) {
      splitSentences(block, maxChars).forEach((sentence, index) => {
        atoms.push({ text: sentence, sep: index === 0 ? sep : '\n\n' })
      })
      return
    }
    atoms.push({ text: block, sep })
  }

  const flush = (nextSep: string) => {
    if (!buffer.length) {
      pendingSep = atoms.length ? nextSep : ''
      return
    }
    pushBlock(buffer, pendingSep)
    buffer = []
    pendingSep = nextSep
  }

  let inFence = false
  let fence: string[] = []

  for (const line of lines) {
    const isFenceMarker = /^\s*```/.test(line)

    if (isFenceMarker && !inFence) {
      flush('\n\n')
      inFence = true
      fence = [line]
      continue
    }
    if (isFenceMarker && inFence) {
      fence.push(line)
      // 代码块整体一个原子：拆开就不成代码了
      atoms.push({ text: fence.join('\n'), sep: pendingSep })
      fence = []
      pendingSep = '\n\n'
      inFence = false
      continue
    }
    if (inFence) {
      fence.push(line)
      continue
    }
    if (!line.trim()) {
      flush('\n\n')
      continue
    }
    // 列表项自成一段：先把前面攒的普通行冲出去（用单换行接，列表才不会断开）
    if (/^\s*(?:[-*+]|\d+\.)\s/.test(line) && buffer.length) {
      flush('\n')
    }
    buffer.push(line)
  }

  if (fence.length) {
    // 围栏没闭合：剩下的全当代码，别硬拆
    atoms.push({ text: fence.join('\n'), sep: pendingSep })
  } else {
    flush('\n\n')
  }

  return atoms.filter((atom) => atom.text.trim().length > 0)
}

/** 把一段长文本按句末标点切开；单句仍超长就硬切。 */
function splitSentences(block: string, maxChars: number): string[] {
  const parts: string[] = []
  let current = ''

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) parts.push(trimmed)
    current = ''
  }

  for (const char of block) {
    current += char
    if (SENTENCE_END.test(char) && current.length >= maxChars * 0.6) {
      flush()
    }
  }
  flush()

  // 兜底：单句本身就超过 maxChars（无标点的长串），按长度硬切
  const result: string[] = []
  for (const part of parts) {
    if (part.length <= maxChars * 1.6) {
      result.push(part)
      continue
    }
    for (let start = 0; start < part.length; start += maxChars) {
      result.push(part.slice(start, start + maxChars))
    }
  }
  return result
}

/** 小于这个长度的原子（一行短句）不单独成条，并到相邻那条里 */
const MIN_ATOM_CHARS = 16

/** 超过上限时，把余量并进最后一条（宁可最后一条长一点，也不刷屏） */
function capBubbles(parts: string[], maxBubbles: number, fallback: string): string[] {
  if (parts.length <= 1) return [fallback]
  if (parts.length <= maxBubbles) return parts
  const head = parts.slice(0, maxBubbles - 1)
  return [...head, parts.slice(maxBubbles - 1).join('\n\n')]
}

/**
 * 把一条回复拆成若干个气泡文本。
 *
 * 判定顺序（**先看结构，再看长度**）：
 * 1. 切出原子（段落 / 列表项 / 代码块 / 长句）；
 * 2. **原子 ≥ 2 且总长 ≥ ``MIN_SPLIT_TOTAL``** → **一段一条**（用户配图那种
 *    3 段 140 字的回复，就是 3 条）；太短的原子（< 16 字）并到相邻那条，避免碎句刷屏；
 * 3. 只有一个原子时，才看长度：超过 ``singleBubbleUpTo`` 才在句子边界拆；
 * 4. 结果超过 ``maxBubbles`` → 余量并进最后一条。
 */
export function splitReply(content: string, options: SplitReplyOptions = {}): string[] {
  const { maxChars, minChars, maxBubbles, singleBubbleUpTo } = { ...DEFAULTS, ...options }
  const text = (content ?? '').trim()
  if (!text) return []

  const atoms = toAtoms(text, maxChars)
  const hasStructure = atoms.length >= 2 && text.length >= MIN_SPLIT_TOTAL

  // ---- 情形 A：多段 -> 一段一条 ----
  if (hasStructure) {
    const groups: string[] = []
    let carry = ''

    for (const atom of atoms) {
      const piece = carry ? `${carry}${atom.sep || '\n\n'}${atom.text}` : atom.text
      const tooShort = atom.text.replace(/\s+/g, '').length < MIN_ATOM_CHARS
      if (tooShort || atom.glueNext) {
        // 太短 / 标题：先攒着，跟下一段一起发
        carry = piece
        continue
      }
      groups.push(piece)
      carry = ''
    }
    if (carry) {
      if (groups.length) groups[groups.length - 1] += `\n\n${carry}`
      else groups.push(carry)
    }
    return capBubbles(
      groups.map((part) => part.trim()).filter(Boolean),
      maxBubbles,
      text,
    )
  }

  // ---- 情形 B：单段 ----
  if (text.length <= singleBubbleUpTo || atoms.length <= 1) return [text]

  // 单段超长：按句子边界装箱（target 让几条长短接近）
  const bubbles = Math.min(maxBubbles, Math.max(2, Math.ceil(text.length / maxChars)))
  const target = Math.max(minChars, Math.ceil(text.length / bubbles))

  const out: string[] = []
  let current = ''
  let glue = false

  for (const atom of atoms) {
    const sep = current ? atom.sep || '\n\n' : ''
    if (current && !glue && current.length + sep.length + atom.text.length > target) {
      out.push(current)
      current = atom.text
    } else {
      current += sep + atom.text
    }
    glue = Boolean(atom.glueNext)
  }
  if (current) out.push(current)

  return capBubbles(out.map((part) => part.trim()).filter(Boolean), maxBubbles, text)
}
