/**
 * probe9.mjs — 直接把页面里"带某个类的元素"的 getComputedStyle 打出来（不建虚拟节点）。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe9.mjs text-secondary
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const target = process.argv[2] ?? 'text-secondary'

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  const out = await page.evaluate((cls) => {
    const els = [...document.querySelectorAll('*')].filter((e) =>
      typeof e.className === 'string' && e.className.split(/\s+/).includes(cls),
    )
    const listed = els.slice(0, 8).map((e) => {
      const cs = getComputedStyle(e)
      return { tag: e.tagName, text: (e.textContent || '').trim().slice(0, 18), color: cs.color, bg: cs.backgroundColor }
    })
    // 直接问"这个类现在解析成什么颜色"：按 CSSOM 找到规则
    let ruleCss = null
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = [...sheet.cssRules]
      } catch {
        continue
      }
      for (const rule of rules) {
        if (rule.selectorText && rule.selectorText.split(',').some((s) => s.trim() === '.' + cls)) {
          ruleCss = rule.style.cssText
          break
        }
      }
      if (ruleCss) break
    }
    return { count: els.length, listed, ruleCss }
  }, target)
  console.log(JSON.stringify(out, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
