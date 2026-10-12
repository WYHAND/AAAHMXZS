/**
 * a1-css-probe.mjs —— A1 号子工具（只读）：实测 Tailwind 任意值里 calc()+CSS 变量的解析行为。
 * 起因：`h-[calc(100svh-var(--spacing-shell)-var(--spacing-margin)-44px)]` 实测算出 748px，
 *       按 token（76px / 2rem）手算应是 684px —— 必须查清是哪一段没被减掉，再选一个**真的生效**的写法。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-css-probe.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 期望值（1440×900 视口）：100svh=900，shell=76，margin=32 */
const CANDIDATES = [
  'h-[calc(100svh-var(--spacing-shell)-var(--spacing-margin)-44px)]',
  'h-[calc(100svh-var(--spacing-shell)-var(--spacing-margin))]',
  'h-[calc(100svh-var(--spacing-margin)-var(--spacing-shell))]',
  'h-[calc(100svh-44px-var(--spacing-shell)-var(--spacing-margin))]',
  'h-[calc(100svh-var(--spacing-shell)-44px-var(--spacing-margin))]',
  'h-[calc(100svh-var(--spacing-shell)-var(--spacing-margin)-44px)] ', // 尾空格无意义，仅占位
  'h-[calc(100svh_-_var(--spacing-shell)_-_var(--spacing-margin)_-_44px)]',
  'h-[calc(100svh-var(--spacing-shell)-2rem-44px)]',
  'h-[calc(100svh-76px-2rem-44px)]',
  'h-[calc(100svh-7.5rem)]',
  'h-[calc(100svh-var(--spacing-shell))]',
  'h-[calc(100svh-140px)]',
]

const PROBE = (cands) => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px'
  document.body.appendChild(host)
  const out = []
  for (const cls of cands) {
    const d = document.createElement('div')
    d.className = cls
    host.appendChild(d)
    const cs = getComputedStyle(d)
    out.push({ cls, height: cs.height })
  }
  host.remove()
  return { innerH: window.innerHeight, out }
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + '/test/question', { waitUntil: 'networkidle', timeout: 30000 })
  await sleep(1200)
  const r = await page.evaluate(PROBE, CANDIDATES)
  console.log(`innerH=${r.innerH}（期望：900-76-32-44=748 才是"三段都减掉"）`)
  for (const c of r.out) console.log(`h=${String(c.height).padStart(7)} | ${c.cls}`)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
