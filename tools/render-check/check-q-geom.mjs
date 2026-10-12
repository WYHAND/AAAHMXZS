/**
 * check-q-geom.mjs — 答题页（/test/question）一屏几何与容器类名的现场取证。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/check-q-geom.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const root = document.querySelector('#root > div > div') ?? document.querySelector('#root div')
  // 找到带 h-[calc( 的那个容器（页面自己的高度容器）
  const all = [...document.querySelectorAll('div')]
  const box = all.find((d) => typeof d.className === 'string' && d.className.includes('calc(100svh'))
  const btn = (text) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes(text))
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { y: Math.round(b.y), bottom: Math.round(b.bottom), h: Math.round(b.height) } }
  return {
    viewportH: innerHeight,
    container: box ? { cls: box.className, box: r(box), padTop: getComputedStyle(box).paddingTop, padBottom: getComputedStyle(box).paddingBottom, heightCss: getComputedStyle(box).height } : null,
    prev: r(btn('上一题')),
    skip: r(btn('跳过')),
    card: r(document.querySelector('[data-slot=card]')),
    rootChild: (() => { const el = document.querySelector('#root > div'); return el ? { cls: el.className, box: r(el) } : null })(),
  }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/test/question', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1500)
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
