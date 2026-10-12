/**
 * shot.mjs — 只给指定路由截图（给页面 Agent 与验收用；比 audit-ui.mjs 快得多）。
 *
 * 用法：
 *   RC_BASE_URL=http://localhost:5199 node tools/render-check/shot.mjs <路由> [输出相对路径]
 * 例：
 *   node tools/render-check/shot.mjs /daily audit/round1/a4-daily.png
 *   node tools/render-check/shot.mjs /interview/session audit/round1/a6-session.png
 *
 * 默认 1440x900 首屏（不 fullPage：要看的正是首屏信息密度）。
 * 加 `--mobile` 出 390x844；加 `--full` 出整页长图。
 * 会话态路由（/interview/session）自动带上 sessionStorage 的 interview_id。
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

const argv = process.argv.slice(2)
const route = argv.find((a) => a.startsWith('/')) ?? '/'
const outArg = argv.find((a) => !a.startsWith('/') && !a.startsWith('--'))
const mobile = argv.includes('--mobile')
const full = argv.includes('--full')
const outPath = path.join(
  __dirname,
  outArg ?? `audit/shot-${mobile ? 'mobile' : 'desktop'}-${route.replace(/[^a-z0-9]+/gi, '-') || 'home'}.png`,
)
const session = route.startsWith('/interview/session')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await mkdir(path.dirname(outPath), { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    locale: 'zh-CN',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));` +
      (session
        ? `window.sessionStorage.setItem(${JSON.stringify(INTERVIEW_KEY)}, JSON.stringify(${JSON.stringify(SESSION_ID)}));`
        : ''),
  )
  await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
  /*
   * 等动画/过渡跑完再拍：首页进度条有 700ms 的 width transition，拍早了会拍到
   * "半路"的帧（进度条看着是空的）。**不能**用 addStyleTag 去禁掉 transition：
   * 那会让元素停在初始状态（宽度 0、颜色未到位），反而拍出更"灰"的假象。
   */
  await sleep(2000)
  await page.screenshot({ path: outPath, fullPage: full })
  await browser.close()
  console.log(`shot -> ${path.relative(process.cwd(), outPath)}${errors.length ? `  pageerrors=${errors.length}` : ''}`)
  if (errors.length) console.log(errors.join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
