/**
 * radar-lines-probe.mjs — 画像雷达「线条」探针（只读，不改代码）。
 *
 * 干什么：
 *   1. 打开 /profile（mock API），把雷达卡里**每一个 SVG 元素**列出来：
 *      tagName + class + computed stroke / strokeWidth / opacity / fill，
 *      并算出该描边色对卡片底色 #ffffff 的 WCAG 对比度。
 *      目的：搞清楚哪条线是谁画的（PolarGrid 的环与辐条 / PolarAngleAxis 的 axisLine /
 *      最外圈六边形来自谁）—— 不猜 recharts 语义，以实测 DOM 为准。
 *   2. 顺带量「雷达卡底部死白」：卡片底边 − 卡内最后一个内容元素底边（1440 / 1200）。
 *
 * 用法：
 *   RC_BASE_URL=http://localhost:5199 node tools/render-check/radar-lines-probe.mjs [--json]
 *
 * 写法照抄 shot.mjs / audit-mock.mjs：installApi(page, {}) + addInitScript 写 token。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const asJson = process.argv.includes('--json')
/** 输出文件名前缀（RC_TAG=before- 就出 before-profile-1440.png），用来拍"改前"基线 */
const TAG = process.env.RC_TAG ?? ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------- 对比度工具 */

/** computed color（rgb()/rgba()）-> 相对亮度；解析不了返回 null */
function luminance(color) {
  const m = String(color).match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const [r, g, b] = m[1].split(',').map((x) => parseFloat(x))
  const lin = (c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** 描边色 vs #ffffff 的 WCAG 对比度；带 alpha 的先按 alpha 混到白底上（实测值才等于肉眼看到的） */
function contrastVsWhite(color) {
  const m = String(color).match(/rgba?\(([^)]+)\)/)
  if (!m) return '—'
  const parts = m[1].split(',').map((x) => parseFloat(x))
  if (parts.length === 4 && parts[3] < 1) {
    const a = parts[3]
    return contrastVsWhite(`rgb(${parts[0] * a + 255 * (1 - a)},${parts[1] * a + 255 * (1 - a)},${parts[2] * a + 255 * (1 - a)})`)
  }
  const l = luminance(color)
  if (l == null) return '—'
  return ((1.05) / (l + 0.05)).toFixed(2) + ':1'
}

/* ------------------------------------------------------------------- 页面 */

/** 在页面里跑：把雷达卡内所有 SVG 元素的关键 computed 值抓出来 */
const DUMP_SVG = () => {
  const root = [...document.querySelectorAll('[aria-label^="画像雷达"]')].pop()
  if (!root) return { error: '找不到 [aria-label^="画像雷达"]' }
  const card = root.closest('[data-slot="panel"]')
  const svg = root.querySelector('svg')
  if (!svg) return { error: '雷达容器里没有 svg（可能落在空态）' }
  const all = Array.from(svg.querySelectorAll('*'))
  const rows = all.map((el, i) => {
    const cs = getComputedStyle(el)
    const isLine = el.tagName.toLowerCase() === 'line'
    const geom = isLine
      ? `x1=${+el.getAttribute('x1')} y1=${+el.getAttribute('y1')} x2=${+el.getAttribute('x2')} y2=${+el.getAttribute('y2')}`
      : el.tagName.toLowerCase() === 'path'
        ? `d=${(el.getAttribute('d') ?? '').slice(0, 120)}`
        : el.tagName.toLowerCase() === 'polygon'
          ? `points=${(el.getAttribute('points') ?? '').slice(0, 120)}`
          : el.tagName.toLowerCase() === 'text'
            ? `text="${el.textContent}" x=${el.getAttribute('x')} y=${el.getAttribute('y')}`
            : ''
    return {
      i,
      tag: el.tagName.toLowerCase(),
      cls: el.getAttribute('class') ?? '',
      stroke: cs.stroke,
      strokeWidth: cs.strokeWidth,
      opacity: cs.opacity,
      fill: cs.fill,
      fillOpacity: cs.fillOpacity,
      geom,
    }
  })
  return {
    viewBox: svg.getAttribute('viewBox'),
    rootBox: { w: root.clientWidth, h: root.clientHeight },
    cardTag: card ? card.getAttribute('data-slot') : null,
    rows,
  }
}

/** 在页面里跑：雷达卡底部死白 = 卡片底边 − 卡内最后一个内容元素底边 */
const MEASURE_WHITE = () => {
  const root = [...document.querySelectorAll('[aria-label^="画像雷达"]')].pop()
  if (!root) return { error: '找不到雷达根' }
  const card = root.closest('[data-slot="panel"]')
  if (!card) return { error: '找不到雷达卡片 Panel' }
  const cardRect = card.getBoundingClientRect()
  const cardCs = getComputedStyle(card)
  // 卡内最后一个内容块 = ProfileRadar 的最外层 div（fill 模式下是 flex-1 那一层）
  const content = card.lastElementChild
  const contentRect = content.getBoundingClientRect()
  // 再往下钻到最后一个内容元素（说明文字 <p>），用来确认「死白」不是藏在文字下面
  const leaves = [...card.querySelectorAll('p')]
  const lastP = leaves.length ? leaves[leaves.length - 1].getBoundingClientRect() : null
  return {
    cardPaddingBottom: cardCs.paddingBottom,
    cardBottom: +cardRect.bottom.toFixed(2),
    contentBottom: +contentRect.bottom.toFixed(2),
    // 卡片 20px 内边距之内的死白（应为 20 = 就是 Panel 的 p-5）
    whiteInsidePadding: +(cardRect.bottom - contentRect.bottom).toFixed(2),
    // 内容块内部、最后一个文字元素之下的死白（应为 0）
    whiteBelowLastText: lastP ? +(contentRect.bottom - lastP.bottom).toFixed(2) : null,
    contentClass: content.className,
    cardHeight: +cardRect.height.toFixed(2),
    svgHeight: +root.querySelector('svg').getBoundingClientRect().height.toFixed(2),
  }
}

/** 在页面里跑：把页面上每个雷达（含首页 compact）的容器与卡片几何量出来 —— 用来证明 compact 没被改坏 */
const RADAR_GEOM = () => {
  const roots = [...document.querySelectorAll('[aria-label^="画像雷达"]')]
  return roots.map((root) => {
    const card = root.closest('[data-slot="panel"]')
    const r = root.getBoundingClientRect()
    return {
      aria: root.getAttribute('aria-label')?.slice(0, 24),
      rootW: +r.width.toFixed(1),
      rootH: +r.height.toFixed(1),
      rootClass: root.className,
      svgH: +root.querySelector('svg')?.getBoundingClientRect().height.toFixed(1),
      cardH: card ? +card.getBoundingClientRect().height.toFixed(1) : null,
    }
  })
}

/* --------------------------------------------------------------- 主流程 */

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const out = { baseUrl: BASE_URL, results: [] }
  const preview = path.join(__dirname, 'audit', 'preview')
  await mkdir(preview, { recursive: true })

  /** 跑一个视口：量底部死白 + 出整页截图 */
  const visit = async ({ name, route, width, height = 900, measure = false, dumpSvg = false, shot = true }) => {
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' })
    const page = await ctx.newPage()
    await installApi(page, {})
    await page.addInitScript(
      `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
    )
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(1800)
    const entry = { name, url: route, width }
    entry.radars = await page.evaluate(RADAR_GEOM)
    if (dumpSvg) {
      entry.theme = await page.evaluate(() => ({
        htmlClass: document.documentElement.className,
        outlineVariant: getComputedStyle(document.documentElement).getPropertyValue('--outline-variant').trim(),
        outline: getComputedStyle(document.documentElement).getPropertyValue('--outline').trim(),
      }))
      entry.svg = await page.evaluate(DUMP_SVG)
    }
    if (measure) entry.white = await page.evaluate(MEASURE_WHITE)
    if (shot) {
      const file = path.join(preview, `${TAG}${name}.png`)
      await page.screenshot({ path: file, fullPage: true })
      entry.shot = path.relative(process.cwd(), file)
      // 雷达卡特写（看线条层次用）
      const card = page.locator('[data-slot="panel"]', { has: page.locator('[aria-label^="画像雷达"]') }).first()
      if (await card.count()) {
        const cardFile = path.join(preview, `${TAG}${name}-radar.png`)
        await card.screenshot({ path: cardFile })
        entry.cardShot = path.relative(process.cwd(), cardFile)
      }
    }
    await ctx.close()
    out.results.push(entry)
    return entry
  }

  await visit({ name: 'profile-1440', route: '/profile', width: 1440, measure: true, dumpSvg: true })
  await visit({ name: 'profile-1200', route: '/profile', width: 1200, measure: true })
  await visit({ name: 'profile-390', route: '/profile', width: 390, height: 844, measure: true })
  await visit({ name: 'home-1440', route: '/', width: 1440 })

  await browser.close()

  const first = out.results.find((r) => r.svg)
  const dump = first.svg
  const theme = first.theme
  const payload = {
    ...out,
    svg: dump ? { ...dump, rows: dump.rows?.map((r) => ({ ...r, contrastVsWhite: contrastVsWhite(r.stroke) })) } : null,
  }
  await writeFile(
    path.join(__dirname, 'audit', 'radar-lines-probe.json'),
    JSON.stringify(payload, null, 2),
  ).catch(() => {})
  await writeFile(
    path.join(__dirname, 'audit', 'radar-lines-last.txt'),
    render(payload),
  ).catch(() => {})

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  if (dump?.error) console.log('SVG dump error:', dump.error)
  console.log(render(payload))
}

/** 文本报告（同时写进 audit/radar-lines-last.txt） */
function render(payload) {
  const lines = []
  const { theme, svg: dump, results } = payload
  const L = (s = '') => lines.push(s)
  if (theme) {
    L('# 主题 / token')
    L(`html.class = "${theme.htmlClass}"   (空 = .dark 未挂上，index.css 的暗色块是预置)`)
    L(`--outline = ${theme.outline}   --outline-variant = ${theme.outlineVariant}`)
  }
  if (dump && !dump.error) {
    L(`\n# 雷达卡内 SVG 元素（viewBox=${dump.viewBox}, 根 ${dump.rootBox?.w}x${dump.rootBox?.h}）`)
    L('idx | tag     | class                                              | stroke                   | sw    | op | fill        | 对比度(白卡) | 几何')
    for (const r of dump.rows ?? []) {
      L(
        [
          String(r.i).padStart(3),
          r.tag.padEnd(7),
          (r.cls || '-').slice(0, 50).padEnd(50),
          r.stroke.padEnd(24),
          r.strokeWidth.padEnd(5),
          r.opacity.padEnd(2),
          r.fill.slice(0, 11).padEnd(11),
          String(r.contrastVsWhite ?? contrastVsWhite(r.stroke)).padEnd(12),
          r.geom,
        ].join(' | '),
      )
    }
  }
  L('\n# 雷达几何（container / svg 高度；首页 compact 应恒为 h-56=224px）')
  for (const r of results ?? []) {
    if (r.radars?.length) L(`${r.name} (${r.width}px): ${JSON.stringify(r.radars)}`)
  }
  L('\n# 底部死白（卡片底边 − 卡内最后一个内容元素底边）')
  for (const r of results ?? []) {
    if (r.white) L(`${r.name} (${r.width}px): ${JSON.stringify(r.white)}`)
  }
  L('\n# 截图')
  for (const r of results ?? []) if (r.shot) L(`${r.name}: ${r.shot}`)
  for (const r of results ?? []) if (r.cardShot) L(`${r.name} (雷达卡特写): ${r.cardShot}`)
  return lines.join('\n') + '\n'
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
