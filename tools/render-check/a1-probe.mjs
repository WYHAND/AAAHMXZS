/**
 * a1-probe.mjs —— A1 号子智能体专用：给**裸路由**（没有 `main` 外层，如 /test/*）做对比度与几何取证。
 *
 * 为什么需要它：共享的 tools/render-check/probe.mjs 选择器写的是 `main p, main span, ...`，
 * 而 /test/result、/test/intro、/test/question 这几页**不在 AppLayout 里、没有 main**，
 * 于是 probe.mjs 对它们输出空表 —— 空表不等于"零低对比"，只是"没量到"。
 * 本脚本用 body 作用域 + 只取叶子节点（textContent 非空、无子元素）做同样的事，
 * 另外顺带量主按钮几何与卡片内边距，覆盖设计系统验收第 1、2 条。
 *
 * 只读，不改任何源码。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-probe.mjs /test/result /test/intro?retest=1 /test/question
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 对比度：把每一条可见文字的前景色与"真实生效的背景色"（向上找到第一个不透明背景）算比值 */
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
  // 叶子节点：自己不含元素子节点（<br> 例外）—— 这样按钮/布局容器不会重复计数
  const leaves = [...document.querySelectorAll('body *')].filter((el) => {
    if (['SCRIPT','STYLE','SVG','PATH','BR'].includes(el.tagName)) return false
    return [...el.childNodes].every((n) => n.nodeType === 3) && el.textContent.trim().length > 1
  })
  const rows = leaves.map((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const bg = bgOf(el)
    return {
      text: el.textContent.trim().slice(0, 26),
      tag: el.tagName.toLowerCase(),
      size: cs.fontSize, weight: cs.fontWeight, color: cs.color, bg,
      contrast: ratio(lum(cs.color), lum(bg)),
      y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
    }
  }).filter((x) => x.w > 2 && x.h > 2 && x.y < 1400)
  // 主按钮几何（实心暖色/主墨，h>=40 视为大按钮）
  const buttons = [...document.querySelectorAll('button, a[href]')].map((b) => {
    const cs = getComputedStyle(b); const r = b.getBoundingClientRect()
    return { text: b.textContent.trim().slice(0, 18), h: Math.round(r.height), w: Math.round(r.width),
      radius: cs.borderRadius, size: cs.fontSize, weight: cs.fontWeight, bg: cs.backgroundColor, y: Math.round(r.y) }
  }).filter((b) => b.h >= 40)
  // 卡片内边距
  const cards = [...document.querySelectorAll('[data-slot="panel"], [data-slot="card"], [data-slot="empty-state"], [data-slot="panel-inset"]')].map((c) => {
    const cs = getComputedStyle(c)
    return { slot: c.getAttribute('data-slot'), p: cs.padding, radius: cs.borderRadius, shadow: cs.boxShadow.slice(0, 40), border: cs.borderTopColor + ' / ' + cs.borderTopWidth }
  })
  return { rows, buttons, cards }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const routes = process.argv.slice(2)
  let lowCount = 0

  for (const route of routes) {
    const page = await ctx.newPage()
    await installApi(page, {})
    await page.addInitScript(
      `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
    )
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 30000 })
    await sleep(1200)
    const { rows, buttons, cards } = await page.evaluate(PROBE)
    console.log(`\n===== ${route} =====`)
    for (const r of rows) {
      const flag = r.contrast !== null && r.contrast < 2.5 ? '  <== 低对比' : ''
      if (flag) lowCount++
      console.log(
        `${String(r.contrast ?? '-').padStart(5)} | ${r.size.padStart(6)} ${r.weight} | ${r.color} on ${r.bg} | y=${String(r.y).padStart(4)} | ${r.text}${flag}`,
      )
    }
    console.log(`  --- 大按钮（h>=40）---`)
    for (const b of buttons) {
      console.log(`  ${b.h}px r=${b.radius} ${b.size}/${b.weight} bg=${b.bg} y=${b.y} | ${b.text}`)
    }
    console.log(`  --- 卡片 ---`)
    for (const c of cards) {
      console.log(`  ${c.slot} pad=${c.p} r=${c.radius} border=${c.border} shadow=${c.shadow}`)
    }
    await page.close()
  }
  await browser.close()
  console.log(`\n>>> 低对比条目合计: ${lowCount} ${lowCount === 0 ? '✔ 零低对比' : '✘'}`)
  process.exit(lowCount === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
