/**
 * stream-check.mjs — 场景 C 的强校验：证明 delta 是「逐块到达并逐块上屏」的
 *
 * 前提：
 *   1. tools/render-check/stream-server.mjs 已在 127.0.0.1:4174 提供**真流式** SSE；
 *   2. frontend 用 VITE_API_BASE=http://127.0.0.1:4174/api/v1 重新构建并在 4173 preview。
 *
 * 做法：完全不 mock 网络（真实跨源 HTTP），在发送后以 60ms 间隔采样 AI 气泡文本，
 *       记录每次采样到的「AI 已显示文本」，看它是否严格以 delta 为单位增长。
 */

import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS_DIR = path.join(__dirname, 'shots')
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:4173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const TOKEN_KEY = 'ai_job_helper:token'
const TOKEN = 'rc.mock.jwt.token'
const DELTAS = [
  '你提到的「投了几家没回音」，',
  '通常不是能力问题，',
  '而是简历里的项目描述没有给出可验证的结果。',
]
const FULL = DELTAS.join('')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const page = await context.newPage()

const out = { deltas: DELTAS, expectedFull: FULL, samples: [], timeline: [] }

page.on('pageerror', (e) => (out.pageError = String(e.message || e)))
page.on('console', (m) => {
  if (m.type() === 'error') (out.consoleErrors ??= []).push(m.text())
})

// 记录 SSE 请求/响应（不 mock，只观察）
page.on('request', (r) => {
  if (r.url().includes('/stream')) out.timeline.push({ at: Date.now(), ev: 'request', url: r.url(), body: r.postData() })
})
page.on('response', (r) => {
  if (r.url().includes('/stream')) out.timeline.push({ at: Date.now(), ev: 'response-headers', status: r.status(), ct: r.headers()['content-type'] })
})

await page.addInitScript(`window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify(${JSON.stringify(TOKEN)}));`)
await page.goto(BASE_URL + '/chat', { waitUntil: 'networkidle', timeout: 30000 })
await sleep(1200)

const ta = page.locator('textarea')
out.textareaCount = await ta.count()
await ta.first().fill('我投了几家都没回音，简历我也改过。')

const readAssistant = () =>
  page.evaluate(() => {
    // ChatBubble 里 AI 气泡：取包含已知 delta 片段的最内层节点文本
    const all = Array.from(document.querySelectorAll('div,p,span'))
    const hits = all
      .map((el) => ({ t: (el.textContent || '').trim(), kids: el.children.length }))
      .filter((x) => x.t.includes('投了几家没回音') && x.kids === 0)
    return hits.length ? hits[hits.length - 1].t : ''
  })

const t0 = Date.now()
await page.getByRole('button', { name: /发送/ }).first().click()

// 高频采样 5 秒
for (let i = 0; i < 90; i++) {
  const txt = await readAssistant()
  const prev = out.samples.at(-1)?.text ?? ''
  if (txt !== prev) {
    out.samples.push({
      ms: Date.now() - t0,
      text: txt,
      len: txt.length,
      isDeltaBoundary: DELTAS.some((d) => txt === DELTAS.slice(0, DELTAS.indexOf(d) + 1).join('')),
    })
  }
  if (txt === FULL) break
  await sleep(60)
}

out.distinctStates = out.samples.map((s) => s.text)
out.everPartial = out.samples.some((s) => s.text.length > 0 && s.text !== FULL)
out.partialCount = out.samples.filter((s) => s.text.length > 0 && s.text !== FULL).length
out.deltaBoundaryStates = out.samples.filter((s) => s.isDeltaBoundary && s.text !== FULL).map((s) => s.text)
out.reachedFull = out.samples.at(-1)?.text === FULL
out.monotonicGrowth = out.samples.every(
  (s, i) => i === 0 || s.text.startsWith(out.samples[i - 1].text) || out.samples[i - 1].text === '',
)
out.growthDurationsMs = out.samples.map((s) => s.ms)

await sleep(1500)
const finalBody = await page.evaluate(() => document.body.innerText)
out.finalBubbleText = await readAssistant()
out.userEcho = finalBody.includes('简历我也改过')
out.followupProgressText = (finalBody.match(/追问进度\s*\d+\/3/) ?? [null])[0]
out.conclusionCardVisible = finalBody.includes('结论卡片')

out.verdict =
  out.textareaCount === 1 &&
  out.everPartial &&
  out.reachedFull &&
  out.monotonicGrowth &&
  out.userEcho &&
  !!out.followupProgressText &&
  !out.pageError
    ? 'PASS'
    : 'FAIL'

out.timeline = out.timeline.map((t) => ({ ...t, at: t.at - t0 }))

await page.screenshot({ path: path.join(SHOTS_DIR, 'C-stream-check-final.png'), fullPage: true })
await browser.close()

await writeFile(path.join(__dirname, 'stream-report.json'), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(out, null, 2))
