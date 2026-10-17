/**
 * ui-cta-check.mjs —— 「一屏一个实心主按钮」的**实测**检查。
 *
 * 为什么不用静态计数：同一个页面在不同分支（错误态 / 弹窗 / 空态）里各写一个 warm 按钮是合法的，
 * 静态 grep 会误报。这里把页面真的渲染出来，数**可见且可点**的 `[data-variant="warm"]`。
 *
 * 判据（契约三.6）：每屏 ≤1 个实心主 CTA；主 CTA 必须是 size="lg"。
 * 弹窗打开时遮罩外的按钮不可点，所以脚本把"弹窗内可见的"和"页面内可见的"分开报告。
 *
 * 用法：RC_BASE_URL=http://localhost:5173 node tools/render-check/ui-cta-check.mjs
 */
import { chromium } from 'playwright-core'
import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INTERVIEW_ID = 'b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e'

const ROUTES = [
  ['/', '主页（本轮不参与改造）'],
  ['/chat', 'AI 对话（本轮不参与改造）'],
  ['/task', '任务列表'],
  ['/task/d4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70', '任务详情'],
  ['/daily', '每日一问'],
  ['/profile', '个人画像'],
  ['/resume', '我的简历'],
  ['/report', '成长报告'],
  ['/interview', '面试选择'],
  ['/interview/prepare', '面试准备'],
  ['/interview/session', '面试答题'],
  [`/interview/review/${INTERVIEW_ID}`, '面试复盘'],
  ['/test/intro?retest=1', '测评引导'],
  ['/test/question', '测评答题'],
  ['/test/result', '测评结果'],
  ['/login', '登录'],
  ['/register', '注册'],
  ['/404', '404'],
]

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const results = []

for (const [route, label] of ROUTES) {
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  await installApi(page, {})
  await page.addInitScript(`
    window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));
    window.sessionStorage.setItem('ai_job_helper:interview_id', ${JSON.stringify(INTERVIEW_ID)});
  `)
  try {
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
    await page.waitForTimeout(700)
    const info = await page.evaluate(() => {
      const visible = (el) => {
        const b = el.getBoundingClientRect()
        const s = getComputedStyle(el)
        return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
      }
      const warm = [...document.querySelectorAll('[data-slot="button"][data-variant="warm"]')].filter(visible)
      // 弹窗（Radix dialog/sheet/alertdialog）内的按钮：打开时遮罩外不可点
      const inOverlay = (el) => Boolean(el.closest('[role="dialog"],[role="alertdialog"]'))
      return {
        total: warm.length,
        onPage: warm.filter((el) => !inOverlay(el)).length,
        notLg: warm.filter((el) => el.getAttribute('data-size') !== 'lg').length,
        labels: warm.map((el) => (el.textContent ?? '').trim().slice(0, 12)),
      }
    })
    results.push({ route, label, ...info, errors: errors.length })
  } catch (e) {
    results.push({ route, label, error: String(e.message ?? e), errors: errors.length })
  }
  await page.close()
}

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length))
console.log(pad('路由', 46) + pad('页面内', 8) + pad('含弹窗', 8) + pad('非lg', 6) + '按钮文案')
console.log('-'.repeat(110))
for (const r of results) {
  if (r.error) {
    console.log(pad(r.route, 46) + 'FAILED: ' + r.error.slice(0, 50))
    continue
  }
  const flag = r.onPage > 1 ? ' ← 同屏多个主 CTA' : ''
  console.log(
    pad(r.route, 46) +
      pad(r.onPage, 8) +
      pad(r.total, 8) +
      pad(r.notLg, 6) +
      (r.labels.join(' / ') || '—') +
      flag,
  )
}
console.log('-'.repeat(110))
const bad = results.filter((r) => !r.error && r.onPage > 1)
console.log(bad.length ? `超标 ${bad.length} 条：` + bad.map((r) => r.route).join(', ') : '全部页面：页面内可见主 CTA ≤1 ✓')
await browser.close()
process.exit(bad.length ? 1 : 0)
