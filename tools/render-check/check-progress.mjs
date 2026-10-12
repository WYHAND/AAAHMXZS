/**
 * check-progress.mjs — 查 /task 卡片进度条填充的真实颜色与生效规则。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/check-progress.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const root = document.querySelector('[data-slot="progress"]')
  const ind = document.querySelector('[data-slot="progress-indicator"]')
  const st = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { cls: el.getAttribute('class'), bg: cs.backgroundColor, h: Math.round(r.height), w: Math.round(r.width), transform: cs.transform }
  }
  return {
    root: st(root),
    indicator: st(ind),
    secondaryToken: getComputedStyle(document.documentElement).getPropertyValue('--secondary').trim(),
    primaryToken: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  }
})()`

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1025, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()
await installApi(page, {})
await page.addInitScript(INIT)
await page.goto(BASE_URL + '/task', { waitUntil: 'networkidle', timeout: 25000 })
await sleep(1500)
console.log(JSON.stringify(await page.evaluate(PROBE), null, 2))
await browser.close()
