/**
 * a7-blocks.mjs — A7 临时取证：把 /resume 的每一块高度打出来，找出页高到底花在哪。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a7-blocks.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const main = document.querySelector('main')
  const top = main.getBoundingClientRect().top + window.scrollY
  const blocks = [...main.querySelectorAll('[data-slot="panel"], [data-slot="panel-inset"], [data-slot="empty-state"], header')]
  const rows = blocks.map((el) => {
    const r = el.getBoundingClientRect()
    const head = el.querySelector('h1,h2,h3')
    const label = (head?.textContent ?? el.textContent ?? '').trim().slice(0, 18)
    const fields = el.querySelectorAll('input, textarea').length
    return { label, h: Math.round(r.height), top: Math.round(r.top + window.scrollY - top), slot: el.dataset.slot ?? 'header', fields }
  })
  return { top: Math.round(top), total: Math.round(main.getBoundingClientRect().height), rows }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/resume', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  const { total, rows } = await page.evaluate(PROBE)
  console.log(`main 高 ${total}px`)
  let sum = 0
  for (const r of rows) {
    sum += r.h
    console.log(`${String(r.top).padStart(5)}  h=${String(r.h).padStart(4)}  ${r.slot.padEnd(14)} fields=${String(r.fields).padStart(2)}  ${r.label}`)
  }
  console.log(`块高合计 ${sum}px（差额 = 页面级 gap + 页头）`)

  /* 交互校验：展开「教育背景 第 1 条」的 4 个问题（字段不能被藏起来） */
  const first = page.getByRole('button', { name: '开始填这一条' }).first()
  if (await first.count()) {
    await first.click()
    await sleep(500)
    const after = await page.evaluate(PROBE)
    const edu = after.rows.find((r) => r.label.startsWith('教育背景 第 1 条'))
    console.log(`展开「教育背景 第 1 条」后：main=${after.total}px，该条 fields=${edu?.fields} h=${edu?.h}`)
    await page.screenshot({
      path: `${process.env.A7_OUT ?? 'audit/round1'}/a7-resume-expanded-entry.png`,
      fullPage: true,
    })
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
