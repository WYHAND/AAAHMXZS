/**
 * r-verify.mjs —— R 号（「我的简历」页）本轮改动的一次性验证脚本（**只读，不改 frontend/src**）。
 *
 * 三件事，逐条对应验收清单：
 * 1. **1025px / 1024px 无横向溢出**：`document.documentElement.scrollWidth <= innerWidth`，
 *    并逐一检查页面里所有 `button` / `a` 的 `getBoundingClientRect().right <= innerWidth`（按钮不被裁切）；
 * 2. **打印态**：`page.emulateMedia({ media: 'print' })` 后截图，检查白底、正文 `#000`、
 *    导航/按钮/输入框都不出现、小节那条线还在（`.resume-section-title span` 高度不为 0）；
 * 3. **空数据场景**：用 `page.route` 覆写 `GET /resume/mine`，分别返回
 *    `data: null`（还没简历）与「只有姓名 / 学校」两种，确认文档里**不出现**
 *    「还没填，先空着」这类开发占位文案，且没内容的模块不占位。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/r-verify.mjs
 */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const OUT = path.join(__dirname, 'audit', 'round3')
const INIT = `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 覆写 GET /resume/mine：先把默认 mock 放过去，只有这一条我们自己答 */
async function overrideMine(page, payload) {
  await page.route('**/api/v1/resume/mine', async (route) => {
    const req = route.request()
    if (req.method().toUpperCase() !== 'GET') return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 0, message: 'success', data: payload }),
    })
  })
}

/** 横向溢出体检：文档宽度 + 所有 button/a 的右边界 */
const OVERFLOW_PROBE = `(() => {
  const doc = document.documentElement
  const inner = window.innerWidth
  const clipped = []
  for (const el of document.querySelectorAll('button, a')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right > inner + 0.5) {
      clipped.push({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 20), right: Math.round(r.right) })
    }
  }
  return {
    innerWidth: inner,
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowX: doc.scrollWidth - inner,
    clippedCount: clipped.length,
    clipped: clipped.slice(0, 10),
    gridCols: getComputedStyle(document.querySelector('.resume-page') || document.body).gridTemplateColumns,
    railTop: (() => {
      /* ⚠️ 不能写 aside[data-print="hide"]：外壳（AppLayout）自己就有一个 aside，
         选到它只会得到"侧栏在页面左边"（实测 railTop=44 的假失败）。
         导引栏靠它自己的标题「简历完整指引」定位。 */
      const rail = [...document.querySelectorAll('aside')].find((el) =>
        (el.textContent || '').includes('简历完整指引'),
      )
      const sheet = document.querySelector('.resume-sheet')
      if (!rail || !sheet) return null
      const r = rail.getBoundingClientRect()
      const s = sheet.getBoundingClientRect()
      return {
        railTop: Math.round(r.top),
        railLeft: Math.round(r.left),
        sheetTop: Math.round(s.top),
        sheetLeft: Math.round(s.left),
        sheetWidth: Math.round(s.width),
        sideBySide: Math.abs(r.top - s.top) < 60 && r.left > s.left,
      }
    })(),
  }
})()`

/** 打印体检：白底黑字、隐藏项、小节线 */
const PRINT_PROBE = `(() => {
  const sheet = document.querySelector('.resume-sheet')
  const line = document.querySelector('.resume-section-title span')
  const visible = (el) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
  const nav = document.querySelector('nav')
  const aside = document.querySelector('aside')
  const btn = document.querySelector('button')
  const input = document.querySelector('input')
  /* 页面页头（PageShell → PageHeader 的 <header>，含「我的简历」标题与描述、操作组） */
  const pageHeader = document.querySelector('[data-print="main"] > header')
  const decorativeBar = document.querySelector('.resume-sheet > span')
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const sheetBg = sheet ? getComputedStyle(sheet).backgroundColor : null
  // 正文色：取文档里第一个正文段落的 color
  const p = sheet ? sheet.querySelector('p') : null
  const span = sheet ? sheet.querySelector('h2, h3') : null
  return {
    hasSheet: Boolean(sheet),
    bodyBg, sheetBg,
    bodyColor: getComputedStyle(document.body).color,
    paragraphColor: p ? getComputedStyle(p).color : null,
    headingColor: span ? getComputedStyle(span).color : null,
    sectionLineHeight: line ? getComputedStyle(line).height : null,
    sectionLineVisible: visible(line),
    navVisible: visible(nav), asideVisible: visible(aside), buttonVisible: visible(btn), inputVisible: visible(input),
    pageHeaderVisible: visible(pageHeader),
    decorativeBarVisible: visible(decorativeBar),
    pageHeaderMarkers: (() => {
      const shell = document.querySelector('[data-print="main"]')
      const h = document.querySelector('[data-print="main"] > header')
      return {
        shellFound: Boolean(shell),
        candidates: [...document.querySelectorAll('header')].map((el) => ({
          directChildOfShell: el.parentElement === shell,
          dataPrint: el.getAttribute('data-print'),
          cls: String(el.className).slice(0, 26),
          text: (el.textContent || '').trim().slice(0, 14),
          display: getComputedStyle(el).display,
        })),
      }
    })(),
    sheetBorder: sheet ? getComputedStyle(sheet).borderTopWidth : null,
    sheetRadius: sheet ? getComputedStyle(sheet).borderRadius : null,
  }
})()`

/**
 * 全量对比度扫描（比 probe.mjs 更宽：它按选择器只收 p/span/li/h1/h2/h3/button 的叶子节点，
 * 这里把 main 里**每个有文字的叶子元素**都扫一遍，含 td/div/a/strong 等）。
 * 阈值按 WCAG：小字 4.5:1、大字（≥24px 或 ≥18.66px 且 ≥700）3:1。
 */
const CONTRAST_SCAN = `(() => {
  const scope = document.querySelector('main') ?? document.body
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const v = m[1].split(',').map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 } }
  const lumOf = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const over = (fg, bg) => ({ r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)), g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)), b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)), a: 1 })
  const bgOf = (el) => {
    let n = el, acc = null
    const chain = []
    while (n && n !== document.documentElement) { chain.push(n); n = n.parentElement }
    chain.push(document.documentElement)
    for (const node of chain) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) acc = acc ? over(acc, c) : c
      if (acc && acc.a === 1) return acc
    }
    return acc ?? { r: 255, g: 255, b: 255, a: 1 }
  }
  const ratio = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100 }
  const out = []
  for (const el of scope.querySelectorAll('*')) {
    if (el.children.length) continue
    const text = (el.textContent || '').trim()
    if (text.length < 2) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    if (parseFloat(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width < 3 || r.height < 3) continue
    /* 从元素往上累计 opacity，并按合成后的真实像素颜色比 */
    let op = 1, n = el
    while (n && n !== document.documentElement) { op *= parseFloat(getComputedStyle(n).opacity || '1'); n = n.parentElement }
    const fgc = parse(cs.color)
    if (!fgc) continue
    const bg = bgOf(el)
    const fg = over({ ...fgc, a: fgc.a * op }, bg)
    const px = parseFloat(cs.fontSize), wt = Number(cs.fontWeight) || 400
    const large = px >= 24 || (px >= 18.66 && wt >= 700)
    const limit = large ? 3 : 4.5
    const c = ratio(lumOf(fg), lumOf(bg))
    if (c < limit) {
      out.push({ text: text.slice(0, 26), size: cs.fontSize, weight: cs.fontWeight, color: cs.color, bg: 'rgb(' + bg.r + ', ' + bg.g + ', ' + bg.b + ')', contrast: c, limit })
    }
  }
  return out
})()`

/** 文档区文字（空数据场景用：看有没有开发占位文案） */const SHEET_TEXT = `(() => {
  const sheet = document.querySelector('.resume-sheet')
  const empty = document.querySelector('[data-slot="empty-state"]')
  return {
    sheetText: sheet ? sheet.innerText : null,
    sheetSectionTitles: sheet ? [...sheet.querySelectorAll('.resume-section-title h3')].map((h) => h.textContent.trim()) : null,
    sheetHeight: sheet ? Math.round(sheet.getBoundingClientRect().height) : 0,
    emptyText: empty ? empty.innerText : null,
    hasEmptyState: Boolean(empty),
  }
})()`

const PLACEHOLDER_WORDS = ['还没填', '先空着', '未填写', '这一节', '空模块']

function checkPlaceholders(textBlob, label) {
  const hits = PLACEHOLDER_WORDS.filter((w) => textBlob.includes(w))
  console.log(`  ${hits.length ? '✗ 出现占位文案' : '✓ 无开发占位文案'} [${label}] hits=${JSON.stringify(hits)}`)
  return hits.length === 0
}

const results = { pass: true }
const fail = (msg) => {
  results.pass = false
  console.log(`  ✗ ${msg}`)
}
const ok = (msg) => console.log(`  ✓ ${msg}`)

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })

  /* ---------------- A. 已保存简历：1440 / 1025 / 1024 三档宽度 ---------------- */
  for (const [width, height, file] of [
    [1440, 900, 'r-resume-1440-saved.png'],
    [1025, 800, 'r-resume-1025.png'],
    [1024, 800, 'r-resume-1024.png'],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
    await installApi(page, { resumeMine: 'saved' })
    await page.addInitScript(INIT)
    await page.goto(`${BASE_URL}/resume`, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(1200)
    const m = await page.evaluate(OVERFLOW_PROBE)
    await page.screenshot({ path: path.join(OUT, file) })
    console.log(`\n=== ${width}px（${file}）===`)
    console.log(`  innerWidth=${m.innerWidth} scrollWidth=${m.scrollWidth} 溢出=${m.overflowX}px grid=${m.gridCols}`)
    console.log(`  rail=${JSON.stringify(m.railTop)}`)
    if (m.overflowX > 0) fail(`${width}px 横向溢出 ${m.overflowX}px`)
    else ok(`${width}px 无横向溢出`)
    if (m.clippedCount > 0) fail(`${width}px 有 ${m.clippedCount} 个按钮/链接被裁切: ${JSON.stringify(m.clipped)}`)
    else ok(`${width}px 所有 button/a 都在视口内`)
    if (errors.length) fail(`${width}px 有 pageerror: ${errors.join(' | ')}`)
    else ok(`${width}px 零 pageerror`)
    if (width >= 1280) {
      if (m.railTop?.sideBySide) ok(`≥1280px：导引栏与文档并排（grid 两栏，sheet 宽 ${m.railTop.sheetWidth}）`)
      else fail(`≥1280px：导引栏没有并排，得到 ${JSON.stringify(m.railTop)}`)
    } else if (m.railTop) {
      if (!m.railTop.sideBySide && m.railTop.railTop > m.railTop.sheetTop)
        ok(`${width}px：导引栏在文档下方（单列，sheet 宽 ${m.railTop.sheetWidth}）`)
      else fail(`${width}px：导引栏位置不符合单列预期 ${JSON.stringify(m.railTop)}`)
    }
    await ctx.close()
  }

  /* ---------------- B. 打印态 ---------------- */
  {
    /* 视口直接给成"一张竖着的纸"（900×1400）：1440×900 的首屏只装得下文档上半截，
       要一眼看清整张纸就换个高视口。
       ⚠️ 不要等进页面之后再 setViewportSize：那时 `.resume-page` 会重排
       （xl 两栏 → 单列），实测打印截图会整块上移、（视觉上）从文档腰部开始。 */
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1400 }, locale: 'zh-CN' })
    const page = await ctx.newPage()
    await installApi(page, { resumeMine: 'saved' })
    await page.addInitScript(INIT)
    await page.goto(`${BASE_URL}/resume`, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(1200)
    await page.emulateMedia({ media: 'print' })
    await sleep(400)
    /*
     * 打印截图前把滚动位置归零：展示态进来时页面可能停在中间，拍出来会从文档腰部开始
     * （姓名与琥珀短条都在最上面，看不到就白拍）。
     * 实测 `window.scrollTo(0, 0)` **不管用** —— 外壳（AppLayout）的滚动容器是 `main`
     * 或某个内层 div，滚动位置不在 window 上。所以逐个把可滚动祖先都归零。
     */
    const scrollInfo = await page.evaluate(`(() => {
      const before = []
      window.scrollTo(0, 0)
      let n = document.querySelector('.resume-sheet')
      while (n && n !== document.documentElement) {
        if (n.scrollTop) before.push({ tag: n.tagName, cls: String(n.className).slice(0, 30), scrollTop: n.scrollTop })
        n.scrollTop = 0
        n = n.parentElement
      }
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
      return { reset: before, windowScrollY: window.scrollY }
    })()`)
    await sleep(300)
    const after = await page.evaluate(`(() => {
      const sheet = document.querySelector('.resume-sheet')
      const m = document.querySelector('main')
      return {
        sheetTop: sheet ? Math.round(sheet.getBoundingClientRect().top) : null,
        windowScrollY: window.scrollY,
        mainScrollTop: m ? m.scrollTop : null,
        bodyScrollTop: document.body.scrollTop,
      }
    })()`)
    console.log(`  滚动归零：改前 ${JSON.stringify(scrollInfo)} → 改后 ${JSON.stringify(after)}`)
    const m = await page.evaluate(PRINT_PROBE)
    await page.screenshot({ path: path.join(OUT, 'r-resume-print.png'), fullPage: true })
    /* 再拍一张"加高视口"的打印图：1440×900 的首屏只装得下文档上半截，
       要一眼看清整张纸（含顶上的琥珀短条与姓名）就用高视口整页拍。 */
    await page.setViewportSize({ width: 1440, height: 1800 })
    await sleep(400)
    await page.evaluate('window.scrollTo(document.documentElement.scrollHeight, 0); window.scrollTo(0, 0); document.documentElement.scrollTop = 0')
    await sleep(200)
    const geom = await page.evaluate(`(() => {
      const s = document.querySelector('.resume-sheet')
      const bar = s ? s.querySelector('span') : null
      return {
        scrollY: window.scrollY,
        htmlScrollTop: document.documentElement.scrollTop,
        sheetTop: s ? Math.round(s.getBoundingClientRect().top) : null,
        barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
        barBox: bar ? [Math.round(bar.getBoundingClientRect().width), Math.round(bar.getBoundingClientRect().height)] : null,
        mainOverflowY: getComputedStyle(document.querySelector('main') || document.body).overflowY,
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
      }
    })()`)
    console.log(`  加高视口后：${JSON.stringify(geom)}`)
    /* 纸顶那一段留给谁：把"打印态下页面顶部 240px 内所有可见块"列出来 ——
       本轮就是靠它证明页头（PageHeader 的 <header>）确实被隐藏，
       而不是"看着像被切掉了"。 */
    const above = await page.evaluate(`(() => {
      const out = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.height < 12 || r.width < 40) continue
        const cs = getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue
        if (r.top > 240) continue
        out.push({ tag: el.tagName, top: Math.round(r.top), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 14) })
        if (out.length > 12) break
      }
      return out
    })()`)
    console.log(`  纸顶 240px 内的可见块：${JSON.stringify(above)}`)
    await page.screenshot({ path: path.join(OUT, 'r-resume-print-tall.png'), fullPage: true })
    console.log(`\n=== 打印态（r-resume-print.png）===`)
    console.log(`  ${JSON.stringify(m, null, 2).split('\n').join('\n  ')}`)
    if (m.hasSheet) ok('打印时简历纸还在')
    else fail('打印时简历纸不见了')
    if (m.sheetBg === 'rgb(255, 255, 255)' || m.sheetBg === 'rgba(0, 0, 0, 0)') ok(`纸是白底（${m.sheetBg}）`)
    else fail(`纸不是白底：${m.sheetBg}`)
    console.log(`  页头标记：${JSON.stringify(m.pageHeaderMarkers)}（确认页头拿到 data-print='hide'、display:none，而简历纸自己的 header 仍是 flex）`)
    for (const [key, label] of [
      ['navVisible', '导航'],
      ['asideVisible', '导引栏'],
      ['buttonVisible', '按钮'],
      ['inputVisible', '输入框'],
      ['pageHeaderVisible', '页头（标题/描述）'],
      ['decorativeBarVisible', '文档标识短条'],
    ]) {
      if (m[key]) fail(`打印时${label}仍然可见`)
      else ok(`打印时${label}已隐藏`)
    }
    const blackish = (c) => c === 'rgb(0, 0, 0)'
    if (blackish(m.paragraphColor) && blackish(m.headingColor)) ok('文档正文/标题都是纯黑 #000')
    else fail(`正文色不是 #000：p=${m.paragraphColor} h=${m.headingColor}`)
    if (m.sectionLineVisible && parseFloat(m.sectionLineHeight) > 0)
      ok(`小节线还在（height=${m.sectionLineHeight}）`)
    else fail(`小节线没了：${JSON.stringify(m.sectionLineHeight)}`)
    await ctx.close()
  }

  /* ---------------- C. 空数据 / 只有姓名学校 ---------------- */
  const cases = [
    {
      name: 'data: null（还没简历）',
      payload: null,
      file: 'r-resume-empty-null.png',
      expectSheet: false,
    },
    {
      name: '只有姓名 / 学校',
      payload: {
        id: 'r-min',
        title: null,
        target_job: null,
        parsed_data: {
          basic: { name: '张三', school: 'XX 大学', grade: '', major: '', contact: '' },
          target: { direction: '', city: '' },
          education: [],
          skills: [],
          projects: [],
          campus: [],
          self_evaluation: '',
        },
        completeness: 0.1,
        updated_at: '2026-10-09T02:00:00',
      },
      file: 'r-resume-minimal.png',
      expectSheet: true,
      expectTitles: ['教育背景', '技能', '项目经历', '校园与实践经历', '自我评价'],
    },
  ]

  for (const c of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
    await installApi(page, { resumeMine: 'saved' })
    await overrideMine(page, c.payload)
    await page.addInitScript(INIT)
    await page.goto(`${BASE_URL}/resume`, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(1200)
    const m = await page.evaluate(SHEET_TEXT)
    await page.screenshot({ path: path.join(OUT, c.file) })
    console.log(`\n=== 空数据场景：${c.name}（${c.file}）===`)
    console.log(`  sheetText=${JSON.stringify(m.sheetText)}`)
    console.log(`  小节标题=${JSON.stringify(m.sheetSectionTitles)} sheetHeight=${m.sheetHeight}`)
    console.log(`  emptyState=${m.hasEmptyState} ${JSON.stringify(m.emptyText)}`)
    const blob = `${m.sheetText ?? ''}\n${m.emptyText ?? ''}`
    checkPlaceholders(blob, c.name)
    for (const w of PLACEHOLDER_WORDS) {
      if (blob.includes(w)) fail(`出现占位文案「${w}」`)
    }
    if (c.expectSheet) {
      if (m.sheetText) ok('有姓名/学校：文档照常渲染')
      else fail('有姓名/学校时文档没有渲染')
      for (const t of c.expectTitles ?? []) {
        if (m.sheetSectionTitles?.includes(t)) fail(`空模块「${t}」被渲染出来了（应当不占位）`)
      }
      ok('空模块没有被排进文档（小节标题列表见上）')
    } else {
      if (!m.sheetText) ok('data:null：没有印空纸')
      else fail('data:null 时仍然渲染了文档纸')
      if (m.hasEmptyState) ok('给了空态（含「去填写」入口）')
      else fail('没有给空态')
    }
    if (errors.length) fail(`有 pageerror: ${errors.join(' | ')}`)
    else ok('零 pageerror')
    await ctx.close()
  }

  /* ---------------- D. 已保存简历的对比度全量扫描（含文档与导引栏） ---------------- */
  {
    for (const [width, label] of [
      [1440, '1440px'],
      [1025, '1025px'],
    ]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN' })
      const page = await ctx.newPage()
      await installApi(page, { resumeMine: 'saved' })
      await page.addInitScript(INIT)
      await page.goto(`${BASE_URL}/resume`, { waitUntil: 'networkidle', timeout: 25000 })
      await sleep(1000)
      const low = await page.evaluate(CONTRAST_SCAN)
      /* 自证不是空扫：把被检查的文字节点数打出来（0 = 选择器写错了，不是"零问题"） */
      const scanned = await page.evaluate(
        `[...(document.querySelector('main') ?? document.body).querySelectorAll('*')].filter((el) => !el.children.length && (el.textContent || '').trim().length >= 2).length`,
      )
      console.log(`\n=== 对比度全量扫描 ${label}（/resume 展示态；扫描到 ${scanned} 个文字节点）===`)
      if (!scanned) fail('对比度扫描没有扫到任何文字节点（探针本身有问题，不能算通过）')
      if (!low.length) ok('零低对比文字（阈值：小字 4.5:1 / 大字 3:1）')
      else {
        for (const x of low) console.log(`  ✗ ${x.contrast}:1 (需 ${x.limit}) ${x.size}/${x.weight} ${x.color} on ${x.bg} — ${x.text}`)
        fail(`${label} 有 ${low.length} 处低对比文字`)
      }
      await ctx.close()
    }
  }

  /* ---------------- E. 纸面版式取证（把 print.css 当屏幕样式注入） ----------------
   * 为什么还要这一项：`emulateMedia({media:'print'})` 下截图虽然能看出"白底黑字、
   * 导航/按钮/输入框都没了、小节线还在"，但**页面上方总有一段被切掉**，而同一时刻
   * 探针读到的盒子（sheet top=0 / 各小块 top=0）与肉眼看到的对不上 —— 说明浏览器在
   * "打印媒体 + 截图"这条路上自有一套分页模型，光靠它不足以判断纸面版式。
   *
   * 这里换个稳的做法：**正常屏幕渲染**，把 frontend/src/styles/print.css 里的 @media print
   * 规则包装成 `@media screen` 注入（只读原文件、不改它），于是同一套打印规则在屏幕上生效，
   * 排版完全可测量、截图也所见即所得。断言与 B 段相同。
   */
  if (process.env.RC_SKIP_PAPER_FORENSICS !== '1') {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1500 }, locale: 'zh-CN' })
    const page = await ctx.newPage()
    await installApi(page, { resumeMine: 'saved' })
    await page.addInitScript(INIT)
    await page.goto(`${BASE_URL}/resume`, { waitUntil: 'networkidle', timeout: 25000 })
    await sleep(1000)
    await page.addStyleTag({ path: path.join(__dirname, '..', '..', 'frontend', 'src', 'styles', 'print.css') })
    /* print.css 的规则都在 @media print 里，屏幕上不生效 —— 用同一个文件内容再包一层
       @media screen 注入（CSS 里媒体查询可以嵌套同族条件，这里直接把外层换成 screen）。 */
    const printCss = await readFile(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'styles', 'print.css'),
      'utf8',
    )
    await page.addStyleTag({ content: printCss.replace('@media print {', '@media screen {') })
    await sleep(400)
    const paper = await page.evaluate(PRINT_PROBE)
    const box = await page.evaluate(`(() => {
      const s = document.querySelector('.resume-sheet')
      const r = s.getBoundingClientRect()
      return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), scrollY: window.scrollY }
    })()`)
    await page.screenshot({ path: path.join(OUT, 'r-resume-paper-screen.png'), fullPage: true })
    console.log(`\n=== 纸面版式取证（print.css 当 screen 注入；r-resume-paper-screen.png）===`)
    console.log(`  纸盒子=${JSON.stringify(box)}`)
    console.log(`  ${JSON.stringify(paper)}`)
    if (paper.hasSheet && box.top >= 0 && box.w > 0) ok('纸从页面顶端完整开始（top≥0），没有被切')
    else fail(`纸被切了或没渲染：${JSON.stringify(box)}`)
    for (const [key, label] of [
      ['navVisible', '导航'],
      ['asideVisible', '导引栏'],
      ['buttonVisible', '按钮'],
      ['inputVisible', '输入框'],
      ['pageHeaderVisible', '页头（标题/描述）'],
    ]) {
      if (paper[key]) fail(`纸面规则下${label}仍可见`)
      else ok(`纸面规则下${label}已隐藏`)
    }
    if (paper.paragraphColor === 'rgb(0, 0, 0)') ok('正文纯黑')
    else fail(`正文色 ${paper.paragraphColor}`)
    await ctx.close()
  }

  await browser.close()
  console.log(`\n===== 总结：${results.pass ? '全部通过' : '有失败项（见上方 ✗）'} =====`)
  if (!results.pass) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
