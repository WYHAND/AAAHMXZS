/**
 * probe10.mjs — 验证指定工具类到底解析成什么颜色（可传任意类名）。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe10.mjs text-accent-ink bg-accent-ink
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const names = process.argv.slice(2)
if (!names.length) names.push('text-accent-ink', 'bg-accent-ink', 'text-secondary', 'text-accent-amber')

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  const out = await page.evaluate((list) => {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-9999px;top:0'
    document.body.appendChild(host)
    const res = {}
    for (const c of list) {
      const el = document.createElement('div')
      el.className = c
      el.textContent = 'x'
      host.appendChild(el)
      const cs = getComputedStyle(el)
      res[c] = { color: cs.color, bg: cs.backgroundColor }
      el.remove()
    }
    host.remove()
    return res
  }, names)
  console.log(JSON.stringify(out, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
