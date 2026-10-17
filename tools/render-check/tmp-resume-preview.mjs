/**
 * tmp-resume-preview.mjs —— 一次性预览脚本（**只读，不改 frontend/src**）。
 *
 * 目的：在动工前给出"改后"的像素预览。做法是在真实 /resume 页面上，
 * 用 page.evaluate 现场套上计划中的布局（单列、去掉侧边「下一步」卡），
 * 而不是先改源码 —— 所以预览 = 将来的实现，又不碰仓库。
 *
 * 输出 4 张图：展示态 before/after、填写态 before/after。
 * 用法：node tools/render-check/tmp-resume-preview.mjs
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
const OUT = path.join(__dirname, 'audit', 'preview')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 没有项目经历、也没有校园经历的简历 —— 正是用户说的那种人 */
const MY_RESUME = {
  id: 'pv-preview-1',
  title: '林小满-鸿蒙客户端开发-2026 秋招',
  target_job: '鸿蒙应用开发工程师',
  completeness: 0.62,
  updated_at: new Date().toISOString(),
  parsed_data: {
    basic: {
      name: '林小满',
      grade: '大三',
      major: '软件工程',
      school: '华中科技大学',
      contact: 'lin@example.com',
    },
    target: { direction: '鸿蒙应用开发工程师', city: '武汉' },
    education: [
      {
        school: '华中科技大学',
        major: '软件工程',
        period: '2023.09 - 2027.06',
        highlights: ['专业排名前 20%'],
      },
    ],
    skills: ['ArkTS', 'TypeScript'],
    projects: [],
    campus: [],
    self_evaluation: '做事比较较真，答应的事会做完。',
  },
}

/** 覆写 GET /resume/mine（只在 installApi 之后注册才生效） */
async function overrideMine(page, payload) {
  await page.route('**/api/v1/resume/mine', async (route) => {
    if (route.request().method().toUpperCase() !== 'GET') return route.fallback()
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ code: 0, message: 'success', data: payload }),
    })
  })
}

/** 量一下关键块的位置与宽度（预览不能拍脑袋） */
const MEASURE = `(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), width: Math.round(r.width) }
  }
  return {
    shell: pick('[class*="max-w-[1040px]"]:not([class*="max-w-[820px]"])'),
    hero: pick('[data-slot="panel"]'),
    sheet: pick('.resume-sheet'),
    grid: pick('.resume-page'),
    docScrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }
})()`

/**
 * 「改后」布局：整页收成一栏（和简历纸同宽 820）、删掉侧边「下一步」卡，
 * 并在纸下面补一条**可选**的补充建议（无按钮）。
 */
const MUTATE = `(() => {
  // PageShell 的 1040 内容列（不是外层 main）：整页收窄就改它
  const shell =
    document.querySelector('[class*="max-w-[1040px]"]') || document.querySelector('[data-print="main"]')
  if (shell) shell.style.maxWidth = '820px'

  const grid =
    document.querySelector('.resume-page') ||
    Array.from(document.querySelectorAll('main div')).find(
      (el) => typeof el.className === 'string' && el.className.includes('lg:grid-cols-12'),
    )
  const report = {
    shellFound: Boolean(shell),
    shellWidth: shell ? Math.round(shell.getBoundingClientRect().width) : null,
    found: Boolean(grid),
    removedAside: 0,
    removedJump: 0,
  }
  if (!grid) return report

  // block + 宽度跟父级，整页就收成一栏
  grid.style.display = 'block'
  grid.style.width = '100%'
  grid.style.maxWidth = 'none'
  grid.style.margin = '0'

  // 1) 删掉右列「下一步」卡
  grid.querySelectorAll('aside').forEach((el) => {
    el.remove()
    report.removedAside += 1
  })

  // 2) 内容列占满整宽
  const col = Array.from(grid.children).find((el) => el.tagName !== 'ASIDE')
  if (col) {
    col.style.maxWidth = 'none'
    col.style.width = '100%'
    col.style.gridColumn = 'auto'
  }

  // 3) 删掉催人填的「去填 xxx」按钮
  Array.from(document.querySelectorAll('button')).forEach((el) => {
    if ((el.textContent || '').includes('去填')) {
      el.remove()
      report.removedJump += 1
    }
  })

  // 3.5) 主角卡那句话不再点名「补上项目经历」
  Array.from(document.querySelectorAll('p')).forEach((el) => {
    const text = el.textContent || ''
    if (text.includes('这份简历会更有说服力')) {
      const m = text.match(/已经填了\s*([0-9]+)\s*%/)
      el.textContent = '已经填了 ' + (m ? m[1] : '44') + '%。写过的都算数，没写的想到再补；没有的那几段不用硬凑。'
    }
  })

  // 4) 纸下面补一条「可选补充」浅底块（无按钮）
  if (col) {
    const block = document.createElement('div')
    block.setAttribute('data-slot', 'panel-inset')
    block.className = 'flex flex-col gap-2 rounded-lg bg-surface-container-low p-3.5'
    block.setAttribute('data-print', 'hide')
    block.innerHTML =
      '<p class="text-body-md text-on-surface">还可以再补一补（可选）</p>' +
      '<p class="text-body-sm text-on-surface-variant">简历里没写到：<span class="text-on-surface">项目经历</span> / <span class="text-on-surface">校园与实践经历</span>。没有这些也没关系，我按你写过的内容排，一个字都不会替你编。</p>'
    col.appendChild(block)
  }
  return report
})()`

async function shoot(browser, name, payload) {
  const real = process.env.RC_REAL === '1'
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, { resumeMine: 'saved' })
  await overrideMine(page, payload)
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(`${BASE_URL}/resume`, { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(2200)

  if (real) {
    // 真正的实现（源码已改）：只拍，不注入
    const rects = await page.evaluate(MEASURE)
    await page.screenshot({ path: path.join(OUT, `${name}-real.png`), fullPage: false })
    await page.screenshot({ path: path.join(OUT, `${name}-real-full.png`), fullPage: true })
    console.log(`${name} (real): ${JSON.stringify(rects)}`)
    await ctx.close()
    return
  }

  await page.screenshot({ path: path.join(OUT, `${name}-before.png`), fullPage: false })
  const report = {}
  report.beforeRects = await page.evaluate(MEASURE)
  Object.assign(report, await page.evaluate(MUTATE))
  await sleep(400)
  report.afterRects = await page.evaluate(MEASURE)
  await page.screenshot({ path: path.join(OUT, `${name}-after.png`), fullPage: false })
  await page.screenshot({
    path: path.join(OUT, `${name}-after-full.png`),
    fullPage: true,
  })
  console.log(`${name}: ${JSON.stringify(report)}`)
  await ctx.close()
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  await shoot(browser, 'resume-preview', MY_RESUME) // 展示态（已生成简历）
  await shoot(browser, 'resume-form', null) // 填写态（还没写）
  await browser.close()
  console.log(`preview -> ${path.relative(process.cwd(), OUT)}`)
}

await main()
