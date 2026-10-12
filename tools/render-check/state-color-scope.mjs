/**
 * 状态色改版的"没波及别页"检查（只读，不改 frontend/src）。
 *
 * 背景：这次改的 ProfileRadar / Stat 是**共享组件**（个人中心、成长报告、测评结果都在用），
 * 只给首页传了新参数（tone="signal" / tone="settled"）。缺省值必须逐像素保持旧行为，
 * 否则就是"改一页顺手改了另外三页"。
 *
 * 用法：
 *   RC_BASE_URL=http://localhost:5173 node tools/render-check/state-color-scope.mjs
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
const OUT_DIR = path.join(__dirname, 'audit')

/** 只读探针：拿到某条选择器的计算色（找不到就报 null，不抛） */
const PROBE = `(() => {
  const pick = (selector, props) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const s = getComputedStyle(el)
    return Object.fromEntries(props.map((p) => [p, s[p]]))
  }
  return {
    // recharts v3 的多边形渲染成 <path class="recharts-polygon">，不是 .recharts-radar-polygon
    // （第一版探针用了后者，结果三个页面都探到 null，等于没测——留这条注释免得再踩）
    radarPolygon: pick('.recharts-polygon', ['stroke', 'fill']),
    statInk: pick('[data-slot="stat"] span span', ['color']),
    statAccent: pick('[data-slot="stat"] .text-secondary', ['color']),
  }
})()`

const EDGE_OF_INK = 'rgb(9, 20, 38)' // --primary #091426
const ACCENT = 'rgb(155, 69, 0)' // --secondary #9b4500

async function shoot(page, route, name, token) {
  await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
  await page.waitForTimeout(1500)
  const probe = await page.evaluate(PROBE)
  await page.screenshot({ path: path.join(OUT_DIR, name) })
  console.log(`\n[${route}] -> ${name}`)
  console.log('  ' + JSON.stringify(probe))
  if (token) {
    // 断言：页面上**不应该**出现这次新增的状态色（首页专用）
    const leaked = await page.evaluate(() => {
      const BANNED = ['rgb(74, 111, 165)', 'rgb(63, 107, 69)', 'rgb(176, 74, 58)']
      const hits = []
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el)
        for (const v of [s.color, s.backgroundColor, s.borderTopColor, s.stroke, s.fill]) {
          if (BANNED.includes(v)) hits.push(el.tagName + '.' + (el.className?.toString?.().slice(0, 60) ?? ''))
        }
      }
      return [...new Set(hits)].slice(0, 8)
    })
    console.log(`  本页状态色泄漏检查（应为空）: ${leaked.length ? JSON.stringify(leaked) : '无'}`)
    console.log(`  期望缺省色: 雷达 stroke=${EDGE_OF_INK}、accent 数字=${ACCENT}`)
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1025, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )

  await shoot(page, '/profile', 'scope-profile.png', true)
  await shoot(page, '/report', 'scope-report.png', true)
  await shoot(page, '/', 'scope-home.png', false)

  console.log(errors.length ? `\nconsole 报错 ${errors.length} 条：\n${errors.join('\n')}` : '\nconsole 报错 0 条')
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
