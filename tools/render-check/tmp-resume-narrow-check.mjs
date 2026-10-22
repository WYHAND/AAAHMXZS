/**
 * tmp-resume-narrow-check.mjs —— 本轮「我的简历」页收窄改动的验收脚本（**只读，不改 frontend/src**）。
 *
 * 验收清单：
 * 1. 窄屏无横向溢出：视口 1440 / 1025 / 1024 / 390 四档 × 两种态（展示态=已保存数据、填写态=data:null）；
 *    - documentElement.scrollWidth <= innerWidth + 0.5
 *    - 页面里所有 button / a 的 getBoundingClientRect().right <= innerWidth + 0.5
 * 2. 整块收窄后的文案断言：
 *    - 展示态：body.innerText 里找不到「下一步」、找不到含「去填」的按钮，能找到「还可以再补一补」
 *    - 填写态：找不到含「去填」的按钮
 * 3. 打印态：emulateMedia({media:'print'}) 后
 *    - .resume-sheet 仍渲染（存在且有高度）
 *    - 所有 [data-print="hide"] 元素 display:none
 *    - 无横向溢出
 *    - 截图 audit/预览/resume-print.png（fullPage）
 *
 * 用法：$env:RC_BASE_URL='http://localhost:5173'; node tools/render-check/tmp-resume-narrow-check.mjs
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const OUT = path.join(__dirname, 'audit', '预览')
const INIT = `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 任务给定的展示态数据：项目经历 / 校园经历都空着 → 正好触发「还可以再补一补」 */
const SAVED = {
  id: 'chk-1',
  title: '林小满的简历',
  target_job: '前端开发工程师',
  completeness: 0.62,
  updated_at: '2026-10-17T10:00:00+08:00',
  parsed_data: {
    basic: { name: '林小满', grade: '大三', major: '软件工程', school: '华中科技大学', contact: 'lin@example.com' },
    target: { direction: '前端开发工程师', city: '武汉' },
    education: [{ school: '华中科技大学', major: '软件工程', period: '2023.09 - 2027.06', highlights: ['专业排名前 20%'] }],
    skills: ['Vue', 'TypeScript'],
    projects: [],
    campus: [],
    self_evaluation: '做事比较较真，答应的事会做完。',
  },
}

/** 覆写 GET /api/v1/resume/mine（后注册的 route 先命中，盖掉 installApi 的默认 mock） */
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

const PROBE = `(() => {
  const doc = document.documentElement
  const inner = window.innerWidth
  const clipped = []
  for (const el of document.querySelectorAll('button, a')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right > inner + 0.5) {
      clipped.push({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 24), right: Math.round(r.right) })
    }
  }
  const text = document.body.innerText
  const btnTexts = [...document.querySelectorAll('button, a')].map((el) => (el.textContent || '').trim())
  const sheet = document.querySelector('.resume-sheet')
  const page = document.querySelector('.resume-page')
  return {
    innerWidth: inner,
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowX: Math.round((doc.scrollWidth - inner) * 100) / 100,
    clippedCount: clipped.length,
    clipped: clipped.slice(0, 8),
    hasNextStep: text.includes('下一步'),
    hasGoFill: btnTexts.some((t) => t.includes('去填')),
    hasOptionalBlock: text.includes('还可以再补一补'),
    hasSheet: Boolean(sheet),
    sheetWidth: sheet ? Math.round(sheet.getBoundingClientRect().width) : 0,
    pageWidth: page ? Math.round(page.getBoundingClientRect().width) : 0,
    /* 自证不是空扫：填写态必须真的排出了表单，否则「零溢出」只是把页面拍空了 */
    formRendered: text.includes('基本信息') && text.includes('保存'),
    failureCard: text.includes('这次没有可以展示的内容'),
  }
})()`

const PRINT_PROBE = `(() => {
  const doc = document.documentElement
  const inner = window.innerWidth
  const sheet = document.querySelector('.resume-sheet')
  const hides = [...document.querySelectorAll('[data-print="hide"]')]
  const stillVisible = hides
    .filter((el) => getComputedStyle(el).display !== 'none')
    .map((el) => ({ tag: el.tagName, text: (el.textContent || '').trim().slice(0, 20), display: getComputedStyle(el).display }))
  return {
    innerWidth: inner,
    scrollWidth: doc.scrollWidth,
    overflowX: Math.round((doc.scrollWidth - inner) * 100) / 100,
    hasSheet: Boolean(sheet),
    sheetHeight: sheet ? Math.round(sheet.getBoundingClientRect().height) : 0,
    sheetWidth: sheet ? Math.round(sheet.getBoundingClientRect().width) : 0,
    hideCount: hides.length,
    stillVisibleCount: stillVisible.length,
    stillVisible: stillVisible.slice(0, 8),
    buttonVisible: [...document.querySelectorAll('button')].some((el) => getComputedStyle(el).display !== 'none'),
    inputVisible: [...document.querySelectorAll('input, textarea')].some((el) => getComputedStyle(el).display !== 'none'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    sheetBg: sheet ? getComputedStyle(sheet).backgroundColor : null,
  }
})()`

const results = { pass: true }
const fail = (msg) => {
  results.pass = false
  console.log(`FAIL  ${msg}`)
}
const ok = (msg) => console.log(`PASS  ${msg}`)

async function openPage(browser, width, height, payload) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160))
  })
  await installApi(page, { resumeMine: 'saved' })
  await overrideMine(page, payload)
  await page.addInitScript(INIT)
  await page.goto(`${BASE_URL}/resume`, { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  return { ctx, page, errors, consoleErrors }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })

  /* ---------------- 1 + 2. 四档视口 × 两种态 ---------------- */
  for (const [label, payload] of [
    ['展示态', SAVED],
    ['填写态', null],
  ]) {
    for (const [width, height] of [
      [1440, 900],
      [1025, 800],
      [1024, 800],
      [390, 844],
    ]) {
      const { ctx, page, errors, consoleErrors } = await openPage(browser, width, height, payload)
      const m = await page.evaluate(PROBE)
      const tag = `[${label} ${width}px]`
      const problems = []
      if (m.overflowX > 0.5) problems.push(`横向溢出 ${m.overflowX}px (scrollWidth=${m.scrollWidth} > inner=${m.innerWidth})`)
      if (m.clippedCount > 0) problems.push(`${m.clippedCount} 个 button/a 被裁切 ${JSON.stringify(m.clipped)}`)
      if (label === '展示态') {
        if (m.hasNextStep) problems.push('仍能找到「下一步」')
        if (m.hasGoFill) problems.push('仍能找到含「去填」的按钮')
        if (!m.hasOptionalBlock) problems.push('找不到「还可以再补一补」')
        if (!m.hasSheet) problems.push('展示态没有简历纸')
      } else {
        if (m.hasGoFill) problems.push('填写态仍能找到含「去填」的按钮')
        if (!m.formRendered) problems.push(`填写态没有排出表单（formRendered=${m.formRendered}）`)
        if (m.failureCard) problems.push('填写态落到了失败卡')
      }
      if (errors.length) problems.push(`pageerror: ${errors.join(' | ')}`)
      if (consoleErrors.length) problems.push(`console.error: ${consoleErrors.join(' | ')}`)
      const nums = `overflow=${m.overflowX}px clipped=${m.clippedCount} pageW=${m.pageWidth} sheetW=${m.sheetWidth} 下一步=${m.hasNextStep} 去填=${m.hasGoFill} 可补块=${m.hasOptionalBlock}`
      if (problems.length) fail(`${tag} ${nums} :: ${problems.join(' ; ')}`)
      else ok(`${tag} ${nums}`)
      await ctx.close()
    }
  }

  /* ---------------- 2b. 展示态补一张首屏图（看单列 820 与新增浅底块） ---------------- */
  {
    const { ctx, page } = await openPage(browser, 1440, 900, SAVED)
    await page.screenshot({ path: path.join(OUT, 'resume-shot-desktop-saved.png') })
    /* 整页长图：新增的「还可以再补一补」浅底块在纸下面，首屏看不到，得拍整页 */
    await page.screenshot({ path: path.join(OUT, 'resume-shot-desktop-saved-full.png'), fullPage: true })
    const box = await page.evaluate(`(() => {
      const s = document.querySelector('.resume-sheet')
      const p = document.querySelector('.resume-page')
      return { page: p ? Math.round(p.getBoundingClientRect().width) : 0, sheet: s ? Math.round(s.getBoundingClientRect().width) : 0 }
    })()`)
    console.log(`INFO  [展示态 1440px 首屏] 单列宽 page=${box.page} sheet=${box.sheet}`)
    await ctx.close()
  }

  /* ---------------- 3. 打印态 ---------------- */
  {
    /* 高视口（一张竖着的纸），避免 1440×900 只装下上半截 */
    const { ctx, page } = await openPage(browser, 900, 1400, SAVED)
    await page.emulateMedia({ media: 'print' })
    await sleep(400)
    /* 打印截图前把滚动位置归零：外壳的滚动容器不是 window，逐个可滚动祖先清零 */
    await page.evaluate(`(() => {
      window.scrollTo(0, 0)
      let n = document.querySelector('.resume-sheet')
      while (n && n !== document.documentElement) { n.scrollTop = 0; n = n.parentElement }
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    })()`)
    await sleep(300)
    const m = await page.evaluate(PRINT_PROBE)
    await page.screenshot({ path: path.join(OUT, 'resume-print.png'), fullPage: true })
    const tag = '[打印态 900px]'
    const problems = []
    if (!m.hasSheet || m.sheetHeight <= 0) problems.push(`简历纸没渲染 (hasSheet=${m.hasSheet} h=${m.sheetHeight})`)
    if (m.stillVisibleCount > 0) problems.push(`${m.stillVisibleCount}/${m.hideCount} 个 data-print=hide 元素仍可见 ${JSON.stringify(m.stillVisible)}`)
    if (m.hideCount === 0) problems.push('页面上没有任何 data-print=hide 元素（探针没意义，不能算通过）')
    if (m.overflowX > 0.5) problems.push(`横向溢出 ${m.overflowX}px`)
    if (m.buttonVisible) problems.push('打印态下还有可见 button')
    if (m.inputVisible) problems.push('打印态下还有可见 input/textarea')
    const nums = `sheet=${m.sheetWidth}x${m.sheetHeight} hide=${m.hideCount} 未隐藏=${m.stillVisibleCount} overflow=${m.overflowX}px bodyBg=${m.bodyBg} sheetBg=${m.sheetBg} buttonVisible=${m.buttonVisible} inputVisible=${m.inputVisible}`
    if (problems.length) fail(`${tag} ${nums} :: ${problems.join(' ; ')}`)
    else ok(`${tag} ${nums}`)
    await ctx.close()
  }

  await browser.close()
  console.log(`\n===== 总结：${results.pass ? '全部通过' : '有失败项（见上方 FAIL）'} =====`)
  if (!results.pass) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
