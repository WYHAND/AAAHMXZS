/**
 * 回归验证：修了「新会话第一条消息被覆盖」之后，历史消息的**加载**功能有没有被误伤。
 *
 * 为什么必须做这个：修复手段是"让在途的 loadMessages 结果作废"，
 * 而"加载历史"恰恰**依赖** loadMessages 生效 —— 两者方向相反，
 * 写过头就会表现为「会话切换后一片空白」。所以必须单独验。
 *
 * 覆盖两条路径：
 *   B1 初始加载：进入 /chat 后应显示第一个会话的历史
 *   B2 切换会话：点另一个会话后应显示它的历史
 *
 * 用法：node qa-chat-history.mjs（前置：npx vite preview --port 4173）
 */
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:4173'
const C1 = 'c-1'
const C2 = 'c-2'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

await page.addInitScript(() => {
  localStorage.setItem('ai_job_helper:token', JSON.stringify('qa-token'))
})

const msg = (id, cid, role, content) => ({
  id, conversation_id: cid, role, content, created_at: '2026-09-18T00:00:00Z',
})

await page.route('**/api/v1/**', async (route) => {
  const p = new URL(route.request().url()).pathname
  const ok = (data) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
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
  if (p.endsWith('/chat/conversations')) {
    return ok([
      { id: C1, title: '会话一', message_count: 2, conclusion: null, followup_round: null, followup_direction: null, created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z' },
      { id: C2, title: '会话二', message_count: 1, conclusion: null, followup_round: null, followup_direction: null, created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z' },
    ])
  }
  if (p.endsWith(`/chat/conversations/${C1}/messages`)) {
    return ok([
      msg('m1', C1, 'user', 'C1的历史问题'),
      msg('m2', C1, 'assistant', 'C1的历史回复'),
    ])
  }
  if (p.endsWith(`/chat/conversations/${C2}/messages`)) {
    return ok([msg('m3', C2, 'user', 'C2的历史问题')])
  }
  return ok(null)
})

await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

const bodyAfterLoad = await page.locator('body').innerText()
const b1 = bodyAfterLoad.includes('C1的历史问题') && bodyAfterLoad.includes('C1的历史回复')

// B2 切换会话
await page.getByText('会话二').first().click()
await page.waitForTimeout(900)
const bodyAfterSwitch = await page.locator('body').innerText()
const b2 = bodyAfterSwitch.includes('C2的历史问题')

console.log('========== 历史加载回归 ==========')
console.log(`  B1 初始加载（C1 的历史）  : ${b1 ? '通过 ✔' : '失败 ✘'}`)
console.log(`  B2 切换会话（C2 的历史）  : ${b2 ? '通过 ✔' : '失败 ✘'}`)
console.log(`     切换后页面是否还残留 C1 内容: ${bodyAfterSwitch.includes('C1的历史回复')}（预期 false）`)
console.log(`  未捕获异常: ${pageErrors.length ? pageErrors.join(' | ') : '无'}`)

await page.screenshot({ path: 'shots/qa-chat-history.png' })
await browser.close()
const pass = b1 && b2 && !bodyAfterSwitch.includes('C1的历史回复') && pageErrors.length === 0
console.log(pass ? '\n结果: 通过 —— 修复没有误伤历史消息加载' : '\n结果: 未通过')
process.exit(pass ? 0 : 1)
