/**
 * probe-a6.mjs — A6（模拟面试四页）专用取证：**只读，不改 frontend/src**。
 *
 * 解决两件事：
 *  1. `/interview/session` 的内容列到底多宽（验收线：1440px 下 ≥640px，不再是一条 448px 窄栏）；
 *  2. 面试进行中顶部信息条的 DOM 契约是否还在（「第 x / y 题」+ 可选的「 · 追问 n/2」、
 *     进度条填充宽度、主按钮几何）—— regression.mjs 的 N2 断言依赖这些文本。
 *  3. 沉浸式外壳（不套 PageShell，probe.mjs 的 `main p/span/...` 选择器覆盖不到）
 *     的逐条文字对比度：信息条、题目、字数、跳过、主按钮（禁用/启用两态）。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe-a6.mjs
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
const INTERVIEW_KEY = 'ai_job_helper:interview_id'
const SESSION_ID = 'b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] } }
  const lumRgb = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const white = { r: 255, g: 255, b: 255, a: 1 }
  /* 把带 alpha 的层逐层压到祖先实底上，得到真正"眼睛看到的"前景/背景 */
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 })
  const bgRgbOf = (el) => {
    let cur = { ...white }
    const chain = []
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) chain.push(n)
    for (const n of chain.reverse()) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) cur = over(c, cur)
    }
    return cur
  }
  const ratio = (a, b) => { if (a === null || b === null) return null; const hi = Math.max(a, b), lo = Math.min(a, b); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 }
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) } }
  const main = document.querySelector('main')
  const blank = document.querySelector('[data-blank-width]')
  const container = main?.firstElementChild?.firstElementChild ?? null
  const counter = (document.body.innerText.match(/第\\s*\\d+\\s*\\/\\s*\\d+\\s*题(\\s*·\\s*追问\\s*\\d+\\/2)?/) ?? [null])[0]
  const bar = document.querySelector('.bg-secondary')
  const cta = [...document.querySelectorAll('button')].find((b) => /提交并继续|回答追问|提交中/.test(b.textContent || ''))
    ?? [...document.querySelectorAll('button')].find((b) => /开始面试|先勾选上面的确认项/.test(b.textContent || ''))
  const ctaCs = cta ? getComputedStyle(cta) : null
  const h1 = document.querySelector('main h1')
  const h1Cs = h1 ? getComputedStyle(h1) : null
  /* 沉浸式外壳里的每一段文字（叶子元素 + 只含 svg 的按钮），逐条算前景/背景对比度 */
  const texts = [...document.querySelectorAll('main p, main span, main h1, main button')]
    .filter((el) => el.textContent && el.textContent.trim().length > 1 && ![...el.children].some((c) => c.tagName.toLowerCase() !== 'svg'))
    .map((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const bg = bgRgbOf(el)
      let fg = parse(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 }
      /* 祖先上的 opacity（如按钮 disabled:opacity-50）会整体压淡：并到前景的 alpha 上 */
      let op = 1
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity || '1')
      fg = { ...fg, a: fg.a * op }
      const eff = over(fg, bg)
      return {
        text: el.textContent.trim().slice(0, 28),
        tag: el.tagName.toLowerCase(),
        disabled: el.disabled === true,
        size: cs.fontSize, weight: cs.fontWeight,
        color: cs.color, bg: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
        effectiveFg: 'rgb(' + Math.round(eff.r) + ', ' + Math.round(eff.g) + ', ' + Math.round(eff.b) + ')',
        opacity: Math.round(op * 100) / 100,
        contrast: ratio(lumRgb(eff), lumRgb(bg)),
        w: Math.round(r.width), h: Math.round(r.height),
      }
    })
    .filter((x) => x.w > 2 && x.h > 2)
  return {
    viewport: { w: innerWidth, h: innerHeight },
    blankWidthMode: blank?.getAttribute('data-blank-width') ?? null,
    contentColumn: box(container),
    counterRowText: counter,
    progressFillWidth: bar ? getComputedStyle(bar).width : null,
    progressTrackBg: bar ? getComputedStyle(bar.parentElement).backgroundColor : null,
    questionText: { tag: h1?.tagName ?? null, size: h1Cs?.fontSize ?? null, weight: h1Cs?.fontWeight ?? null, color: h1Cs?.color ?? null },
    mainCta: cta ? { ...box(cta), size: ctaCs.fontSize, weight: ctaCs.fontWeight, radius: ctaCs.borderRadius, bg: ctaCs.backgroundColor, disabled: cta.disabled } : null,
    buttonLabels: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean),
    texts,
  }
})()`

async function run(page, json) {
  const out = await page.evaluate(PROBE)
  console.log(json ? JSON.stringify(out, null, 2) : '')
  if (!json) {
    console.log(
      `  [几何] data-blank-width=${out.blankWidthMode} 内容列=${out.contentColumn?.w}px | 题干 ${out.questionText?.tag}/${out.questionText?.size}/${out.questionText?.weight} | 主 CTA ${out.mainCta ? `${out.mainCta.w}x${out.mainCta.h} 字 ${out.mainCta.size}/${out.mainCta.weight} 圆角 ${out.mainCta.radius} bg ${out.mainCta.bg}${out.mainCta.disabled ? ' disabled' : ''}` : '（本页无）'} | 进度条填充 ${out.progressFillWidth ?? '（本页无）'}`,
    )
    console.log('  ---- 逐条文字对比度（<2.5 = 低对比） ----')
    for (const t of out.texts) {
      const flag = t.contrast !== null && t.contrast < 2.5 ? '  <== 低对比' : ''
      console.log(
        `  ${String(t.contrast ?? '-').padStart(5)} | ${t.size.padStart(6)} ${t.weight} | opacity ${t.opacity}${t.disabled ? ' disabled' : ''} | ${t.color} on ${t.bg} | ${t.text}${flag}`,
      )
    }
    const lo = out.texts.filter((t) => t.contrast !== null && t.contrast < 2.5)
    console.log(`  ---- 低对比条数: ${lo.length} / ${out.texts.length} ----`)
  }
  return out
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const json = process.argv.includes('--json')

  const seed = (page) =>
    page.addInitScript(
      `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));` +
        `window.sessionStorage.setItem(${JSON.stringify(INTERVIEW_KEY)}, JSON.stringify(${JSON.stringify(SESSION_ID)}));`,
    )

  /* ① 有场次：空答案（主按钮禁用态） */
  const empty = await ctx.newPage()
  await installApi(empty, {})
  await seed(empty)
  await empty.goto(BASE_URL + '/interview/session', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1500)
  console.log('===== /interview/session（有场次 · 未输入答案 → 主按钮禁用态）=====')
  await run(empty, json)

  /* ② 有场次：输入答案（主按钮启用态，唯一实心 CTA） */
  const filled = await ctx.newPage()
  await installApi(filled, {})
  await seed(filled)
  await filled.goto(BASE_URL + '/interview/session', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1500)
  await filled.locator('textarea').first().fill('我先介绍一下自己的项目经历。')
  await sleep(300)
  console.log('\n===== /interview/session（有场次 · 已输入答案 → 主按钮启用态）=====')
  await run(filled, json)

  /* ③ 没有场次：空态（BlankLayout 仍是全宽，EmptyState 自己收窄） */
  const none = await ctx.newPage()
  await installApi(none, {})
  await none.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await none.goto(BASE_URL + '/interview/session', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  console.log('\n===== /interview/session（无场次 → EmptyState）=====')
  await run(none, json)

  /* ④ /interview/prepare：三项全勾选（主按钮可用态）——勾选圈的实心绿 + 反白勾见 texts */
  const prepare = await ctx.newPage()
  await installApi(prepare, {})
  await prepare.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await prepare.goto(BASE_URL + '/interview/prepare', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1000)
  console.log('\n===== /interview/prepare（未勾选 → 主按钮禁用态；再全勾选）=====')
  await run(prepare, json)
  for (const name of ['麦克风可用', '网络稳定', '环境安静']) {
    await prepare.getByRole('button', { name: new RegExp(name) }).click()
  }
  await sleep(400)
  const prepareFilled = await run(prepare, json)
  console.log(`  三项全勾选后主按钮: ${JSON.stringify(prepareFilled.mainCta)}`)

  /* ⑤ /interview：填了岗位 + 默认选中项（选中态可读性） */
  const select = await ctx.newPage()
  await installApi(select, {})
  await select.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await select.goto(BASE_URL + '/interview', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1000)
  await select.locator('#target_job').fill('鸿蒙客户端开发工程师')
  await sleep(300)
  console.log('\n===== /interview（已填岗位 · 默认选中「小测试」+「HR 面」）=====')
  await run(select, json)

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
