/**
 * k1-k2-panels.mjs — 按指定视口导出 K1/K2 的**真实页面**截图（四个独立面板）。
 *
 * 与 k1-k2.mjs 的区别：这里用 setViewportSize 精确模拟 1025 / 1280 视口，
 * 每个面板是完整页面（含侧栏与外壳），不是线框图、不是拼贴海报。
 *
 * K1 = 1px 细描边 + 极轻阴影（页面当前写法）
 * K2 = 同样的 1px 细描边，无阴影（仅浏览器内存里覆盖 box-shadow，不写进生产代码）
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/k1-k2-panels.mjs
 * 产物：audit/round2/pages/{k1,k2}-{1025,1280}.png
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'audit', 'round2', 'pages')
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 三个进行中任务的固定数据：四个面板用的是**同一份数据**，便于直接比较 */
const TASKS = [
  {
    id: 't1', user_id: 'u1', title: '做一个鸿蒙待办清单小应用',
    description: null, pain_point: '缺项目经验', status: '进行中',
    value_note: '简历上能写成一个完整项目。', difficulty: '中等', estimated_days: 14,
    created_at: '2026-09-10T20:05:00+08:00', updated_at: '2026-09-18T09:24:31+08:00', progress: 0.4,
  },
  {
    id: 't2', user_id: 'u1', title: '用一天时间画出你的技术兴趣地图',
    description: null, pain_point: '拖延', status: '进行中',
    value_note: '迷茫常常是因为选项太多又太模糊，把它们写下来、标上感受，你才知道自己真正被什么吸引。',
    difficulty: '简单', estimated_days: 3,
    created_at: '2026-09-14T10:00:00+08:00', updated_at: '2026-09-21T14:02:00+08:00', progress: 0.5,
  },
  {
    id: 't3', user_id: 'u1', title: '把简历里的项目描述补上量化结果',
    description: null, pain_point: null, status: '进行中',
    value_note: '把「做了什么」改成「做出了什么结果」。', difficulty: '中等', estimated_days: 2,
    created_at: '2026-09-16T09:00:00+08:00', updated_at: '2026-09-22T09:00:00+08:00', progress: 0,
  },
  {
    id: 't4', user_id: 'u1', title: '搭建 ArkTS 基础环境并跑通 Hello World',
    description: null, pain_point: null, status: '已完成',
    value_note: null, difficulty: '简单', estimated_days: 1,
    created_at: '2026-09-08T09:00:00+08:00', updated_at: '2026-09-09T18:00:00+08:00', progress: 1,
  },
  {
    id: 't5', user_id: 'u1', title: '读完《鸿蒙应用开发实战》前三章',
    description: null, pain_point: '拖延', status: '已放弃',
    value_note: null, difficulty: '中等', estimated_days: 5,
    created_at: '2026-09-05T09:00:00+08:00', updated_at: '2026-09-07T09:00:00+08:00', progress: 0.2,
  },
]

const env = (data) => ({
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify({ code: 0, message: 'success', data }),
})

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  for (const width of [1025, 1280]) {
    for (const variant of ['k1', 'k2']) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: 'zh-CN' })
      const page = await ctx.newPage()
      await installApi(page, {})
      await page.route('**/api/v1/task', (r) =>
        r.request().method() === 'GET' ? r.fulfill(env(TASKS)) : r.continue(),
      )
      await page.addInitScript(INIT)
      await page.goto(BASE_URL + '/task', { waitUntil: 'networkidle', timeout: 25000 })
      await sleep(1500)
      const applied = await page.evaluate((v) => {
        const cards = [...document.querySelectorAll('[data-slot="panel"]')]
        for (const el of cards) {
          if (v === 'k2') el.style.boxShadow = 'none'
          else el.style.removeProperty('box-shadow')
        }
        return { cards: cards.length, shadow: getComputedStyle(cards[0]).boxShadow }
      }, variant)
      await sleep(120)
      const file = path.join(OUT, `${variant}-${width}.png`)
      await page.screenshot({ path: file })
      console.log(`${variant} @${width}: cards=${applied.cards} shadow=${applied.shadow.slice(0, 46)} -> ${path.basename(file)}`)
      await ctx.close()
    }
  }
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
