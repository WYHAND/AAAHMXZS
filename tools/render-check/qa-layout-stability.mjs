/**
 * 布局稳定性验证：/test/question 的底部按钮在「3 个选项」与「4 个选项」之间是否固定。
 *
 * 为什么必须量而不是看代码：
 *   「按钮不再跳动」是个几何断言，只有拿到真实渲染后的坐标才能证明。
 *   光改 CSS 然后说"应该好了"，就是本项目一直在批判的"静态验证"。
 *
 * 用法：node qa-layout-stability.mjs
 * 前置：另开一个终端跑 `npx vite preview --port 4173`（注意用 localhost，preview 只监听 IPv6）
 */
import { chromium } from 'playwright-core'
import { shotPath } from './shot-path.mjs'

const BASE = 'http://localhost:4173'

const Q3 = {
  id: 'q3', dimension: '兴趣', multiple: false,
  content: '【3 个选项】你更想做哪种工作？',
  options: [
    { key: 'A', text: '做出具体的东西' },
    { key: 'B', text: '和人打交道、组织协调' },
    { key: 'C', text: '还没想清楚' },
  ],
}
const Q4 = {
  id: 'q4', dimension: '能力', multiple: false,
  content: '【4 个选项】你的简历里有可以量化的成果吗？',
  options: [
    { key: 'A', text: '有，多条都有具体数字或结果' },
    { key: 'B', text: '有 1-2 条' },
    { key: 'C', text: '只写了职责，没有结果' },
    { key: 'D', text: '没有可写的经历' },
  ],
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.addInitScript(() => {
  localStorage.setItem('ai_job_helper:token', JSON.stringify('qa-token'))
})

await page.route('**/api/v1/**', async (route) => {
  const p = new URL(route.request().url()).pathname
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
  if (p.endsWith('/test/questions')) return ok([Q3, Q4])
  return ok(null)
})

async function measure(label) {
  const prev = await page.getByRole('button', { name: '上一题' }).boundingBox()
  const skip = await page.getByRole('button', { name: /跳过/ }).boundingBox()
  const card = await page.locator('[data-slot="card"]').first().boundingBox()
  const title = await page.locator('h1').first().innerText()
  const opts = await page.locator('button:has(span.font-numeric)').count()
  return { label, title, opts, prevY: prev?.y, skipY: skip?.y, cardH: card?.height, cardY: card?.y }
}

await page.goto(`${BASE}/test/question`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const a = await measure('3 选项')
await page.screenshot({ path: shotPath('qa-3options.png') })

// 点「跳过这题」进入下一题（4 选项）
await page.getByRole('button', { name: /跳过/ }).click()
await page.waitForTimeout(600)
const b = await measure('4 选项')
await page.screenshot({ path: shotPath('qa-4options.png') })

console.log('========== 实测结果 ==========')
for (const m of [a, b]) {
  console.log(`[${m.label}] 选项数=${m.opts}`)
  console.log(`    题目: ${m.title}`)
  console.log(`    卡片 y=${m.cardY?.toFixed(1)} 高=${m.cardH?.toFixed(1)}`)
  console.log(`    「上一题」y=${m.prevY?.toFixed(1)}   「跳过」y=${m.skipY?.toFixed(1)}`)
}

const dPrev = Math.abs((a.prevY ?? 0) - (b.prevY ?? 0))
const dSkip = Math.abs((a.skipY ?? 0) - (b.skipY ?? 0))
const dCard = Math.abs((a.cardH ?? 0) - (b.cardH ?? 0))

console.log('========== 判定 ==========')
console.log(`  卡片高度变化: ${dCard.toFixed(1)}px  → ${dCard > 5 ? '题目确实换了（测试有效 ✔）' : '!! 两题高度一样，测试无效'}`)
console.log(`  「上一题」位移: ${dPrev.toFixed(1)}px  → ${dPrev < 1 ? '固定 ✔' : '仍然跳动 ✘'}`)
console.log(`  「跳过」位移:   ${dSkip.toFixed(1)}px  → ${dSkip < 1 ? '固定 ✔' : '仍然跳动 ✘'}`)
console.log(`  未捕获异常: ${errors.length ? errors.join(' | ') : '无 ✔'}`)

await browser.close()
const pass = dCard > 5 && dPrev < 1 && dSkip < 1 && errors.length === 0
console.log(pass ? '\n结果: 通过 —— 按钮在两种题目下位置一致' : '\n结果: 未通过')
process.exit(pass ? 0 : 1)
