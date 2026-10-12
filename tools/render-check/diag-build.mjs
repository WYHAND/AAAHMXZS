/**
 * diag-build.mjs — 复现"生产构建下某页空白"并抓原因（请求日志 + pageerror + console）。
 * 用法：RC_BASE_URL=http://localhost:4173 node tools/render-check/diag-build.mjs /task/d4e5... 
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:4173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const route = process.argv[2] ?? '/task'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()

const reqs = []
const errors = []
const consoleErrors = []
page.on('pageerror', (e) => errors.push(String(e.message ?? e).slice(0, 200)))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
})
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('/api/') || u.includes('/chat')) reqs.push(`${r.method()} ${u}`)
})

const mock = await installApi(page, {})
await page.addInitScript(
  `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
)
await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
await sleep(2000)

const snap = await page.evaluate(() => ({
  url: location.pathname,
  rootChildren: document.querySelector('#root')?.children.length ?? -1,
  text: (document.body.innerText || '').trim().slice(0, 200),
  textLen: (document.body.innerText || '').trim().length,
}))

console.log('=== 请求（浏览器实际发出的）===')
for (const r of reqs) console.log('  ' + r)
console.log('=== mock 收到的请求 ===')
for (const r of mock.log) console.log('  ' + r.method + ' ' + r.path)
console.log('=== pageerror ===')
errors.forEach((e) => console.log('  ' + e))
console.log('=== console.error ===')
consoleErrors.slice(0, 8).forEach((e) => console.log('  ' + e))
console.log('=== 页面状态 ===')
console.log(JSON.stringify(snap, null, 2))

await browser.close()
