/**
 * 对话页改版验收截图：mock 一个「AI 提问 + 用户回答 + AI 追问」的多轮会话，
 * 用来同时看到 AI 气泡（白卡、尾巴在左下）与用户气泡（深墨、尾巴在右下），
 * 以及三段式布局（会话列表左栏 / 消息区 / 圆形发送按钮）。
 *
 * 用法：RC_BASE_URL=http://localhost:5173 node tools/render-check/chat-shot.mjs [输出.png] [--mobile]
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

const argv = process.argv.slice(2)
const mobile = argv.includes('--mobile')
const outArg = argv.find((a) => !a.startsWith('--'))
const outPath = path.join(__dirname, outArg ?? `audit/chat-${mobile ? 'mobile' : 'desktop'}.png`)

const CONV = 'b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
const NOW = '2026-10-11T21:50:00+08:00'

const CONVERSATIONS = [
  { id: CONV, title: '投了几家没回音', message_count: 4, followup_direction: '项目经历', followup_round: 2, conclusion: null },
  { id: 'c2', title: '新对话 3', message_count: 0, followup_direction: null, followup_round: 0, conclusion: null },
  { id: 'c3', title: '新对话 2', message_count: 0, followup_direction: null, followup_round: 0, conclusion: null },
  { id: 'c4', title: '新的职业对话', message_count: 0, followup_direction: null, followup_round: 0, conclusion: null },
].map((c) => ({ user_id: 'u1', created_at: NOW, updated_at: NOW, ...c }))

const MESSAGES = [
  { id: 'm1', conversation_id: CONV, role: 'assistant', content: '嗨，你今年大几啦？', client_msg_id: 'sys:opening', created_at: NOW },
  { id: 'm2', conversation_id: CONV, role: 'user', content: '我会用C++', client_msg_id: 'c2', created_at: NOW },
  {
    id: 'm3',
    conversation_id: CONV,
    role: 'assistant',
    content:
      'C++ 挺硬核的呀，指针、模板都够学起来不轻松。\n你平时是用它写点小东西，还是主要跟着课上的作业走？',
    client_msg_id: null,
    created_at: NOW,
  },
]

async function main() {
  await mkdir(path.dirname(outPath), { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: Number(process.env.RC_W) || 1440, height: 900 },
    locale: 'zh-CN',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await installApi(page, {})
  const ok = (data) => ({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ code: 0, message: 'success', data }),
  })
  await page.route(
    (url) => url.pathname.endsWith('/chat/conversations'),
    (route) => (route.request().method() === 'GET' ? route.fulfill(ok(CONVERSATIONS)) : route.fallback()),
  )
  await page.route(
    (url) => /\/chat\/conversations\/[^/]+\/messages$/.test(url.pathname),
    (route) => route.fulfill(ok(MESSAGES)),
  )
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )

  await page.goto(BASE_URL + '/chat', { waitUntil: 'networkidle', timeout: 25000 })
  await page.waitForTimeout(2200)
  await page.screenshot({ path: outPath })

  const report = await page.evaluate(() => ({
    userBubbles: document.querySelectorAll('[data-slot="chat-bubble"][data-role="user"]').length,
    aiBubbles: document.querySelectorAll('[data-slot="chat-bubble"][data-role="assistant"]').length,
    hasPop: !!document.querySelector('.bubble-pop'),
  }))
  console.log(`shot -> ${path.relative(process.cwd(), outPath)}`)
  console.log(`气泡：AI ${report.aiBubbles} 条 / 用户 ${report.userBubbles} 条；带动画类：${report.hasPop}`)
  console.log(errors.length ? `console 报错 ${errors.length} 条：\n${errors.join('\n')}` : 'console 报错 0 条')

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
