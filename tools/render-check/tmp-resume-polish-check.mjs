/**
 * tmp-resume-polish-check.mjs —— 润色回归检查（**只读**）。
 *
 * 这个 bug 的本质是"前端把信封解掉了"：mock 故意返回一个**带 message 的真信封**
 * （和真后端一模一样），然后真的点一次「让 AI 帮我改得更像简历」，断言两件事：
 *   ① 界面上**不出现**「润色这次没成功」那张卡；
 *   ② 后端那句 message 真的显示出来了（toast）。
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const OUT = path.join(__dirname, 'audit', 'preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const POLISH_MESSAGE = '已润色；还有 2 项你没填，先空着（项目经历、校园与实践经历）'
const RESUME = {
  id: 'pv-polish-1',
  title: '林小满-前端开发-2026 秋招',
  target_job: '前端开发工程师',
  completeness: 0.62,
  updated_at: new Date().toISOString(),
  parsed_data: {
    basic: { name: '林小满', grade: '大三', major: '软件工程', school: '华中科技大学', contact: 'lin@example.com' },
    target: { direction: '前端开发工程师', city: '武汉' },
    education: [{ school: '华中科技大学', major: '软件工程', period: '2023.09 - 2027.06', highlights: ['专业排名前 20%'] }],
    skills: ['熟悉 Vue 基础语法与状态管理。能使用 Vue 独立完成页面与组件开发。'],
    projects: [],
    campus: [],
    self_evaluation: '做事比较较真，答应的事会做完。',
  },
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))

  await installApi(page, { resumeMine: 'saved' })
  // 真信封（和真后端同形）：code/message/data 三件套
  await page.route('**/api/v1/resume/polish', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 0, message: POLISH_MESSAGE, data: RESUME }),
    }),
  )
  await page.route('**/api/v1/resume/mine', async (route) => {
    if (route.request().method().toUpperCase() !== 'GET') return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 0, message: 'success', data: RESUME }),
    })
  })
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )

  await page.goto(`${BASE_URL}/resume`, { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1800)
  await page.getByRole('button', { name: '回到填写' }).click()
  await sleep(600)
  await page
    .getByRole('button', { name: /让 AI 帮我改得更像简历/ })
    .first()
    .click()
  await sleep(2500)

  const body = await page.locator('body').innerText()
  const toast = await page.locator('[data-sonner-toast]').innerText().catch(() => '')
  const check = {
    errorCardShown: body.includes('润色这次没成功'),
    messageShown: body.includes(POLISH_MESSAGE) || toast.includes(POLISH_MESSAGE),
    toast,
    pageerrors: errors,
    verdict: !body.includes('润色这次没成功') && (body.includes(POLISH_MESSAGE) || toast.includes(POLISH_MESSAGE)) ? 'PASS' : 'FAIL',
  }
  await page.screenshot({ path: path.join(OUT, 'resume-polish-after-click.png'), fullPage: false })
  console.log(JSON.stringify(check, null, 1))
  await browser.close()
}

await main()
