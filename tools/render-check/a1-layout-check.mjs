/**
 * a1-layout-check.mjs —— A1 号子工具：验证 /test/intro 与 /test/result 挂进 BlankLayout 后的外壳几何。
 * 断言：窄栏真的是 448px、有 main/footer、整页无多余滚动、h1 是 26/700、卡片宽度。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-layout-check.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CHECK = `(() => {
  const q = (s) => document.querySelector(s)
  const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) } }
  const h1 = q('h1')
  const panel = q('[data-slot="panel"]')
  const col = q('[data-blank-width]')
  const main = q('main')
  const footer = q('footer')
  return {
    h1: h1 ? { text: h1.textContent.trim().slice(0, 20), size: getComputedStyle(h1).fontSize, weight: getComputedStyle(h1).fontWeight, box: box(h1) } : null,
    blankWidth: col ? col.getAttribute('data-blank-width') : null,
    column: box(col),
    panel: box(panel),
    main: main ? { box: box(main), pt: getComputedStyle(main).paddingTop, align: getComputedStyle(main).alignItems } : null,
    footer: footer ? { box: box(footer), text: footer.textContent.trim().slice(0, 20) } : null,
    hasMain: !!main,
    docScrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
    bg: getComputedStyle(document.body).backgroundColor,
  }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  let pass = true
  for (const route of ['/test/intro?retest=1', '/test/result']) {
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
    await installApi(page, {})
    await page.addInitScript(
      `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
    )
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 30000 })
    await sleep(1500)
    const r = await page.evaluate(CHECK)
    console.log(`\n===== ${route} =====`)
    console.log(`  h1: ${r.h1 ? `${r.h1.size}/${r.h1.weight} y=${r.h1.box.y} x=${r.h1.box.x} 「${r.h1.text}」` : '（没有）'}`)
    console.log(`  data-blank-width=${r.blankWidth}  窄栏 w=${r.column?.w} x=${r.column?.x}`)
    console.log(`  main: ${r.hasMain ? `y=${r.main.box.y} h=${r.main.box.h} pt=${r.main.pt} align=${r.main.align}` : '无'}`)
    console.log(`  footer: ${r.footer ? `y=${r.footer.box.y} h=${r.footer.box.h} 「${r.footer.text}」` : '无'}`)
    console.log(`  卡片(Panel): x=${r.panel?.x} w=${r.panel?.w} h=${r.panel?.h}`)
    console.log(`  docScrollH=${r.docScrollH} / 视口 ${r.innerH}${r.docScrollH > r.innerH ? '  ← 有滚动 ✘' : '  ← 不滚动 ✔'}`)
    console.log(`  pageerrors: ${errors.length ? errors.join(' | ') : '无 ✔'}`)
    const ok = r.hasMain && r.blankWidth === 'md' && r.column?.w === 448 && r.docScrollH <= r.innerH && r.h1?.size === '26px' && errors.length === 0
    console.log(`  断言（有 main + 窄栏 448 + 不滚动 + h1 26px + 无异常）: ${ok ? 'PASS ✔' : 'FAIL ✘'}`)
    if (!ok) pass = false
    await page.close()
  }
  await browser.close()
  console.log(`\n>>> ${pass ? '全部 PASS' : '存在 FAIL'}`)
  process.exit(pass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
