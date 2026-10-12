/**
 * probe3.mjs — 量外壳几何：顶栏高、侧栏宽、main 的内边距与内容宽度、首屏留白。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe3.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const box = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      pad: cs.padding, margin: cs.margin, maxW: cs.maxWidth }
  }
  const shell = document.querySelector('main > div')
  return {
    header: box('header'),
    aside: box('aside'),
    main: box('main'),
    shell: shell ? box('main > div') : null,
    shellClass: shell ? shell.className : null,
    inner: shell && shell.firstElementChild ? (() => { const r = shell.firstElementChild.getBoundingClientRect(); return { w: Math.round(r.width), maxW: getComputedStyle(shell.firstElementChild).maxWidth } })() : null,
    h1: box('main h1'),
    firstCard: (() => { const el = document.querySelector('main [data-slot=card]'); if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.y), w: Math.round(r.width) } })(),
    scrollY: window.innerHeight,
  }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  for (const vp of [
    { w: 1440, h: 900 },
    { w: 1280, h: 800 },
    { w: 1920, h: 1080 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, locale: 'zh-CN' })
    const page = await ctx.newPage()
    await installApi(page, {})
    await page.addInitScript(INIT)
    await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(700)
    const r = await page.evaluate(PROBE)
    console.log(`\n===== viewport ${vp.w}x${vp.h} =====`)
    console.log('header ', JSON.stringify(r.header))
    console.log('aside  ', JSON.stringify(r.aside))
    console.log('main   ', JSON.stringify(r.main))
    console.log('shell  ', JSON.stringify(r.shell), '\n   class:', r.shellClass)
    console.log('inner  ', JSON.stringify(r.inner))
    console.log('h1     ', JSON.stringify(r.h1))
    console.log('firstCard', JSON.stringify(r.firstCard))
    await ctx.close()
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
