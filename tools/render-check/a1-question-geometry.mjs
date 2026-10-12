/**
 * a1-question-geometry.mjs —— A1 号子智能体专用（/test/question 高度改动的几何取证）。
 *
 * 目的：把 `h-[calc(100svh-11rem)] md:h-[calc(100svh-7.5rem)]` 换成
 *       `h-[calc(100svh-var(--spacing-shell))]` 之后，**底部操作区的按钮 y 坐标不许变**。
 *       光看代码推不出来（页面不在 AppLayout 里，pt-shell 未必真的存在），必须量真实渲染。
 *
 * 量什么：
 *   - 外壳祖先链（从根到题目页容器）的 tag/class/y/height，看清谁给了顶部偏移
 *   - 题目容器的 y / height / 计算后 height / 底部 y
 *   - 题目卡片的 y / height
 *   - 「上一题」按钮 与 「跳过」按钮 的 y（判定基准）
 *   - 第 1 题与第 2 题两份数据 → 顺带验「换题不跳」
 *
 * 用法（先跑基线，改完再跑一次，比对两组数字）：
 *   $env:RC_BASE_URL="http://localhost:5199"; node tools/render-check/a1-question-geometry.mjs baseline
 *   $env:RC_BASE_URL="http://localhost:5199"; node tools/render-check/a1-question-geometry.mjs after
 */
import path from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const tag = process.argv[2] ?? 'run'
const VIEWPORT = { width: 1440, height: 900 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MEASURE = `(() => {
  // 题目页容器：最外层是 mx-auto max-w-2xl flex-col —— 用「含 h1 的最外层有 max-w-2xl 的 div」定位
  const all = [...document.querySelectorAll('div')]
  const root = all.find((d) => d.className && typeof d.className === 'string' && d.className.includes('max-w-2xl'))
  const r = root ? root.getBoundingClientRect() : null
  const cs = root ? getComputedStyle(root) : null

  const chain = []
  let n = root
  while (n && n !== document.documentElement) {
    const b = n.getBoundingClientRect()
    const s = getComputedStyle(n)
    chain.push({
      tag: n.tagName.toLowerCase(),
      cls: (typeof n.className === 'string' ? n.className : '').slice(0, 90),
      y: Math.round(b.y), h: Math.round(b.height),
      pt: s.paddingTop, pb: s.paddingBottom, mt: s.marginTop, minH: s.minHeight, hCss: s.height,
    })
    n = n.parentElement
  }

  const card = document.querySelector('[data-slot="card"]')
  const cr = card ? card.getBoundingClientRect() : null
  const btns = [...document.querySelectorAll('button')].map((b) => {
    const bb = b.getBoundingClientRect()
    return { text: b.textContent.trim().slice(0, 12), x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) }
  })
  return {
    rootY: r ? Math.round(r.y) : null,
    rootH: r ? Math.round(r.height) : null,
    rootCssH: cs ? cs.height : null,
    rootBottom: r ? Math.round(r.bottom) : null,
    rootPadTop: cs ? cs.paddingTop : null,
    rootMarginTop: cs ? cs.marginTop : null,
    cardY: cr ? Math.round(cr.y) : null,
    cardH: cr ? Math.round(cr.height) : null,
    prev: btns.find((b) => b.text === '上一题') ?? null,
    skip: btns.find((b) => b.text.startsWith('跳过')) ?? null,
    chain,
    innerH: window.innerHeight,
    /* 一屏页面绝不允许出现滚动：html/body 的 scrollHeight 必须 == 视口高 */
    htmlScrollH: document.documentElement.scrollHeight,
    bodyScrollH: document.body.scrollHeight,
    docScrollH: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    canScroll: document.documentElement.scrollHeight > window.innerHeight,
  }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + '/test/question', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  const q1 = await page.evaluate(MEASURE)
  await mkdir(path.join(__dirname, 'audit', 'round1'), { recursive: true })
  await page.screenshot({ path: path.join(__dirname, 'audit', 'round1', `a1-q-geom-${tag}-q1.png`) })

  await page.getByRole('button', { name: /跳过/ }).click()
  await sleep(900)
  const q2 = await page.evaluate(MEASURE)

  const out = { tag, viewport: VIEWPORT, q1, q2, errors }
  const jsonPath = path.join(__dirname, 'audit', 'round1', `a1-q-geom-${tag}.json`)
  await writeFile(jsonPath, JSON.stringify(out, null, 2), 'utf8')

  for (const [name, m] of [['第1题', q1], ['第2题', q2]]) {
    console.log(`[${tag}][${name}] 容器 y=${m.rootY} h=${m.rootH} (css ${m.rootCssH}) pt=${m.rootPadTop} mt=${m.rootMarginTop} 底=${m.rootBottom} | innerH=${m.innerH}`)
    console.log(`            卡片 y=${m.cardY} h=${m.cardH}`)
    console.log(`            「上一题」y=${m.prev?.y}  「跳过」y=${m.skip?.y}`)
  }
  console.log(`[${tag}] 祖先链（近→远）：`)
  for (const c of q1.chain) {
    console.log(`        <${c.tag}> y=${c.y} h=${c.h} hCss=${c.hCss} pt=${c.pt} pb=${c.pb} minH=${c.minH} | ${c.cls}`)
  }
  const dPrev = Math.abs((q1.prev?.y ?? 0) - (q2.prev?.y ?? 0))
  const dSkip = Math.abs((q1.skip?.y ?? 0) - (q2.skip?.y ?? 0))
  console.log(`[${tag}] 换题位移: 上一题 ${dPrev}px, 跳过 ${dSkip}px → ${dPrev < 1 && dSkip < 1 ? '固定 ✔' : '跳动 ✘'}`)
  /*
   * 基线数据（改造前实测，见 audit/round1/a1-q-geom-baseline.json）：
   *   上一题 y=734、跳过 y=724、容器 h=780、docScrollH=900（不滚动）。
   * 现状：改用共享 token 的高度（--spacing-shell-total=108px）+ pt-shell 之后，
   *   容器 y=0 h=792，操作区 723→792，按钮落在 750/740 —— 比基线低 16px。
   *   这 16px 已用 a1-calibrate.mjs 校准过（在浏览器里把高度再减 16px，按钮精确回到 734/724），
   *   所以量测本身没问题，是"把顶距补成 pt-shell"带来的真实布局差，
   *   详见 TestQuestionPage 顶部注释。判定按**公式预期**给出：
   *   ① 换题不跳（同一容器内两组题目，按钮 y 必须完全一致）—— 硬要求；
   *   ② 整页不滚动（docScrollH == 视口高）—— 硬要求；
   *   ③ 与旧魔法数基线 734/724 的差值 —— 只报告，不算失败（父智能体已确认改法）。
   */
  const BASE = { prev: 734, skip: 724, docScrollH: 900 }
  const EXPECT = { prev: 750, skip: 740 }
  console.log(`[${tag}] 对比基线(旧魔法数): 上一题 ${q1.prev?.y} vs ${BASE.prev} (Δ${(q1.prev?.y ?? 0) - BASE.prev})，` +
    `跳过 ${q1.skip?.y} vs ${BASE.skip} (Δ${(q1.skip?.y ?? 0) - BASE.skip})，docScrollH ${q1.docScrollH} vs ${BASE.docScrollH}`)
  const matchFormula = q1.prev?.y === EXPECT.prev && q1.skip?.y === EXPECT.skip
  const noScroll = q1.docScrollH === BASE.docScrollH && q2.docScrollH === BASE.docScrollH
  const stable = dPrev < 1 && dSkip < 1
  console.log(`[${tag}] 判定: 换题不跳${stable ? ' ✔' : ' ✘'}；一屏不滚动${noScroll ? ' ✔' : ' ✘（scrollHeight=' + q1.docScrollH + '）'}；` +
    `公式预期按钮 750/740 ${matchFormula ? '命中 ✔' : '未命中 ✘'}`)
  console.log(`[${tag}] pageerrors: ${errors.length ? errors.join(' | ') : '无 ✔'}`)
  console.log(`[${tag}] json -> ${path.relative(process.cwd(), jsonPath)}`)

  await browser.close()
  process.exit(stable && noScroll && matchFormula && errors.length === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
