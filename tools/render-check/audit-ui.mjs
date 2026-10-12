/**
 * audit-ui.mjs — 只读界面审计（不改 frontend/src 任何代码）
 *
 * 目的：把「首页 vs 其它页」的观感差距变成可比较的数字与截图。
 * 用法（先起前端 dev :5173）：
 *   RC_BASE_URL=http://localhost:5173 node tools/render-check/audit-ui.mjs
 *
 * 产物：
 *   tools/render-check/audit/desktop-<name>.png   （1440x900，首屏，不 fullPage）
 *   tools/render-check/audit/mobile-<name>.png    （390x844，首屏）
 *   tools/render-check/audit/metrics.json          （每个路由的实测数据）
 *
 * 说明：API mock 直接复用 regression.mjs 的 installApi（同一份契约，避免第二套假数据）。
 * 截图是「首屏」而不是 fullPage —— 要看的正是首屏信息密度与留白。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'audit')

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const TOKEN_STORAGE_KEY = 'ai_job_helper:token'
const INTERVIEW_ID_STORAGE_KEY = 'ai_job_helper:interview_id'
const TEST_TOKEN = 'rc.mock.jwt.token'
const SESSION_ID = 'b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
const TASK_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70'

const TOKEN_INIT = `window.localStorage.setItem(${JSON.stringify(TOKEN_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(TEST_TOKEN)}));`
const SESSION_INIT = `window.sessionStorage.setItem(${JSON.stringify(INTERVIEW_ID_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(SESSION_ID)}));`

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'chat', path: '/chat' },
  { name: 'task-list', path: '/task' },
  { name: 'task-detail', path: `/task/${TASK_ID}` },
  { name: 'daily', path: '/daily' },
  { name: 'profile', path: '/profile' },
  { name: 'resume', path: '/resume' },
  { name: 'interview-select', path: '/interview' },
  { name: 'interview-prepare', path: '/interview/prepare' },
  { name: 'interview-session', path: '/interview/session', session: true },
  { name: 'interview-review', path: `/interview/review/${SESSION_ID}` },
  { name: 'report', path: '/report' },
  { name: 'test-intro', path: '/test/intro' },
  { name: 'test-question', path: '/test/question' },
  { name: 'test-result', path: '/test/result' },
  { name: 'login', path: '/login', noToken: true },
  { name: 'register', path: '/register', noToken: true },
  { name: '404', path: '/this-route-does-not-exist' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 页面实测：只量"能被设计系统约束的东西"。
 * - 卡片：所有「白底 + 圆角」的块，统计圆角/阴影/内边距的种类数 —— 种类越多 = 越不像一个系统
 * - 字号：正文区所有可见文字的 font-size 分布
 * - 关键色：主按钮、强调色的实际取值
 * - 首屏：主内容第一块相对视口顶部的位置、页面总高
 */
const MEASURE = `(() => {
  const cards = [...document.querySelectorAll('div,section,article,li')].filter((el) => {
    const cs = getComputedStyle(el)
    const bg = cs.backgroundColor
    const isWhite = bg === 'rgb(255, 255, 255)'
    const r = el.getBoundingClientRect()
    if (!isWhite || r.width < 180 || r.height < 60) return false
    // 只统计"最外层"的卡片：父节点不是同色白底
    const p = el.parentElement
    if (p && getComputedStyle(p).backgroundColor === 'rgb(255, 255, 255)') return false
    return true
  })
  const summarize = (arr) => {
    const m = new Map()
    for (const v of arr) m.set(v, (m.get(v) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }))
  }
  const cardInfo = cards.map((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return {
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow === 'none' ? 'none' : cs.boxShadow.slice(0, 70),
      padX: cs.paddingLeft,
      padY: cs.paddingTop,
      w: Math.round(r.width),
      h: Math.round(r.height),
      top: Math.round(r.top + window.scrollY),
      tinted: cs.backgroundColor !== 'rgb(255, 255, 255)',
    }
  })

  // 正文区（#root 里非侧栏内容）的可见文字
  const main = document.querySelector('main') ?? document.body
  const texts = [...main.querySelectorAll('h1,h2,h3,h4,p,span,button,a,label,li,dt,dd')].filter((el) => {
    if (!el.textContent || !el.textContent.trim()) return false
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4) return false
    if (el.children.length && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false
    return true
  })
  const fontSizes = summarize(texts.map((el) => getComputedStyle(el).fontSize))
  const weights = summarize(texts.map((el) => getComputedStyle(el).fontWeight))
  const colors = summarize(texts.map((el) => getComputedStyle(el).color))
  const families = summarize(texts.map((el) => getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '')))

  // 主按钮（深色实心）实际尺寸
  const solid = [...main.querySelectorAll('button,a')].map((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return { bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, h: Math.round(r.height), px: cs.paddingLeft, fs: cs.fontSize, fw: cs.fontWeight, text: (el.textContent || '').trim().slice(0, 18) }
  }).filter((x) => x.bg === 'rgb(9, 20, 38)' || x.bg === 'rgb(155, 69, 0)' || x.bg === 'rgb(30, 41, 59)')

  // 首屏信息：第一块卡片顶部 / 主标题字号 / 页面总高
  const h1 = main.querySelector('h1')
  const firstCard = cardInfo.slice().sort((a, b) => a.top - b.top)[0] ?? null
  const mainBox = main.getBoundingClientRect()

  return {
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    mainTop: Math.round(mainBox.top),
    h1Size: h1 ? getComputedStyle(h1).fontSize : null,
    h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
    h1Text: h1 ? h1.textContent.trim() : null,
    h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    firstCardTop: firstCard ? firstCard.top : null,
    cardCount: cardInfo.length,
    cardRadius: summarize(cardInfo.map((c) => c.radius)),
    cardShadow: summarize(cardInfo.map((c) => c.shadow)),
    cardPadX: summarize(cardInfo.map((c) => c.padX)),
    cardPadY: summarize(cardInfo.map((c) => c.padY)),
    cardTops: cardInfo.map((c) => c.top).slice(0, 8),
    fontSizes,
    weights,
    topColors: colors.slice(0, 6),
    families,
    solidButtons: solid,
  }
})()`

async function main() {
  await mkdir(OUT, { recursive: true })
  const out = { baseUrl: BASE_URL, startedAt: new Date().toISOString(), routes: [] }

  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
  })

  for (const view of [
    { key: 'desktop', width: 1440, height: 900 },
    { key: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      locale: 'zh-CN',
      deviceScaleFactor: 1,
    })
    for (const r of ROUTES) {
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
      await installApi(page, {})
      try {
        const init = (r.noToken ? '' : TOKEN_INIT) + (r.session ? SESSION_INIT : '')
        if (init) await page.addInitScript(init)
        await page.goto(BASE_URL + r.path, { waitUntil: 'networkidle', timeout: 25000 })
        await sleep(900)
        await page.screenshot({ path: path.join(OUT, `${view.key}-${r.name}.png`) })
        if (view.key === 'desktop') {
          const m = await page.evaluate(MEASURE)
          out.routes.push({ name: r.name, path: r.path, url: new URL(page.url()).pathname, errors, ...m })
        }
      } catch (err) {
        out.routes.push({ name: r.name, path: r.path, error: String(err.message ?? err) })
      } finally {
        await page.close()
      }
    }
    await context.close()
  }

  await browser.close()
  await writeFile(path.join(OUT, 'metrics.json'), JSON.stringify(out, null, 2), 'utf8')
  console.log(`audit done: ${out.routes.length} routes -> ${OUT}`)
  for (const r of out.routes) {
    console.log(
      `${r.name.padEnd(18)} cards=${String(r.cardCount ?? '-').padStart(2)} h1=${r.h1Size ?? '-'} firstCardTop=${r.firstCardTop ?? '-'} scroll=${r.scrollHeight ?? '-'} err=${(r.errors ?? []).length}`,
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
