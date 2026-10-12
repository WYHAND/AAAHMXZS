/**
 * k1-k2.mjs — /task 卡片的 K1/K2 对照实验 + 多视口截图。
 *
 * K1 = 1px 细描边 + 极轻阴影（页面当前写法）
 * K2 = 同样的 1px 细描边，无阴影
 * 两版**只差阴影**：尺寸/内边距/边框色/圆角/字体/进度条/数据/布局完全一致。
 * 切换方式：在浏览器里给 data-slot="panel" 的卡片加一个 inline style 覆盖 box-shadow，
 * **不写入生产代码**，不改变页面行为。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/k1-k2.mjs
 * 产物：tools/render-check/audit/round2/ 下的 task-{1025,1280}-{k1,k2}.png 与 k1-k2-compare-1025.png
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'audit', 'round2')
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 给所有任务卡加/去阴影（只在浏览器内存里改，不动源码） */
const applyVariant = (variant) => {
  const cards = [...document.querySelectorAll('[data-slot="panel"]')]
  for (const el of cards) {
    el.dataset.kvariant = variant
    if (variant === 'k2') el.style.boxShadow = 'none'
    else el.style.removeProperty('box-shadow')
  }
  return cards.length
}

async function shoot(browser, { width, variant }) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/task', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1600)
  const n = await page.evaluate(applyVariant, variant)
  await sleep(120)
  const file = path.join(OUT, `task-${width}-${variant}.png`)
  await page.screenshot({ path: file })
  // 只看卡片的近景（并排对照用）
  const clip = await page.evaluate(() => {
    const card = document.querySelector('[data-slot="panel"]')
    if (!card) return null
    const r = card.getBoundingClientRect()
    return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 8), width: Math.min(r.width + 32, innerWidth), height: Math.min(r.height + 40, innerHeight - r.y) }
  })
  let near = null
  if (clip) {
    near = path.join(OUT, `card-${width}-${variant}.png`)
    await page.screenshot({ path: near, clip })
  }
  await ctx.close()
  console.log(`${width}px ${variant}: cards=${n} -> ${path.basename(file)}${near ? ' + ' + path.basename(near) : ''}`)
  return { file, near, clip }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const shots = {}
  for (const width of [1025, 1280]) {
    for (const variant of ['k1', 'k2']) {
      shots[`${width}-${variant}`] = await shoot(browser, { width, variant })
    }
  }

  // 并排对照图：把 1025 下的 K1 / K2 近景拼一张
  const a = shots['1025-k1']?.near
  const b = shots['1025-k2']?.near
  if (a && b) {
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
    const toDataUrl = async (p) => {
      const { readFile } = await import('node:fs/promises')
      return 'data:image/png;base64,' + (await readFile(p)).toString('base64')
    }
    const [ua, ub] = [await toDataUrl(a), await toDataUrl(b)]
    await page.setContent(`
      <body style="margin:0;background:#fbf9f6;font:13px/1.6 -apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1b1c1a">
        <div style="display:flex;gap:16px;padding:16px;align-items:flex-start">
          <div style="flex:1">
            <div style="font-weight:600;margin-bottom:8px">K1 · 1px 细描边 + 极轻阴影</div>
            <img src="${ua}" style="width:100%;display:block;border-radius:8px"/>
          </div>
          <div style="flex:1">
            <div style="font-weight:600;margin-bottom:8px">K2 · 1px 细描边，无阴影</div>
            <img src="${ub}" style="width:100%;display:block;border-radius:8px"/>
          </div>
        </div>
      </body>`)
    await page.screenshot({ path: path.join(OUT, 'k1-k2-compare-1025.png'), fullPage: true })
    console.log('并排对照 -> k1-k2-compare-1025.png')
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
