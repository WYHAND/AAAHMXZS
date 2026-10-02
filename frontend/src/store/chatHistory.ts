/**
 * 「这段会话的历史到底拉到了没有」—— 全部判定逻辑集中在这里的**纯函数**。
 *
 * 为什么单独一个模块（这是本文件存在的全部理由）：
 *
 * 修的那个 bug（用户说「对话会丢失」，实际是切走再切回时屏幕上只剩一句 AI 开场白）
 * 的根子是**把"这次没拉到"当成了"服务端说没有消息"**：
 *   ① `loadMessages` 失败时执行 `set({ messages: [] })` —— 把屏幕上已有的 21 条抹掉；
 *   ② 紧接着 `ensureOpening` 看到 `messages.length === 0`，就去调 `POST /opening`；
 *      后端按幂等**回放**那条已有的开场白，前端把它当成唯一一条消息插进视图。
 * 于是「21 条消息的会话」显示成「只有开场白」—— 一句错误也看不到。
 *
 * 结论：「屏幕上没有东西」和「服务端没有东西」是**两件事**，必须由两个不同的状态
 * 分别表达。前者是 `messages`，后者是本文件里的 `HistoryLoad`。
 * 任何"要不要补开场白 / 消息区该显示什么"的判断，都只允许通过这里的函数做，
 * 不允许再有人写 `messages.length === 0` 就下结论。
 *
 * 这里的函数不碰 store、不碰网络、不碰 React：只吃一个状态快照，吐一个结论。
 * 因此可以用一张真值表把它钉死（见手册 6.12 的"登记与渲染分离"教训：
 * 判断依据必须是真实渲染态，不能是"我以为它拉到了"的副本）。
 */

/**
 * 一次「拉历史」请求的结论。只有三种：
 *
 * - `loading`：请求在途，**还没有结论**（还不知道服务端有没有消息）
 * - `ready`  ：拿到了服务端这一份历史（它说了算：`messages` 空 = 服务端确实没有消息）
 * - `failed` ：没拿到（网络抖动 / 5xx / 后端重启中）。**这只说明"这次没拉到"，
 *              绝不能被解读成"没有消息"**
 */
export type HistoryStatus = 'loading' | 'ready' | 'failed'

/**
 * 拉历史的结论。**会话 id 和状态绑在同一个值里**，这是刻意的：
 *
 * - 如果拆成 `historyStatus: 'ready'` + `historyFor: 'conv-a'` 两个字段，就有
 *   "换了 id 忘了改状态"的空档，后人一定会写出跨会话误用的代码；
 * - 如果只放一个裸的 `historyStatus`（不带 id），切会话时只要有一处忘了重置，
 *   上一个会话的 `ready` 就会被当成当前会话的结论 —— 那正是这次 bug 的形态。
 *
 * 绑在一起之后，**切会话不需要任何人记得重置**：id 对不上就是"没有结论"。
 * （`resolveHistoryOutcome` 是唯一读取它的地方，别再另写一份判断。）
 */
export interface HistoryLoad {
  conversationId: string
  status: HistoryStatus
}

/**
 * 消息区当前该长什么样。由「历史结论 + 屏幕上已有的消息」共同决定：
 *
 * - `pending`       ：还没有结论（正在拉 / 从没拉过 / 结论属于别的会话）→ 等待态
 * - `empty`         ：**服务端明确说这个会话没有消息** → 这是唯一允许补开场白的状态
 * - `content`       ：服务端明确给了历史 → 正常渲染
 * - `stale-content` ：这次没拉到，但屏幕上还有内容 → **保留内容**，只给一条轻提示
 * - `failed`        ：这次没拉到，屏幕上也没内容 → 失败态 + 「重新加载」（可重试）
 */
export type HistoryOutcome = 'pending' | 'empty' | 'content' | 'stale-content' | 'failed'

/** 判定只关心"屏幕上有没有东西"，不关心消息内部的字段 */
export interface HistoryView {
  activeId: string | null
  messages: readonly unknown[]
  historyLoad: HistoryLoad | null
}

/**
 * 历史这件事对**当前会话**的结论。
 *
 * ⚠️ 两个不变量，改动前先读：
 * 1. `activeId` 为 null（没有选中会话）时一律 `pending`：由页面的兜底空态收尾，
 *    绝不能落到 `failed`（那会对着一个不存在的会话显示"重新加载"）。
 * 2. 只有"结论正好属于当前会话"才算数（id 比对）。id 对不上 = 没有结论，
 *    于是切会话后哪怕有人忘了清 `historyLoad`，也不会用错会话的结论。
 */
export function resolveHistoryOutcome(view: HistoryView): HistoryOutcome {
  const { activeId, messages, historyLoad } = view
  if (!activeId) return 'pending'

  const status = historyLoad && historyLoad.conversationId === activeId ? historyLoad.status : null
  // 只有 ready 才敢用 messages 解释服务端：此刻"空"才真的等于"服务端没有消息"
  if (status === 'ready') return messages.length ? 'content' : 'empty'
  // failed：分"屏幕上还有内容"（保留 + 轻提示）与"屏幕上也空了"（失败态 + 重试）
  if (status === 'failed') return messages.length ? 'stale-content' : 'failed'
  return 'pending'
}

/** 补开场白的判定要额外看"开场白本身是否已经失败过一次" */
export interface OpeningGateView extends HistoryView {
  openingFailedFor: string | null
}

/**
 * **要不要给这个会话补一条开场白**。`conversationId` 显式传进来，不隐含"就是当前会话"。
 *
 * 允许的唯一条件：`resolveHistoryOutcome === 'empty'`，
 * 也就是**本次历史加载成功、且服务端确实说这个会话没有消息**。
 *
 * 这条判断以前是 `ensureOpening` 里的 `if (messages.length) return` —— 反着的：
 * "messages 空"被当成了"服务端没有消息"。历史没拉到的那一两秒里，
 * 它会去打 `POST /opening`，后端按幂等回放已有的开场白 → 用户以为 21 条对话丢了。
 *
 * 另外两个否决：
 * - `activeId !== conversationId`（不是当前会话）→ 前端此刻根本不知道它有没有消息；
 * - `openingFailedFor === conversationId`（这个会话的开场白已经试过且失败）→
 *   交给用户点「让 AI 先开口」，不要在一个 effect 里自动重发。
 */
export function shouldEnsureOpening(
  view: OpeningGateView,
  conversationId: string | null,
): boolean {
  if (!conversationId || view.activeId !== conversationId) return false
  if (view.openingFailedFor === conversationId) return false
  return resolveHistoryOutcome(view) === 'empty'
}

/**
 * 拉历史失败时该做什么。**只有两种结局**：
 *
 * - `drop-gone-conversation`：HTTP 404 → envelope code 2001，后端说"这条记录不存在 /
 *   不属于你"。此时 activeId 指着一个不存在的会话，收尾必须交给
 *   `dropGoneConversation`（移出列表 / 清簿记 / 让位下一条 / 清空消息）。
 * - `keep-messages`：网络抖动 / 5xx / 后端 `--reload` 重启中。**只是"这次没拉到"**：
 *   屏幕上已有的消息一个都不许动，也不能去补开场白；只记一条"历史没拉到"，
 *   由页面给失败态（或轻提示）+「重新加载」。
 *
 * 旧代码在这里对第二种情况执行 `set({ messages: [] })`（本 bug 的第一个错）。
 * 现在这个判断被抽成纯函数：谁想清空消息，先过这张真值表。
 */
export type LoadFailureAction = 'drop-gone-conversation' | 'keep-messages'

/** `isGone` = 后端是否答"这个会话不存在/不属于你"（2001 契约，见 api/client.ts） */
export function resolveLoadFailureAction(isGone: boolean): LoadFailureAction {
  return isGone ? 'drop-gone-conversation' : 'keep-messages'
}
