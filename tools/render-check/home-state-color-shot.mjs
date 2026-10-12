/**
 * 首页「AI 发现 / 成长节律」两个面板的状态色验收截图（2026-10-11 状态色改版）。
 *
 * 用法：
 *   RC_BASE_URL=http://localhost:5173 node tools/render-check/home-state-color-shot.mjs [输出.png] [--full]
 *
 * 为什么单独一个脚本：home-redesign-shot.mjs 的断言（主角任务出现次数、两列底边对齐）
 * 是那一轮的验收口径，这里要看的是**颜色是否真的落地**，所以除了截图还会把
 * 关键元素的计算色（computedStyle）打出来——Tailwind 的任意值类（如 bg-signal）
 * 一旦解析失败会静默变成"没有背景色"，只看截图容易漏。
 *
 * 视口固定 1025×900：这是用户日常窗口宽度（见项目记忆），1440 只作补充。
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
const full = argv.includes('--full')
const outArg = argv.find((a) => !a.startsWith('--'))
const outPath = path.join(__dirname, outArg ?? 'audit/home-state-color.png')

/** 用户截图里的数据形状：两条 AI 发现、三格数字（0 / 0 / 4 天）、一个其它任务（0/4 步） */
const SUMMARY = {
  stage: 'explore',
  stage_label: '探索期',
  profile: {
    clarity_score: 30,
    action_score: 20,
    resume_score: 10,
    total_score: 20,
    stage: 'explore',
    tested: true,
  },
  tags: [
    { dimension: '痛点', label: '迷茫', weight: 3.2, source: 'chat' },
    { dimension: '痛点', label: '无聊', weight: 2.4, source: 'chat' },
    { dimension: '认知', label: '刷视频', weight: 1.1, source: 'chat' },
    { dimension: '兴趣', label: '健身', weight: 0.7, source: 'chat' },
    { dimension: '焦虑', label: '投递没回音', weight: 0.6, source: 'chat' },
    { dimension: '能力', label: '写代码', weight: 0.4, source: 'resume' },
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
      weight: 0.8,
    },
    {
      pain_point: '无聊',
      label: '无聊',
      reason: 'AI 在对话里注意到：不忙，无聊的很',
      target_route: '/chat',
      weight: 0.8,
    },
  ],
  ongoing_tasks: [
    {
      id: 't-focus',
      title: '做一个命令行待办清单小工具',
      difficulty: '中等',
      estimated_days: 6,
      done_steps: 2,
      total_steps: 5,
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
  activity: buildActivity(),
  next_action: {
    text: '继续：做一个命令行待办清单小工具',
    route: '/task/t-focus',
    reason: '这个任务还没做完，先把它推进一格。',
  },
}

/** 近 14 天活动序列：刻意覆盖 0 / 1-2 / 3-5 / 6+ 四档，方便核对柱子深浅是否分得开 */
function buildActivity() {
  const steps = [0, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 2, 1, 0]
  const out = []
  const today = new Date()
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push({ date: d.toISOString().slice(0, 10), steps: steps[13 - i] ?? 0 })
  }
  return out
}

async function main() {
  await mkdir(path.dirname(outPath), { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({
    viewport: { width: 1025, height: 900 },
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
  await page.waitForTimeout(2000)
  await page.screenshot({ path: outPath, fullPage: full })

  // --panels：只截「两个面板所在的那一行」——用户要看的正是这两个组件，
  // 整页首屏（900px 高）里它们被今日焦点的深色大卡挤到折叠线以下，看不到颜色。
  if (argv.includes('--panels')) {
    const panelsPath = outPath.replace(/\.png$/, '-both-panels.png')
    const panels = page.locator('[data-slot="panel"]')
    const count = await panels.count()
    console.log(`panel 数量: ${count}`)
    if (count >= 2) {
      // 先滚到左面板，再按两块的 boundingBox 取并集裁图（boundingBox 是页面坐标，不受滚动影响）
      await panels.first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      const boxes = []
      for (let i = 0; i < count; i += 1) {
        const box = await panels.nth(i).boundingBox()
        // 宽度阈值只用来滤掉隐藏的骨架/占位块：1025px 下右列窄卡约 290px，所以取 200
        if (box && box.width > 200) boxes.push(box)
      }
      if (boxes.length >= 2) {
        const x = Math.min(...boxes.map((b) => b.x))
        const y = Math.min(...boxes.map((b) => b.y))
        const clip = {
          x: Math.max(0, x - 4),
          y: Math.max(0, y - 4),
          width: Math.max(...boxes.map((b) => b.x + b.width)) - x + 8,
          height: Math.max(...boxes.map((b) => b.y + b.height)) - y + 8,
        }
        await page.screenshot({ path: panelsPath, clip })
        console.log(`row   -> ${path.relative(process.cwd(), panelsPath)} (${Math.round(clip.width)}×${Math.round(clip.height)})`)
      } else {
        console.log('panel 可见块不足 2 个，跳过并集截图')
      }
    }
  }

  // 两个面板各截一张特写（数据色差在这种小尺寸下最容易看漏）
  const panels = await page.locator('[data-slot="panel"]').all()
  const crops = []
  for (let i = 0; i < panels.length; i += 1) {
    const box = await panels[i].boundingBox()
    if (!box || box.width < 300) continue
    const cropPath = outPath.replace(/\.png$/, `-panel${i + 1}.png`)
    await panels[i].screenshot({ path: cropPath })
    crops.push(path.relative(process.cwd(), cropPath))
  }

  // 关键元素的计算色：任意值类解析失败时这里会看到 rgba(0,0,0,0)
  const colors = await page.evaluate(() => {
    const pick = (selector) => {
      const el = document.querySelector(selector)
      if (!el) return null
      const s = getComputedStyle(el)
      return {
        bg: s.backgroundColor,
        color: s.color,
        stroke: s.stroke,
        fill: s.fill,
      }
    }
    return {
      radarFill: pick('[data-slot="panel"] .recharts-radar-polygon'),
      radarSoftBlock: pick('[data-slot="panel"] .bg-signal-soft'),
      ringStroke: pick('[data-slot="panel"] svg circle:nth-of-type(2)'),
      ringNumber: pick('[data-slot="panel"] .text-headline-lg'),
      barEmpty: pick('[data-slot="panel"] .h-24 > div'),
      settledStat: pick('[data-slot="panel"] .text-settled'),
      signalSoft: pick('.bg-signal-soft'),
      settledSoft: pick('.bg-settled-soft'),
    }
  })

  console.log(`shot  -> ${path.relative(process.cwd(), outPath)}`)
  crops.forEach((c) => console.log(`crop  -> ${c}`))
  console.log('计算色 -> ' + JSON.stringify(colors, null, 1))
  console.log(errors.length ? `console 报错 ${errors.length} 条：\n${errors.join('\n')}` : 'console 报错 0 条')

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
