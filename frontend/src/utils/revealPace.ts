/**
 * 「真人感」揭示节奏的**纯函数部分**：算出下一个该显示的正文前缀。
 *
 * ## 为什么需要它
 *
 * 一条回复会被 splitReply 拆成 2-3 个气泡，但流式正文（尤其 flash 模型）往往
 * 在不到一秒内整段到齐 —— 于是三个气泡几乎同时冒出来，像"刷屏"而不是"一个人在说"。
 * 用户原话：「大概等待三秒钟下一句话再出来，显得更有真人感」。
 *
 * 所以 UI 渲染的不是 `content`（服务端给到的完整正文），而是 `shown`
 * （当前该显示到哪）：由 store 里的 ticker 按节奏把 `shown` 一格格推进。
 *
 * ## 揭示规则（只有这一条）
 *
 * 把 `shown` 推进到**下一个段落边界**（`\n\n`，含分隔符）：
 * - 没有下一个段落边界 → 直接给到当前 `content` 的末尾；
 *   这样"单段回复"第一次揭示就是完整一句，不会让用户白等；
 * - 已经全部显示 → 原样返回，不做任何事。
 *
 * 时间节奏（间隔多久揭示一次）不在这个纯函数里 —— 那由调用方的 ticker 决定，
 * 这里只回答"下一格是哪一段"。
 *
 * ## 不变量
 *
 * 返回值**永远是 content 的前缀**（且长度 ≥ 入参 shown 的长度）：
 * 因此 UI 任何时刻显示的文本都是原文的一部分，不会跳字、不会超前。
 */
export function nextReveal(content: string, shown: string): string {
  if (shown.length >= content.length) return shown
  const nextBreak = content.indexOf('\n\n', shown.length)
  return nextBreak === -1 ? content : content.slice(0, nextBreak + 2)
}
