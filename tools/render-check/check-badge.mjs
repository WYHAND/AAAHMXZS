/**
 * check-badge.mjs — 个人中心「奖章架」到底渲染成了什么（取证用）。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/check-badge.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const svgs = [...document.querySelectorAll('svg')].filter((s) => s.closest('[data-slot]') || s.closest('article') || s.closest('button'))
  const medal = svgs.map((s) => {
    const r = s.getBoundingClientRect()
    const first = s.querySelector('circle, rect, path')
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      cls: s.getAttribute('class'),
      firstFill: first ? getComputedStyle(first).fill : null,
      firstStroke: first ? getComputedStyle(first).stroke : null,
      innerFillClasses: [...s.querySelectorAll('[class*=fill-medal]')].slice(0, 3).map((n) => ({
        cls: n.getAttribute('class'), fill: getComputedStyle(n).fill,
      })),
    }
  }).filter((m) => m.w > 8 && m.h > 8)
  const tokens = {}
  const root = getComputedStyle(document.documentElement)
  for (const k of ['--medal-gold', '--medal-gold-deep', '--medal-mute', '--color-medal-gold']) {
    tokens[k] = root.getPropertyValue(k).trim() || '(未定义)'
  }
  return { medal, tokens }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/profile', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1500)
  const out = await page.evaluate(PROBE)
  console.log(JSON.stringify(out, null, 2))

  // 给奖章架那块单独放大截一张（有没有画出金属章，一眼能看出来）
  const shelf = page.locator('text=我的奖章').first()
  const box = await shelf.boundingBox().catch(() => null)
  if (box) {
    await page.screenshot({
      path: path.join(__dirname, 'audit', 'round1', 'check-badge-shelf.png'),
      clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: 1064, height: 220 },
    })
    console.log('shelf shot -> audit/round1/check-badge-shelf.png')
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
