/**
 * a1-css-rule.mjs —— A1 号子工具（只读）：把 dev server 样式表里 hello 到 h-[calc(...)] 生成的真实规则打出来。
 * 目的：`h-[calc(100svh-var(--spacing-shell)-var(--spacing-margin)-44px)]` 实测算出 748px（未减 2rem），
 *       要看清编译器到底生成了什么 CSS，再决定写法。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-css-rule.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const GRAB = `(() => {
  const wanted = ['svh', 'spacing-shell', 'spacing-margin', '7.5rem', 'max-w-2xl', 'pt-shell']
  const hits = []
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    const walk = (list, media) => {
      for (const r of list) {
        if (r.cssRules) { walk(r.cssRules, r.conditionText ?? media); continue }
        const t = r.cssText ?? ''
        if (wanted.some((w) => t.includes(w))) hits.push((media ? '@media ' + media + ' :: ' : '') + t.slice(0, 300))
      }
    }
    walk(rules, null)
  }
  return hits.slice(0, 60)
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + '/test/question', { waitUntil: 'networkidle', timeout: 30000 })
  await sleep(1000)
  // 先把两个候选类用上，确保它们在样式表里被生成
  await page.evaluate(() => {
    const d = document.createElement('div')
    d.className =
      'h-[calc(100svh-var(--spacing-shell)-var(--spacing-margin)-44px)] h-[calc(100svh-var(--spacing-shell)-2rem-44px)]'
    document.body.appendChild(d)
  })
  await sleep(1500)
  const hits = await page.evaluate(GRAB)
  for (const h of hits) console.log(h)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
