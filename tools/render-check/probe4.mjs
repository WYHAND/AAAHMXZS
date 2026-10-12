/**
 * probe4.mjs — 首页关键元素的实测样式（用于 Phase 0 冻结前的"零回归"核对）。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe4.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const pick = (sel, label) => {
    const el = document.querySelector(sel)
    if (!el) return { label, missing: true }
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { label, color: cs.color, bg: cs.backgroundColor, fs: cs.fontSize, fw: cs.fontWeight,
      w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), radius: cs.borderTopLeftRadius }
  }
  const hero = document.querySelector('main [class*="rounded-xl"][class*="p-6"]')
  const bar = hero ? hero.querySelector('[style*="width"]') : null
  return {
    h1: pick('main h1', 'h1'),
    stagePill: pick('header a[data-stage]', '顶栏阶段 pill'),
    heroBar: bar ? { style: bar.getAttribute('style'), bg: getComputedStyle(bar).backgroundColor, w: Math.round(bar.getBoundingClientRect().width) } : null,
    accentLabel: pick('main span[class*="bg-secondary-fixed"]', '今日建议聚焦标签'),
    amberTitle: (() => { const els=[...document.querySelectorAll('main span')].filter(e=>e.textContent.trim()==='AI 发现与画像动态'); const el=els[0]; if(!el) return {missing:true}; const cs=getComputedStyle(el); return { color: cs.color, fs: cs.fontSize, fw: cs.fontWeight } })(),
    amberCaption: (() => { const els=[...document.querySelectorAll('main span')].filter(e=>e.textContent.includes('按微步前进中')); const el=els[0]; if(!el) return {missing:true}; const cs=getComputedStyle(el); return { color: cs.color, fs: cs.fontSize } })(),
    panelPad: (() => { const els=[...document.querySelectorAll('main div')].filter(e=>e.className.includes && String(e.className).includes('surface-container-lowest')); const el=els[0]; if(!el) return {missing:true}; const cs=getComputedStyle(el); return { pad: cs.padding, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow.slice(0,60) } })(),
    tokens: (() => { const cs=getComputedStyle(document.documentElement); return ['--secondary','--secondary-foreground','--primary-soft','--border','--canvas'].map(k=>k+'='+cs.getPropertyValue(k).trim()) })(),
  }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  const out = await page.evaluate(PROBE)
  console.log(JSON.stringify(out, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
