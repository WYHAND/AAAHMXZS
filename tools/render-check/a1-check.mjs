/**
 * 验证 A1 修复：未测评用户从 /interview 被拦到 /test/intro 时，是否多一句"为什么"。
 * 同时回归：非面试来源（直接访问 /resume）不应出现那句话。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5173'
const API = 'http://127.0.0.1:8000/api/v1'
const EDGE = process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT = path.join(__dirname, 'shots', 'a1-check')
const TOKEN_KEY = 'ai_job_helper:token'
const HINT = '模拟面试要按你的画像和简历出题'

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  // 新账号（未测评）
  const u = 'probe_' + Math.random().toString(16).slice(2, 8)
  const reg = await fetch(API + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'probe-pass-123456', grade: '大三' }),
  }).then((r) => r.json())
  const token = reg?.data?.access_token
  console.log('新账号 ' + u + ' 注册=' + reg.code)

  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(JSON.stringify(token))});`,
  )

  // ① 从 /interview 进入 → 应被拦到 /test/intro 并带 from=/interview
  await page.goto(BASE_URL + '/interview', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  const url1 = page.url()
  const body1 = await page.evaluate(() => document.body.innerText)
  const has1 = body1.includes(HINT)
  await page.screenshot({ path: path.join(OUT, '01-从面试被拦-有说明.png'), fullPage: true })
  console.log('① 落地URL: ' + url1)
  console.log('① 有说明句: ' + has1)
  console.log('① 正文: ' + body1.replace(/\n{2,}/g, ' | ').slice(0, 420))

  // ② 从 /resume 进入 → 同样被拦，但**不应**出现那句话
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
  const page2 = await ctx2.newPage()
  await page2.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(JSON.stringify(token))});`,
  )
  await page2.goto(BASE_URL + '/resume', { waitUntil: 'networkidle', timeout: 30000 })
  await page2.waitForTimeout(2000)
  const body2 = await page2.evaluate(() => document.body.innerText)
  const has2 = body2.includes(HINT)
  await page2.screenshot({ path: path.join(OUT, '02-从简历被拦-无多余说明.png'), fullPage: true })
  console.log('② 落地URL: ' + page2.url())
  console.log('② 有说明句（应为 false）: ' + has2)

  console.log('\n控制台报错: ' + (errors.length ? errors.slice(0, 5).join(' | ') : '（无）'))
  console.log('账号: ' + u)
  await browser.close()
}

main().catch((e) => {
  console.log('FATAL ' + (e?.stack ?? e))
  process.exit(1)
})
