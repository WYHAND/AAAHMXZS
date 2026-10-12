/**
 * a7-print.mjs — A7 专用：用 print 媒体模拟打印两份页面，并顺带量一下页面高度。
 *
 * 用法：
 *   RC_BASE_URL=http://localhost:5199 node tools/render-check/a7-print.mjs
 *   （加 --preview 时用 resumeMine='saved' 让 /resume 进展示态；加 --measure 只量高度不截图）
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
const INIT = `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const argv = process.argv.slice(2)
const preview = argv.includes('--preview')
const measureOnly = argv.includes('--measure')
const outDir = path.join(__dirname, 'audit', 'round1')

/** 打印后仍在页面上、且是"导航/按钮/输入框"的东西（应当为 0） */
const PRINT_LEFTOVERS = `(() => {
  const vis = (el) => {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return false
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const count = (sel) => [...document.querySelectorAll(sel)].filter(vis).length
  const sheet = document.querySelector('.resume-sheet')
  const line = document.querySelector('.resume-section-title span')
  return {
    nav: count('nav'), aside: count('aside'), button: count('button'),
    input: count('input'), textarea: count('textarea'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    sheetBg: sheet ? getComputedStyle(sheet).backgroundColor : null,
    sheetColor: sheet ? getComputedStyle(sheet).color : null,
    sheetBorder: sheet ? getComputedStyle(sheet).borderTopWidth : null,
    sectionLineBg: line ? getComputedStyle(line).backgroundColor : null,
    sectionLineH: line ? getComputedStyle(line).height : null,
  }
})()`

/** 页面高度 + 字号分布（衡量 14px 数字用 font-numeric / 12px 表达层级这类问题） */
const MEASURE = `(() => {
  const main = document.querySelector('main') ?? document.body
  const h1 = document.querySelector('h1')
  const sizes = {}
  for (const el of main.querySelectorAll('p,span,li,h1,h2,h3,label,button')) {
    if (!el.textContent || !el.textContent.trim() || el.children.length) continue
    const px = getComputedStyle(el).fontSize
    sizes[px] = (sizes[px] ?? 0) + 1
  }
  const cards = [...main.querySelectorAll('div')].filter((el) => {
    const cs = getComputedStyle(el)
    return cs.backgroundColor === 'rgb(255, 255, 255)' && el.getBoundingClientRect().width > 300
  }).map((el) => {
    const cs = getComputedStyle(el)
    return cs.padding + ' r=' + cs.borderTopLeftRadius
  })
  const cardPads = {}
  for (const c of cards) cardPads[c] = (cardPads[c] ?? 0) + 1
  return {
    docH: Math.round(document.documentElement.scrollHeight),
    mainH: Math.round(main.getBoundingClientRect().height),
    h1: h1 ? getComputedStyle(h1).fontSize + '/' + getComputedStyle(h1).fontWeight : null,
    sizes, cardCount: cards.length, cardPads,
  }
})()`

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })

  for (const route of ['/resume', '/report']) {
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
    await installApi(page, preview ? { resumeMine: 'saved' } : {})
    await page.addInitScript(INIT)
    await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(1600)

    const m = await page.evaluate(MEASURE)
    console.log(`\n===== ${route}${preview ? ' (展示态)' : ''} =====`)
    console.log(`docH=${m.docH}px mainH=${m.mainH}px h1=${m.h1} 白卡=${m.cardCount}`)
    console.log('字号分布: ' + Object.entries(m.sizes).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([k, v]) => `${k}×${v}`).join('  '))
    console.log('卡片内边距: ' + Object.entries(m.cardPads).map(([k, v]) => `${k}×${v}`).join(' | '))
    if (errors.length) console.log('pageerrors=' + errors.length + '\n' + errors.join('\n'))
    if (measureOnly) {
      await page.close()
      continue
    }

    /* /report：顺带把「看分数明细」展开拍一张，确认三条维度 + 相比基线的 +x 都还在 */
    if (route === '/report') {
      const trigger = page.getByRole('button', { name: /看分数明细/ })
      if (await trigger.count()) {
        await trigger.first().click()
        await sleep(600)
        await page.screenshot({
          path: path.join(outDir, 'a7-report-expanded.png'),
          fullPage: true,
        })
        console.log('print shot -> audit/round1/a7-report-expanded.png （分数明细展开态）')
      }
    }

    await page.emulateMedia({ media: 'print' })
    await sleep(400)
    const left = await page.evaluate(PRINT_LEFTOVERS)
    console.log('打印态残留: ' + JSON.stringify(left))
    const name = route.replace(/^\//, '')
    await page.screenshot({ path: path.join(outDir, `a7-${name}-print.png`), fullPage: true })
    console.log(`print shot -> audit/round1/a7-${name}-print.png`)
    await page.close()
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
