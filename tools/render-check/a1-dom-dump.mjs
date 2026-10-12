/**
 * a1-dom-dump.mjs —— A1 号子工具：把路由的 DOM 外壳结构打出来（定位布局归属，只读不改代码）。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-dom-dump.mjs /test/question /test/result
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DUMP = `(() => {
  const lines = []
  const walk = (el, depth) => {
    if (depth > 5) return
    const s = getComputedStyle(el)
    const b = el.getBoundingClientRect()
    const cls = (typeof el.className === 'string' ? el.className : '').slice(0, 110)
    lines.push('  '.repeat(depth) + '<' + el.tagName.toLowerCase() + '> y=' + Math.round(b.y) + ' h=' + Math.round(b.height) + ' w=' + Math.round(b.width) + ' pt=' + s.paddingTop + ' pb=' + s.paddingBottom + ' pos=' + s.position + ' | ' + cls)
    if (depth < 5) [...el.children].forEach((c) => walk(c, depth + 1))
  }
  walk(document.body, 0)
  const h1 = document.querySelector('h1')
  const h1b = h1 ? h1.getBoundingClientRect() : null
  return { lines, h1: h1 ? { text: h1.textContent.trim().slice(0, 30), y: Math.round(h1b.y), x: Math.round(h1b.x), size: getComputedStyle(h1).fontSize, weight: getComputedStyle(h1).fontWeight } : null, bodyW: document.body.getBoundingClientRect().width }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  for (const route of process.argv.slice(2)) {
    const page = await ctx.newPage()
    await installApi(page, {})
    await page.addInitScript(
      `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
    )
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(1200)
    const d = await page.evaluate(DUMP)
    console.log(`\n========== ${route} ==========`)
    console.log(`h1: ${d.h1 ? JSON.stringify(d.h1) : '（没有 h1）'} | body w=${d.bodyW}`)
    for (const l of d.lines) console.log(l)
    await page.close()
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
