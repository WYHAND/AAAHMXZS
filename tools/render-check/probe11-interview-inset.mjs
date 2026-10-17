/**
 * 两个预览方向的**结构体检**（不靠眼睛，靠 DOM 量测）：
 *   1. 卡内浅底块（panel-inset）的子块空隙 —— A 的右侧预览区是 flex-col + justify-between，
 *      如果被拉到整行高，这里会出现一个大洞（这正是原版的病，不能在预览里重演）；
 *   2. 非颜色选中指示器是否真的渲染出来了（实心墨点的盒子尺寸与非透明底色）；
 *   3. 文字元素是否互相压叠（以叶节点矩形求交，>4px 重叠才算）；
 *   4. 有没有元素横向溢出视口（1025px 下最容易被挤爆）。
 *
 * 用法：RC_BASE_URL=http://localhost:5173 node tools/render-check/probe11-interview-inset.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
/** 默认按用户日常窗口 1025px 验收（项目口径）；RC_WIDTH=1440 可复核宽屏 */
const VIEWPORT = { width: Number(process.env.RC_WIDTH ?? 1025), height: 900 }

const ROUTES = [
  { key: 'interview-select', route: '/interview' },
  { key: 'interview-prepare', route: '/interview/prepare' },
]

const CHECK = () => {
  const box = (el) => {
    const b = el.getBoundingClientRect()
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height }
  }

  // 1) 浅底块内部空隙
  const insets = [...document.querySelectorAll('[data-slot="panel-inset"]')].map((el) => {
    const kids = [...el.children].map(box).sort((a, b) => a.top - b.top)
    let maxGap = 0
    for (let i = 1; i < kids.length; i += 1) maxGap = Math.max(maxGap, kids[i].top - kids[i - 1].bottom)
    return { h: Math.round(box(el).h), kids: kids.length, maxGap: Math.round(maxGap) }
  })

  /*
   * 1b) **卡片内**相邻子块的最大空隙 —— 这是「不自然的空白」的量化值。
   * 原版 /interview 左卡在这里量到 139px（成因：grid 拉伸行高 + flex-1 把左卡拉到
   * 右列高度 + mt-auto 把 CTA 钉底）。改版后必须接近 0，超了就是这个病复发。
   */
  const panels = [...document.querySelectorAll('[data-slot="panel"]')].map((el) => {
    const kids = [...el.children].map((c) => ({ ...box(c), text: (c.textContent || '').trim().slice(0, 16) })).sort((a, b) => a.top - b.top)
    let maxGap = 0
    let gapAfter = ''
    for (let i = 1; i < kids.length; i += 1) {
      const gap = kids[i].top - kids[i - 1].bottom
      if (gap > maxGap) {
        maxGap = gap
        gapAfter = kids[i - 1].text
      }
    }
    return { w: Math.round(box(el).w), h: Math.round(box(el).h), kids: kids.length, maxGap: Math.round(maxGap), gapAfter }
  })

  // 2) 非颜色指示器：选中行里那个 8px 实心点
  const pressed = [...document.querySelectorAll('[aria-pressed="true"]')]
  const dots = pressed.map((el) => {
    const spans = [...el.querySelectorAll('span')]
    const filled = spans.filter((s) => {
      const cs = getComputedStyle(s)
      const b = s.getBoundingClientRect()
      return b.width > 0 && b.width <= 12 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
    })
    return {
      label: (el.textContent || '').trim().slice(0, 8),
      dotCount: filled.length,
      dotSize: filled[0] ? Math.round(filled[0].getBoundingClientRect().width) : 0,
    }
  })

  // 3) 文字压叠：取有直接文本的叶节点，两两求交
  /** 元素是否位于 sticky/fixed 容器内（小屏底部操作带就是 sticky，会盖住滚动中的正文） */
  const inSticky = (el) => {
    let n = el
    while (n && n !== document.body) {
      const p = getComputedStyle(n).position
      if (p === 'sticky' || p === 'fixed') return true
      n = n.parentElement
    }
    return false
  }

  const leaves = [...document.querySelectorAll('main p, main h2, main span, main dt, main dd, main label')]
    .filter((el) => {
      const t = (el.textContent || '').trim()
      if (!t || el.children.length > 0) return false
      const b = el.getBoundingClientRect()
      return b.width > 0 && b.height > 0
    })
    .map((el) => ({ text: (el.textContent || '').trim().slice(0, 14), sticky: inSticky(el), ...box(el) }))

  const overlaps = []
  /*
   * sticky 遮盖单列一栏：底部操作带用 position:sticky 钉在视口底部，正文从它下面滚过去，
   * 因此"矩形相交"是**设计使然**，不是压叠 bug。把它混进 overlaps 会让这条指标天天报警，
   * 反而掩盖真问题；所以分开报，并且照样把证据打出来。
   */
  const stickyCoverage = []
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i]
      const b = leaves[j]
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (ox > 4 && oy > 4) {
        if (a.sticky || b.sticky) stickyCoverage.push(`${a.text} × ${b.text}`)
        else overlaps.push(`${a.text} × ${b.text}`)
      }
    }
  }

  // 4) 横向溢出
  const overflow = [...document.querySelectorAll('main *')]
    .map((el) => ({ el, b: el.getBoundingClientRect() }))
    .filter((r) => r.b.right > window.innerWidth + 1)
    .map((r) => `${r.el.tagName}.${String(r.el.className).slice(0, 40)} right=${Math.round(r.b.right)}`)

  /*
   * 5) dt / dd / label 的对比度 —— **补 probe.mjs 的盲区**。
   * probe.mjs:64 的选择器只有 `p, span, li, h1, h2, h3, button`，**不含 dt/dd/label**，
   * 所以新增的 `dt`（题量、出题依据）它一条都量不到 —— "零低对比"对这些元素是假阴性。
   * 这里按 WCAG 2.x 相对亮度算，并把前景/背景的 alpha 逐级合成（背景从 canvas 起算）。
   */
  const parseColor = (str) => {
    const m = String(str).match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(',').map((v) => parseFloat(v))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (fg, bg) => {
    const a = lum(fg)
    const b = lum(bg)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
  })
  const effectiveBg = (el) => {
    const layers = []
    let node = el
    while (node && node !== document.documentElement) {
      const c = parseColor(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) layers.push(c)
      node = node.parentElement
    }
    let out = { r: 251, g: 249, b: 246 } // 画布色作为基底
    for (let i = layers.length - 1; i >= 0; i -= 1) out = over(layers[i], out)
    return out
  }

  const contrastRows = [...document.querySelectorAll('main dt, main dd, main label')]
    .filter((el) => {
      const t = (el.textContent || '').trim()
      if (!t || el.children.length > 0) return false
      const b = el.getBoundingClientRect()
      return b.width > 0 && b.height > 0
    })
    .map((el) => {
      const cs = getComputedStyle(el)
      const bg = effectiveBg(el)
      const fgRaw = parseColor(cs.color)
      const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw
      return {
        tag: el.tagName,
        size: Math.round(parseFloat(cs.fontSize)),
        text: (el.textContent || '').trim().slice(0, 12),
        value: Math.round(ratio(fg, bg) * 100) / 100,
      }
    })
  const contrastMisses = contrastRows.filter((r) => r.value < 4.5)
  const contrastMin = contrastRows.length ? Math.min(...contrastRows.map((r) => r.value)) : null

  return {
    panels,
    insets,
    dots,
    overlaps: overlaps.slice(0, 8),
    overlapCount: overlaps.length,
    stickyCoverage: stickyCoverage.slice(0, 8),
    stickyCoverageCount: stickyCoverage.length,
    overflow: overflow.slice(0, 5),
    contrastRows,
    contrastMisses,
    contrastMin,
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  for (const target of ROUTES) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'zh-CN' })
    const page = await ctx.newPage()
    await installApi(page, {})
    await page.addInitScript(
      `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
    )
    await page.goto(BASE_URL + target.route, { waitUntil: 'networkidle', timeout: 25000 })
    await page.waitForTimeout(1500)
    const r = await page.evaluate(CHECK)

    console.log(`\n=== ${target.key} ===`)
    for (const p of r.panels) {
      console.log(
        `  卡片 w${p.w} h${p.h}｜子块 ${p.kids}｜**卡内最大空隙 ${p.maxGap}px**` +
          (p.gapAfter ? `（在「${p.gapAfter}」之后）` : ''),
      )
    }
    for (const i of r.insets) console.log(`  浅底块 h${i.h}｜子块 ${i.kids}｜内部最大空隙 ${i.maxGap}px`)
    for (const d of r.dots) console.log(`  选中「${d.label}」：实心点 ${d.dotCount} 个／直径 ${d.dotSize}px`)
    console.log(`  文字压叠：${r.overlapCount} 处${r.overlapCount ? ' → ' + r.overlaps.join(' | ') : ''}`)
    console.log(
      `  sticky 操作带遮盖正文（小屏预期行为）：${r.stickyCoverageCount} 处` +
        (r.stickyCoverageCount ? ' → ' + r.stickyCoverage.join(' | ') : ''),
    )
    console.log(`  横向溢出：${r.overflow.length} 处${r.overflow.length ? ' → ' + r.overflow.join(' | ') : ''}`)
    console.log(
      `  dt/dd/label 对比度（probe.mjs 量不到的那批）：${r.contrastRows.length} 条，最低 ${r.contrastMin}` +
        `，低于 4.5 的 ${r.contrastMisses.length} 条` +
        (r.contrastMisses.length
          ? ' → ' + r.contrastMisses.map((m) => `${m.tag} ${m.size}px 「${m.text}」 ${m.value}:1`).join(' | ')
          : ''),
    )
    await page.screenshot({
      path: path.join(__dirname, `audit/interview-1025-${target.key}.png`),
      fullPage: true,
    })
    await ctx.close()
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
