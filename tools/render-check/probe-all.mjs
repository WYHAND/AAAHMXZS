/**
 * probe-all.mjs — 全站对比度巡检：一次跑完所有路由，只汇总"低对比"命中。
 *
 * 判定口径（与 probe.mjs 一致）：
 *   - 小字 <18.66px：WCAG 4.5:1；大字（≥24px，或 ≥18.66px 且 ≥700）3:1
 *   - disabled / aria-disabled 的控件不计失败（它们本来就该看起来点不动）
 *   - 半透明文字与半透明祖先按 alpha 合成后再算对比度
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe-all.mjs
 * 退出码：有命中 = 1，全清 = 0。
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const INTERVIEW_KEY = 'ai_job_helper:interview_id'
const SESSION_ID = 'b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
const TASK_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70'
const MIN = Number(process.env.RC_MIN_CONTRAST ?? 4.5)

const ROUTES = [
  { path: '/', token: true },
  { path: '/chat', token: true },
  { path: '/task', token: true },
  { path: `/task/${TASK_ID}`, token: true },
  { path: '/daily', token: true },
  { path: '/profile', token: true },
  { path: '/resume', token: true },
  { path: '/report', token: true },
  { path: '/interview', token: true },
  { path: '/interview/prepare', token: true },
  { path: '/interview/session', token: true, session: true },
  { path: `/interview/review/${SESSION_ID}`, token: true },
  { path: '/test/intro?retest=1', token: true },
  { path: '/test/question', token: true },
  { path: '/test/result', token: true },
  { path: '/login', token: false },
  { path: '/register', token: false },
  { path: '/404', token: false },
]

const PROBE = `(() => {
  const scope = document.querySelector('main') ?? document.body
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
  const effOpacity = (el) => { let o = 1, n = el; while (n && n !== document.documentElement) { o *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement } return o }
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 } }
  const composite = (fg, bg, op) => {
    const o = parse(fg), u = parse(bg); if (!o || !u) return fg
    const a = o.a * op
    const mix = (x, y) => Math.round(x * a + y * (1 - a))
    return 'rgb(' + mix(o.r, u.r) + ', ' + mix(o.g, u.g) + ', ' + mix(o.b, u.b) + ')'
  }
  const bad = []
  const els = scope.querySelectorAll('p, span, li, h1, h2, h3, button, label, dt, dd, a')
  for (const el of els) {
    if (!el.textContent || !el.textContent.trim() || el.children.length) continue
    const r = el.getBoundingClientRect()
    if (r.width < 3 || r.height < 3) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const bg = bgOf(el)
    const op = effOpacity(el)
    const fg = op < 1 ? composite(cs.color, bg, op) : cs.color
    const c = ratio(lum(fg), lum(bg))
    if (c === null) continue
    const px = parseFloat(cs.fontSize), wt = Number(cs.fontWeight) || 400
    const limit = px >= 24 || (px >= 18.66 && wt >= 700) ? 3 : 4.5
    const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || (el.closest('button') && el.closest('button').disabled)
    if (c < limit && !disabled) {
      bad.push({ text: el.textContent.trim().slice(0, 26), size: cs.fontSize, weight: cs.fontWeight, contrast: c, limit, color: fg, bg })
    }
  }
  return bad
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  let total = 0
  const summary = []
  for (const r of ROUTES) {
    const page = await ctx.newPage()
    await installApi(page, {})
    await page.addInitScript(
      (r.token
        ? `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`
        : `window.localStorage.removeItem(${JSON.stringify(TOKEN_KEY)});`) +
        (r.session
          ? `window.sessionStorage.setItem(${JSON.stringify(INTERVIEW_KEY)}, JSON.stringify(${JSON.stringify(SESSION_ID)}));`
          : ''),
    )
    try {
      await page.goto(BASE_URL + r.path, { waitUntil: 'networkidle', timeout: 25000 })
      await new Promise((res) => setTimeout(res, 1200))
      const bad = await page.evaluate(PROBE)
      total += bad.length
      summary.push({ path: r.path, bad: bad.length })
      if (bad.length) {
        console.log(`\n===== ${r.path} —— ${bad.length} 处低对比 =====`)
        for (const b of bad) {
          console.log(`  ${String(b.contrast).padStart(5)} (<${b.limit}) | ${b.size} ${b.weight} | ${b.color} on ${b.bg} | ${b.text}`)
        }
      }
    } catch (err) {
      summary.push({ path: r.path, bad: -1 })
      console.log(`\n===== ${r.path} —— 打开失败: ${String(err.message).slice(0, 80)}`)
    } finally {
      await page.close()
    }
  }
  await browser.close()
  console.log('\n===== 汇总（阈值 4.5 / 大字 3）=====')
  for (const s of summary) console.log(`${String(s.bad).padStart(3)}  ${s.path}`)
  console.log(total ? `\n合计 ${total} 处低对比` : '\n全站零低对比 ✔')
  process.exit(total ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
