/**
 * 复现并验证「新会话第一条消息的 AI 回复不显示」。
 *
 * 机制（见代码定位）：
 *   send() → ensureConversation() 新建会话 → set({activeId}) →
 *   ChatPage 的 useEffect 触发 loadMessages() → 该请求返回后
 *   `set({ messages: list })` 把乐观插入的 AI 气泡整个覆盖掉 →
 *   后续 SSE 的 delta 按 id 找不到消息 → 界面不显示 → 但后端已落库。
 *
 * 关键：把 `GET .../messages` 的响应**人为延迟**，让它在"乐观插入之后、
 * 流式渲染期间"返回，从而稳定触发竞争（真实环境下这取决于网络时序，
 * 所以之前表现为"偶发"）。
 *
 * 用法：node qa-chat-first-message.mjs
 * 前置：另开终端 `npx vite preview --port 4173`（preview 只监听 IPv6，用 localhost）
 */
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:4173'
const CONV_ID = 'c-new'
const MARKER = '【AI回复标记】'
const REPLY = `${MARKER}你好呀，先别急着定方向。`

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

await page.addInitScript(() => {
  localStorage.setItem('ai_job_helper:token', JSON.stringify('qa-token'))
})

let messagesCallCount = 0

await page.route('**/api/v1/**', async (route) => {
  const req = route.request()
  const p = new URL(req.url()).pathname
  const method = req.method()
  const ok = (data) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, message: 'success', data }),
    })

  if (p.endsWith('/auth/me')) {
    return ok({ id: 'u1', username: 'qa', school: 'S', major: 'M', grade: '大三', created_at: '2026-09-18T00:00:00Z' })
  }
  if (p.endsWith('/profile')) {
    return ok({
      id: 'p1', user_id: 'u1', clarity_score: 50, action_score: 0, resume_score: 0,
      total_score: 20, stage: 'explore', stage_label: '职业探索期', tested: true,
      summary: '你是个喜欢自己动手折腾的人：会写代码，也一直在琢磨技术怎么变成产品。',
      tags: [], updated_at: '2026-09-18T00:00:00Z',
    })
  }
  // 新会话列表为空 → activeId 初始为 null（这正是"第一次对话"的前提）
  if (p.endsWith('/chat/conversations') && method === 'GET') return ok([])
  if (p.endsWith('/chat/conversations') && method === 'POST') {
    return ok({
      id: CONV_ID, title: '新对话', message_count: 0, conclusion: null,
      followup_round: null, followup_direction: null,
      created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z',
    })
  }

  // ★ 历史消息：延迟 900ms 返回，且**只含用户消息**（真实情况：后端开流前先落库用户消息，
  //   AI 回复要等流结束才写库）。这一条就是触发覆盖的元凶。
  if (p.endsWith(`/chat/conversations/${CONV_ID}/messages`) && method === 'GET') {
    messagesCallCount += 1
    await new Promise((r) => setTimeout(r, 900))
    return ok([
      { id: 'm-user', conversation_id: CONV_ID, role: 'user', content: '我想学习ai', created_at: '2026-09-18T00:00:01Z' },
    ])
  }

  // ★ SSE：一次性下发（内容是同一批 delta，本测试关心的是"状态是否被覆盖"，不是逐块到达）
  if (p.endsWith(`/chat/conversations/${CONV_ID}/stream`)) {
    const ev = (name, obj) => `event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`
    const env = (data) => ({ code: 0, message: 'success', data })
    const body = [
      ev('start', env({ type: 'start', conversation_id: CONV_ID, followup_round: 1 })),
      ev('delta', env({ type: 'delta', content: `${MARKER}你好呀，`, conversation_id: CONV_ID, followup_round: 1 })),
      ev('delta', env({ type: 'delta', content: '先别急着定方向。', conversation_id: CONV_ID, followup_round: 1 })),
      ev('done', env({ type: 'done', message_id: 'm-ai', conversation_id: CONV_ID, conclusion_ready: false, followup_round: 2 })),
      'event: end\ndata: [DONE]\n\n',
    ].join('')
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  }

  return ok(null)
})

await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

// 发第一条消息（此时 activeId 为 null → 会新建会话 → 触发竞争）
await page.getByPlaceholder(/说点什么/).fill('我想学习ai')
await page.getByRole('button', { name: '发送' }).click()

// 等得比 listMessages 的 900ms 延迟更久，确保覆盖已经发生、流也已结束
await page.waitForTimeout(2600)

const userBubbles = page.locator('[data-slot="chat-bubble"][data-role="user"]')
const aiBubbles = page.locator('[data-slot="chat-bubble"][data-role="assistant"]')
const userCount = await userBubbles.count()
const aiCount = await aiBubbles.count()
const aiText = aiCount ? await aiBubbles.first().innerText() : ''
const hasMarker = aiText.includes(MARKER)
const bodyText = await page.locator('body').innerText()

console.log('========== 实测结果 ==========')
console.log(`  GET messages 被调用次数: ${messagesCallCount}（预期 1，即那次覆盖）`)
console.log(`  用户气泡数: ${userCount}   用户消息可见: ${bodyText.includes('我想学习ai')}`)
console.log(`  AI 气泡数: ${aiCount}`)
console.log(`  AI 气泡内容: ${JSON.stringify(aiText.slice(0, 60))}`)
console.log(`  回复标记可见: ${hasMarker}`)
console.log(`  未捕获异常: ${pageErrors.length ? pageErrors.join(' | ') : '无'}`)

await page.screenshot({ path: 'shots/qa-chat-first-message.png' })

// 判定：修好之后，AI 回复应当**在界面上真实可见**
const pass = hasMarker && userCount > 0 && pageErrors.length === 0
console.log('')
if (pass) {
  console.log('结果: 通过 —— 第一条消息的 AI 回复正常显示')
} else {
  console.log('结果: 未通过 —— AI 回复在界面上消失了（正是报告里的 bug）')
}
await browser.close()
process.exit(pass ? 0 : 1)
