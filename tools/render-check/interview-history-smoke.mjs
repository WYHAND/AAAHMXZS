/**
 * 往期复盘入口冒烟：/interview 右上角「往期复盘」-> 弹窗 -> 点历史记录 -> 复盘页。
 * 真后端、真登录；只验证入口和重复查看，不跑 AI。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://127.0.0.1:5173'
const API = process.env.RC_API ?? 'http://127.0.0.1:8000/api/v1'
const EDGE = process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const USER = process.env.RC_USER ?? 'voiceprobe8922'
const PASS = process.env.RC_PASS ?? 'probe-pass-123456'
const OUT = path.join(__dirname, 'shots', 'interview-history')
const TOKEN_KEY = 'ai_job_helper:token'

const errors = []
const log = (...a) => console.log(...a)

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const login = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then((r) => r.json())
  const token = login?.data?.access_token
  if (!token) throw new Error('LOGIN_FAILED')

  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(JSON.stringify(token))});`,
  )

  const shot = async (name) => {
    const file = path.join(OUT, name + '.png')
    await page.screenshot({ path: file, fullPage: true })
    log('SHOT ' + file)
  }

  await page.goto(BASE_URL + '/interview', { waitUntil: 'networkidle', timeout: 40000 })
  await page.waitForTimeout(1500)
  await shot('01-select')

  await page.getByRole('button', { name: /往期复盘/ }).first().click()
  await page.waitForTimeout(800)
  const dialog = page.getByRole('dialog').first()
  const dialogText = (await dialog.innerText()).replace(/\s+/g, ' ')
  log('DIALOG: ' + dialogText.slice(0, 300))
  await shot('02-history-dialog')

  const link = dialog.getByRole('link').first()
  if (!(await link.count())) throw new Error('history link not found')
  await link.click()
  await page.waitForURL(/\/interview\/review\//, { timeout: 20000 })
  await page.waitForTimeout(1800)
  await shot('03-review')
  log('URL: ' + page.url())
  log('REVIEW: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 320))
  log('ERRORS: ' + JSON.stringify(errors, null, 2))

  await browser.close()
  if (errors.length) process.exitCode = 2
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
