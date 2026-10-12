/**
 * verify-a6.mjs — A6 专项验证：**只读，不改 frontend/src**。
 *
 * 1. `/interview/session` 的「结束面试」二次确认（AlertDialog）真的弹得出来，
 *    且确认后走的是 `finishAndReview`（POST /interview/{id}/finish）→ 跳复盘页；
 * 2. 顺手给确认框截图存档。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/verify-a6.mjs
 */
import { mkdir } from 'node:fs/promises'
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
const OUT = path.join(__dirname, 'audit', 'round1')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  const calls = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (/\/interview\//.test(u.pathname)) calls.push(`${r.method()} ${u.pathname}`)
  })
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));` +
      `window.sessionStorage.setItem(${JSON.stringify(INTERVIEW_KEY)}, JSON.stringify(${JSON.stringify(SESSION_ID)}));`,
  )
  await page.goto(BASE_URL + '/interview/session', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)

  await page.getByRole('button', { name: '结束面试' }).click()
  await sleep(500)
  const dialog = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="alert-dialog-content"]')
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : null
  })
  await page.screenshot({ path: path.join(OUT, 'a6-session-confirm.png') })
  console.log(`确认框可见: ${dialog !== null}`)
  console.log(`确认框文案: ${dialog}`)

  await page.getByRole('button', { name: '结束并生成复盘' }).click()
  await sleep(1800)
  const finalUrl = new URL(page.url()).pathname
  const body = await page.evaluate(() => document.body.innerText)
  console.log(`确认后路径: ${finalUrl}`)
  console.log(`复盘页已渲染: ${body.includes('面试复盘')}`)
  console.log(`finish 调用: ${calls.filter((c) => /finish/.test(c)).join(' | ') || '（无）'}`)
  console.log(`review 调用: ${calls.filter((c) => /review/.test(c)).join(' | ') || '（无）'}`)
  console.log(`pageerror: ${errors.length}`)

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
