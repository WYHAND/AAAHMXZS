/**
 * measure-task-content.mjs — 量 /task 页"真实可用内容宽度"（视口 ≠ 内容区）。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/measure-task-content.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right) } }
  const main = document.querySelector('main')
  const shell = document.querySelector('main > div')
  const firstPanel = document.querySelector('[data-slot="panel"]')
  const aside = document.querySelector('aside')
  return {
    viewport: innerWidth,
    aside: r(aside),
    main: r(main),
    mainPadding: main ? getComputedStyle(main).paddingLeft + ' / ' + getComputedStyle(main).paddingRight : null,
    shell: r(shell),
    shellMaxW: shell ? getComputedStyle(shell).maxWidth : null,
    firstPanel: r(firstPanel),
  }
})()`

for (const width of [1025, 1280, 1440]) {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/task', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  console.log(`\n== viewport ${width} ==`)
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 1))
  await page.screenshot({ path: path.join(__dirname, 'audit', 'round0', `task-${width}.png`) })
  await browser.close()
}
