/**
 * 首页改版验收截图：把 /home/summary 换成用户截图里的数据形状（两个进行中任务、
 * 主角任务 0/4 步、两条 AI 发现、今日一问未答），检查：
 *   1. 「其它任务」不再重复主角任务（主角任务标题在页面里只出现一次）；
 *   2. 左右两列底部对齐（两列等高）；
 *   3. 控制台无报错。
 *
 * 用法：
 *   RC_BASE_URL=http://localhost:5173 node tools/render-check/home-redesign-shot.mjs [输出.png] [--mobile] [--full]
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
const full = argv.includes('--full')
const outArg = argv.find((a) => !a.startsWith('--'))
const outPath = path.join(
  __dirname,
  outArg ?? `audit/home-user-data-${mobile ? 'mobile' : 'desktop'}.png`,
)

const MAIN_TITLE = '做一个命令行待办清单小工具'

const SUMMARY = {
  stage: 'explore',
  stage_label: '探索期',
  profile: { clarity_score: 30, action_score: 20, resume_score: 10, total_score: 20, stage: 'explore', tested: true },
  // 画像标签必须用六维之一（兴趣/能力/技能/痛点/焦虑/认知），雷达才画得出来
  tags: [
    { dimension: '痛点', label: '迷茫', weight: 3.2, source: 'chat' },
    { dimension: '痛点', label: '无聊', weight: 2.4, source: 'chat' },
    { dimension: '认知', label: '刷视频', weight: 1.1, source: 'chat' },
    { dimension: '兴趣', label: '健身', weight: 0.7, source: 'chat' },
    { dimension: '焦虑', label: '投递没回音', weight: 0.6, source: 'chat' },
  ],
  daily_question: {
    id: 'dq1',
    content: '现在最让你卡住的一件事是什么？',
    options: [],
    answered: false,
  },
  ai_findings: [
    {
      pain_point: '迷茫',
      label: '迷茫',
      reason: 'AI 在对话里注意到：我不知道要学什么',
      target_route: '/chat',
      weight: 3.2,
    },
    {
      pain_point: '无聊',
      label: '无聊',
      reason: 'AI 在对话里注意到：不忙，无聊的很',
      target_route: '/chat',
      weight: 2.4,
    },
  ],
  ongoing_tasks: [
    {
      id: 't-cli',
      title: MAIN_TITLE,
      difficulty: '中等',
      estimated_days: 4,
      done_steps: 0,
      total_steps: 4,
      current_step_title: '选语言并定3个命令',
    },
    {
      id: 't-fit',
      title: '做一个健身打卡小工具',
      difficulty: '中等',
      estimated_days: 5,
      done_steps: 0,
      total_steps: 4,
      current_step_title: '选定工具形态并写一句话目标',
    },
  ],
  completed_tasks: 0,
  completed_steps: 0,
  active_days: 4,
  // 近 14 天每日完成步数（后端新增字段 activity 的形状）
  activity: buildActivity(),
  next_action: {
    text: `继续：${MAIN_TITLE}`,
    route: '/task/t-cli',
    reason: '这个任务还没做完，先把它推进一格。',
  },
}

/** 近 14 天活动序列（含今天，升序，缺数据天补 0），和真实页面一样 */
function buildActivity() {
  const steps = [0, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 2, 1, 0]
  const out = []
  const today = new Date()
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push({
      date: d.toISOString().slice(0, 10),
      steps: steps[13 - i] ?? 0,
    })
  }
  return out
}

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
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  await installApi(page, {})
  await page.route(
    (url) => url.pathname.endsWith('/home/summary'),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ code: 0, message: 'success', data: SUMMARY }),
      }),
  )
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )

  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await page.waitForTimeout(1800)
  await page.screenshot({ path: outPath, fullPage: full })

  if (argv.includes('--compose')) {
    await page.getByRole('button', { name: '随手写一句' }).click()
    await page.waitForTimeout(600)
    await page.getByPlaceholder('写一句真实的念头，一句话也可以…').fill('大概是没想清楚要学什么')
    await page.waitForTimeout(300)
    const composePath = outPath.replace(/\.png$/, '-compose.png')
    await page.screenshot({ path: composePath, fullPage: full })
    console.log(`compose -> ${path.relative(process.cwd(), composePath)}`)
  }

  const report = await page.evaluate((title) => {
    const text = document.body.innerText
    const count = text.split(title).length - 1
    const panels = [...document.querySelectorAll('[data-slot="panel"]')].map((el) => {
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), top: Math.round(r.top), bottom: Math.round(r.bottom) }
    })
    return { mainTitleOccurrences: count, panels }
  }, MAIN_TITLE)

  console.log(`shot -> ${path.relative(process.cwd(), outPath)}`)
  console.log(`主角任务标题出现次数（应为 1，仅主角卡）: ${report.mainTitleOccurrences}`)
  const left = report.panels.filter((p) => p.left < 600)
  const right = report.panels.filter((p) => p.left >= 600)
  if (left.length && right.length) {
    const lb = Math.max(...left.map((p) => p.bottom))
    const rb = Math.max(...right.map((p) => p.bottom))
    console.log(`两列底边：左 ${lb}px / 右 ${rb}px（差 ${Math.abs(lb - rb)}px）`)
  } else {
    console.log('panels:', JSON.stringify(report.panels))
  }
  console.log(errors.length ? `console 报错 ${errors.length} 条：\n${errors.join('\n')}` : 'console 报错 0 条')

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
