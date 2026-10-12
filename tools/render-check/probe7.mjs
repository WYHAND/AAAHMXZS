/**
 * probe7.mjs — 列出页面实际加载的样式表，并从中找指定工具类的真实声明。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe7.mjs bg-secondary text-secondary
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['bg-secondary', 'text-secondary']

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)

  const info = await page.evaluate(async (targets) => {
    const sheets = [...document.querySelectorAll('link[rel=stylesheet], style')].map((n) => ({
      tag: n.tagName,
      href: n.getAttribute('href') ?? '(inline)',
    }))
    const hits = {}
    for (const sheet of document.styleSheets) {
      let rules = []
      try {
        rules = [...sheet.cssRules]
      } catch {
        continue
      }
      for (const rule of rules) {
        const sel = rule.selectorText ?? ''
        for (const t of targets) {
          if (sel.split(',').some((s) => s.trim() === '.' + t) && !hits[t]) {
            hits[t] = { sheet: sheet.href ?? '(inline)', selector: sel, css: rule.style.cssText }
          }
        }
      }
    }
    return { sheets, hits, ruleCounts: [...document.styleSheets].map((s) => { try { return s.cssRules.length } catch { return -1 } }) }
  }, names)

  console.log('样式表:', JSON.stringify(info.sheets, null, 2))
  console.log('规则数:', JSON.stringify(info.ruleCounts))
  for (const t of names) console.log(`\n.${t} =>`, JSON.stringify(info.hits[t], null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
