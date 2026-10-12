/**
 * a1-quiz-audit.mjs —— A1 号子智能体的验收脚本：把「测评链路三页 + 守卫态」一次性跑完并出证据。
 *
 * 为什么不用 tools/render-check/probe.mjs：
 *   它的选择器是 `main p, main span, ...`，而这四页都**不在 AppLayout 里、没有 main**，
 *   于是对它们只输出空表 —— 空表会被误读成"零低对比"。本脚本用 body 作用域 + 叶子节点匹配，
 *   并额外覆盖守卫态（把 /profile 打成 500，逼出「没能读到你的数据」那一屏）。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-quiz-audit.mjs
 * 产出：tools/render-check/audit/round1/a1-quiz-*.png + 控制台对比度明细
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const OUT_DIR = path.join(__dirname, 'audit', 'round1')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 目标：探测「页面上每一段可见文字」的前景/背景对比度（对比度 <2.5 = 读不出来） */
const PROBE = `(() => {
  const lum = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null
    const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x))
    if (a === 0) return null
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const bgOf = (el) => {
    let n = el
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor
      if (lum(bg) !== null) return bg
      n = n.parentElement
    }
    return getComputedStyle(document.body).backgroundColor
  }
  const ratio = (a, b) => { if (a === null || b === null) return null; const hi = Math.max(a,b), lo = Math.min(a,b); return Math.round(((hi+0.05)/(lo+0.05))*100)/100 }
  const leaves = [...document.querySelectorAll('body *')].filter((el) => {
    if (['SCRIPT','STYLE','SVG','PATH','BR'].includes(el.tagName)) return false
    return [...el.childNodes].every((n) => n.nodeType === 3) && el.textContent.trim().length > 1
  })
  const rows = leaves.map((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const bg = bgOf(el)
    return { text: el.textContent.trim().slice(0, 26), tag: el.tagName.toLowerCase(),
      size: cs.fontSize, weight: cs.fontWeight, color: cs.color, bg,
      contrast: ratio(lum(cs.color), lum(bg)), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }).filter((x) => x.w > 2 && x.h > 2 && x.y < 1200)
  return { rows, h1: document.querySelector('h1') ? (() => { const h = document.querySelector('h1'); const c = getComputedStyle(h); return { text: h.textContent.trim().slice(0,24), size: c.fontSize, weight: c.fontWeight, y: Math.round(h.getBoundingClientRect().y) } })() : null,
    hasMain: !!document.querySelector('main'), docScrollH: document.documentElement.scrollHeight, innerH: window.innerHeight }
})()`

/**
 * 守卫态：只把 /profile 打成 500，逼出 FullScreenHint 的「加载失败」分支。
 * ⚠️ /auth/me 必须保持成功：authStore.fetchMe 一旦失败会清 token → 守卫直接跳登录页，
 *    那就拍到登录页而不是守卫态了（第一次就是这么拍错的）。
 */
async function installFailingProfile(page) {
  await installApi(page, {})
  await page.route('**/api/v1/**', async (route) => {
    const p = new URL(route.request().url()).pathname
    if (p.endsWith('/profile')) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 500, message: 'mock: backend down', data: null }),
      })
    }
    return route.fallback()
  })
}

async function audit(route, label, { failProfile = false } = {}) {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  if (failProfile) await installFailingProfile(page)
  else await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await sleep(2000)
  const r = await page.evaluate(PROBE)
  await mkdir(OUT_DIR, { recursive: true })
  const png = path.join(OUT_DIR, `a1-quiz-${label}.png`)
  await page.screenshot({ path: png })
  console.log(`\n===== ${route}${failProfile ? '  (profile 500)' : ''} → ${path.basename(png)} =====`)
  console.log(`h1: ${r.h1 ? `${r.h1.size}/${r.h1.weight} y=${r.h1.y} 「${r.h1.text}」` : '（没有 h1）'} | main 元素: ${r.hasMain ? '有' : '无（裸路由）'} | docScrollH=${r.docScrollH} / 视口 ${r.innerH}${r.docScrollH > r.innerH ? '  ← 有滚动' : '  ← 不滚动 ✔'}`)
  let low = 0
  for (const x of r.rows) {
    const flag = x.contrast !== null && x.contrast < 2.5 ? '  <== 低对比' : ''
    if (flag) low++
    console.log(`${String(x.contrast ?? '-').padStart(5)} | ${x.size.padStart(6)} ${x.weight} | ${x.color} on ${x.bg} | y=${String(x.y).padStart(4)} | ${x.text}${flag}`)
  }
  console.log(`低对比: ${low} ${low === 0 ? '✔' : '✘'} | pageerrors: ${errors.length ? errors.join(' | ') : '无 ✔'}`)
  await browser.close()
  return low
}

const total = []
total.push(await audit('/test/result', 'result'))
total.push(await audit('/test/intro?retest=1', 'intro'))
total.push(await audit('/test/question', 'question'))
total.push(await audit('/', 'guard-fail', { failProfile: true }))
console.log(`\n>>> 四屏低对比合计: ${total.reduce((a, b) => a + b, 0)}`)
process.exit(total.every((n) => n === 0) ? 0 : 1)
