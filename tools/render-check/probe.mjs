/**
 * probe.mjs — 定点取色/取字：给「某个页面某段文字为什么看不见」这类问题取证。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const INIT = `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 把「前景/背景对比度」算出来，看不见的文字会直接暴露（<2 基本读不出来） */
const PROBE = `(() => {
  /* /test/* 是裸路由（不在 AppLayout 里），页面上没有 main —— 退回到 body，
     否则那些页面的文字会被整页跳过、探针给"零问题"的假绿。 */
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
      const l = lum(bg)
      if (l !== null) return bg
      n = n.parentElement
    }
    return getComputedStyle(document.body).backgroundColor
  }
  const ratio = (a, b) => { if (a === null || b === null) return null; const hi = Math.max(a,b), lo = Math.min(a,b); return Math.round(((hi+0.05)/(lo+0.05))*100)/100 }
  /**
   * 从元素往上累计 opacity，并把半透明前景/背景按 alpha 合成成"真实像素颜色"。
   * 为什么需要：disabled:opacity-50 叠在深色主按钮上时，元素的 computed color 仍是
   * 白色、祖先背景仍是深墨，朴素算法会得出 1.05:1 的**假**低对比；按合成后算是 5.27:1。
   * ⚠️ 这段是注入到浏览器里执行的源码字符串，**不能出现反引号**（会截断外层模板字符串）。
   */
  const effOpacity = (el) => {
    let o = 1, n = el
    while (n && n !== document.documentElement) { o *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement }
    return o
  }
  const composite = (over, under) => {
    // over/under 是 'rgba(r,g,b,a)' / 'rgb(r,g,b)'
    const p = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 } }
    const o = p(over), u = p(under)
    if (!o) return under
    if (!u) return over
    const a = o.a
    const mix = (x, y) => Math.round(x * a + y * (1 - a))
    return 'rgb(' + mix(o.r, u.r) + ', ' + mix(o.g, u.g) + ', ' + mix(o.b, u.b) + ')'
  }
  const rows = [...scope.querySelectorAll('p, span, li, h1, h2, h3, button')]
    .filter((el) => el.textContent && el.textContent.trim().length > 1 && !el.children.length)
    .map((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const bg = bgOf(el)
      const op = effOpacity(el)
      // 半透明文字 / 半透明祖先：都先合成到真实底色上再算对比度
      const fg = op < 1 ? composite(cs.color.replace(/rgba?\\(([^)]+)\\)/, (m, g) => {
        const v = g.split(',').map(Number); const a = (v[3] ?? 1) * op
        return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'
      }), bg) : cs.color
      const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true' || (el.closest('button')?.disabled ?? false)
      return {
        text: el.textContent.trim().slice(0, 24),
        size: cs.fontSize, weight: cs.fontWeight, color: fg, bg,
        contrast: ratio(lum(fg), lum(bg)),
        op, disabled,
        w: Math.round(r.width), h: Math.round(r.height),
      }
    })
    .filter((x) => x.w > 2 && x.h > 2)
  return rows
})()`

/**
 * 小字对比度阈值：WCAG 对 <18.66px（或 <24px 非粗体）要求 **4.5:1**。
 * 原来这里用 2.5，结果一批"2.44–2.56"的文字被放过 —— 那正是页面上读不清的灰字。
 * 现在按 4.5 判；纯装饰文字（不该承载信息）请改用 text-on-surface-variant。
 */
const MIN_CONTRAST = Number(process.env.RC_MIN_CONTRAST ?? 4.5)

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const targets = process.argv.slice(2)
  const routes = targets.length ? targets : ['/daily', '/']

  for (const route of routes) {
    const page = await ctx.newPage()
    await installApi(page, {})
    await page.addInitScript(INIT)
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(900)
    const rows = await page.evaluate(PROBE)
    console.log(`\n===== ${route} =====`)
    for (const r of rows) {
      /*
       * 判定：
       * - 禁用态控件（disabled / aria-disabled）不计入失败 —— 它们本来就该"看起来点不动"，
       *   而且探针已经按 opacity 合成算过真实对比度，不会误报。
       * - 大字号（≥24px，或 ≥18.66px 且 ≥700）按 WCAG 只需 3:1。
       */
      const px = parseFloat(r.size)
      const wt = Number(r.weight) || 400
      const large = px >= 24 || (px >= 18.66 && wt >= 700)
      const limit = large ? 3 : MIN_CONTRAST
      const low = r.contrast !== null && r.contrast < limit && !r.disabled
      const flag = r.disabled
        ? r.contrast !== null && r.contrast < limit
          ? '  (禁用态·不计)'
          : ''
        : low
          ? '  <== 低对比'
          : ''
      console.log(
        `${String(r.contrast ?? '-').padStart(5)} | ${r.size.padStart(6)} ${r.weight} | ${r.color} on ${r.bg} | ${r.text}${flag}`,
      )
    }
    await page.close()
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
