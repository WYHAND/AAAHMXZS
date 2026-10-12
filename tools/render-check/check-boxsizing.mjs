/**
 * check-boxsizing.mjs — 取证：这个项目里 box-sizing 到底是什么、padding 会不会撑破 height。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/check-boxsizing.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const out = {}
  out.htmlBoxSizing = getComputedStyle(document.documentElement).boxSizing
  out.bodyBoxSizing = getComputedStyle(document.body).boxSizing
  const q = document.querySelector('div[class*="calc(100svh"]')
  if (q) {
    const cs = getComputedStyle(q)
    const r = q.getBoundingClientRect()
    out.answerPage = {
      boxSizing: cs.boxSizing, cssHeight: cs.height, padTop: cs.paddingTop, padBottom: cs.paddingBottom,
      mt: cs.marginTop, mb: cs.marginBottom,
      measuredH: Math.round(r.height), y: Math.round(r.y), bottom: Math.round(r.bottom),
      offsetH: q.offsetHeight, clientH: q.clientHeight,
    }
  }
  // 造一个对照：height:100px + padding:20px，看实测高度
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;left:-9999px;top:0;height:100px;padding:20px;box-sizing:border-box'
  document.body.appendChild(probe)
  out.control = { h: Math.round(probe.getBoundingClientRect().height), boxSizing: getComputedStyle(probe).boxSizing }
  probe.remove()
  // preflight 里有没有 *{box-sizing:border-box}
  const found = []
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = [...sheet.cssRules] } catch { continue }
    for (const rule of rules) {
      if (rule.selectorText && /box-sizing/.test(rule.style?.cssText ?? '') && /\\*|html/.test(rule.selectorText)) {
        found.push({ sel: rule.selectorText, css: rule.style.cssText.slice(0, 120) })
      }
    }
  }
  out.rules = found.slice(0, 6)
  out.docScrollH = document.documentElement.scrollHeight
  return out
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/test/question', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
