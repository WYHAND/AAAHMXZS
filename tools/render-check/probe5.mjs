/**
 * probe5.mjs — 打印 dev server 上已编译的 CSS 里某几个工具类的真实声明值。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe5.mjs bg-secondary text-secondary bg-accent bg-primary-soft
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const wanted = process.argv.slice(2)
const classes = wanted.length
  ? wanted
  : ['bg-secondary', 'text-secondary', 'bg-accent', 'bg-primary-soft', 'border-border', 'bg-canvas']

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1000)

  const found = await page.evaluate((names) => {
    const out = {}
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of rules) {
        if (!rule.selectorText) continue
        for (const name of names) {
          if (new RegExp(`\\.${name}(\\\\/\\d+)?(\\s|,|:|$)`).test(rule.selectorText) && !out[name]) {
            out[name] = { selector: rule.selectorText, css: rule.style.cssText }
          }
        }
      }
    }
    return out
  }, classes)

  for (const c of classes) {
    console.log(`\n.${c}\n  ${found[c] ? found[c].selector + '\n  ' + found[c].css : '(未找到)'}`)
  }

  const html = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'bg-secondary'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const root = getComputedStyle(document.documentElement)
    const result = {
      bgSecondaryComputed: cs.backgroundColor,
      varSecondary: root.getPropertyValue('--secondary').trim(),
      varColorSecondary: root.getPropertyValue('--color-secondary').trim(),
      varAccent: root.getPropertyValue('--accent').trim(),
      varColorAccent: root.getPropertyValue('--color-accent').trim(),
    }
    probe.remove()
    return result
  })
  console.log('\n运行时解析:', JSON.stringify(html, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
