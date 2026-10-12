/**
 * a1-action-row.mjs —— A1 号子工具（只读）：拆开 /test/question 底部操作区的每一层高度。
 * 目的：弄明白按钮 y 为什么是 750 而不是基线 734 —— 到底是容器高度、操作区高度，还是里面某一列撑高了。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-action-row.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MEASURE = `(() => {
  const box = (e) => {
    const r = e.getBoundingClientRect()
    const c = getComputedStyle(e)
    return { y: Math.round(r.y), h: Math.round(r.height), fs: c.fontSize, lh: c.lineHeight, pt: c.paddingTop, pb: c.paddingBottom, gap: c.gap, cls: (typeof e.className === 'string' ? e.className : '').slice(0, 70) }
  }
  const row = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('border-t') && d.className.includes('shrink-0'))
  const hint = [...document.querySelectorAll('span')].find((s) => s.textContent.includes('答不上来没关系'))
  const col = hint ? hint.parentElement : null
  const prev = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '上一题')
  const skip = [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith('跳过'))
  const container = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('max-w-2xl'))
  const prog = container ? container.children[0] : null
  const qArea = container ? container.children[1] : null
  const card = document.querySelector('[data-slot="card"]')
  return {
    container: box(container),
    progressRow: box(prog),
    questionArea: box(qArea),
    actionRow: box(row),
    buttonCol: col ? box(col) : null,
    hint: hint ? box(hint) : null,
    prevBtn: box(prev),
    skipBtn: box(skip),
    card: box(card),
    docScrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
  }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + '/test/question', { waitUntil: 'networkidle', timeout: 30000 })
  await sleep(1200)
  const m = await page.evaluate(MEASURE)
  for (const [k, v] of Object.entries(m)) {
    if (v && typeof v === 'object') {
      console.log(`${k.padEnd(14)} y=${String(v.y).padStart(4)} h=${String(v.h).padStart(4)} fs=${v.fs ?? '-'} lh=${v.lh ?? '-'} pt=${v.pt ?? '-'} pb=${v.pb ?? '-'} gap=${v.gap ?? '-'} | ${v.cls ?? ''}`)
    } else {
      console.log(`${k.padEnd(14)} ${v}`)
    }
  }
  console.log(`\n底边核对：容器 y+h = ${m.container.y + m.container.h}，操作区底 = ${m.actionRow.y + m.actionRow.h}，视口 = ${m.innerH}`)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
