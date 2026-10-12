/**
 * probe2.mjs �?取控件的实际几何与颜色（按钮、卡片），用于比对「首�?vs 其它页」的控件规格�? * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe2.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const main = document.querySelector('main') ?? document.body
  const btns = [...main.querySelectorAll('button, a[data-slot], a.inline-flex')].map((el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    return { text: (el.textContent||'').trim().slice(0,14), bg: cs.backgroundColor, color: cs.color,
      radius: cs.borderTopLeftRadius, h: Math.round(r.height), px: cs.paddingLeft, fs: cs.fontSize, fw: cs.fontWeight,
      border: cs.borderTopWidth + ' ' + cs.borderTopColor }
  }).filter((b) => b.h > 20)
  const cards = [...main.querySelectorAll('div')].filter((el) => {
    const cs = getComputedStyle(el)
    return cs.backgroundColor === 'rgb(255, 255, 255)' && cs.borderTopWidth !== '0px' && el.getBoundingClientRect().width > 300
  }).map((el) => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect()
    return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth + ' ' + cs.borderTopColor, pad: cs.padding, gap: cs.gap, shadow: cs.boxShadow === 'none' ? 'none' : 'yes', w: Math.round(r.width) }
  })
  return { btns, cards: cards.slice(0, 6) }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const routes = ['/resume', '/report']
  for (const route of routes) {
    const page = await ctx.newPage()
    await installApi(page, {})
    await page.addInitScript(INIT)
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(800)
    const { btns, cards } = await page.evaluate(PROBE)
    console.log(`\n===== ${route} =====`)
    for (const b of btns) {
      console.log(
        `BTN ${b.h}px r=${b.radius} px=${b.px} ${b.fs}/${b.fw} bg=${b.bg} fg=${b.color} bd=${b.border} | ${b.text}`,
      )
    }
    for (const c of cards) console.log(`CARD r=${c.radius} bd=${c.border} pad=${c.pad} gap=${c.gap} shadow=${c.shadow} w=${c.w}`)
    await page.close()
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
