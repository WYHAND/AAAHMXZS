/**
 * task-scenarios.mjs — /task 的必要场景截图 + 关键几何断言。
 *
 * 覆盖：
 *   S1 多条进行中（3 条，含 0% 与部分进度）
 *   S2 只有一条进行中
 *   S3 已完成 + 已放弃（小方块）
 *   S4 辅助字段缺失（无 value_note / difficulty / estimated_days / pain_point）
 *   S5 窄屏 768 / 390（检查操作不溢出）
 *
 * 数据用 page.route 覆盖（不改生产代码、不改 audit-mock）。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/task-scenarios.mjs
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'audit', 'round2')
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const T = (over) => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`,
  user_id: 'u1',
  title: '任务',
  description: null,
  pain_point: null,
  status: '进行中',
  value_note: null,
  difficulty: null,
  estimated_days: null,
  created_at: '2026-09-10T20:05:00+08:00',
  updated_at: '2026-09-18T09:24:31+08:00',
  progress: 0,
  ...over,
})

const CASES = {
  s1: [
    T({ title: '做一个鸿蒙待办清单小应用', value_note: '简历上能写成一个完整项目。', difficulty: '中等', estimated_days: 14, pain_point: '缺项目经验', progress: 0.4 }),
    T({ title: '用一天时间画出你的技术兴趣地图', value_note: '迷茫常常是因为选项太多又太模糊，把它们写下来、标上感受，你才知道自己真正被什么吸引。', difficulty: '简单', estimated_days: 3, pain_point: '拖延', progress: 0.5 }),
    T({ title: '把简历里的项目描述补上量化结果', value_note: '把「做了什么」改成「做出了什么结果」。', difficulty: '中等', estimated_days: 2, progress: 0 }),
  ],
  s2: [T({ title: '做一个鸿蒙待办清单小应用', value_note: '简历上能写成一个完整项目。', difficulty: '中等', estimated_days: 14, pain_point: '缺项目经验', progress: 0.4 })],
  s3: [
    T({ title: '做一个鸿蒙待办清单小应用', value_note: '简历上能写成一个完整项目。', difficulty: '中等', estimated_days: 14, pain_point: '缺项目经验', progress: 0.4 }),
    T({ title: '搭建 ArkTS 基础环境并跑通 Hello World', status: '已完成', progress: 1 }),
    T({ title: '读完《鸿蒙应用开发实战》前三章', status: '已放弃', progress: 0.2, pain_point: '拖延' }),
  ],
  s4: [T({ title: '整理一次课程项目的技术选型理由' })],
}

const env = (data) => ({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ code: 0, message: 'success', data }) })

async function shoot(browser, { name, tasks, width, height = 900 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.route('**/api/v1/task', (route) => {
    if (route.request().method() === 'GET') return route.fulfill(env(tasks))
    return route.continue()
  })
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/task', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1300)

  const geom = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-slot="panel"]')]
    const overflow = [...document.querySelectorAll('[data-slot="panel"] button, [data-slot="panel"] a')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.right > innerWidth + 1 || r.left < -1
    }).length
    return {
      cards: cards.length,
      cardWidths: cards.map((c) => Math.round(c.getBoundingClientRect().width)),
      cardHeights: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
      horizontalOverflowEls: overflow,
      docScrollW: document.documentElement.scrollWidth,
      innerW: innerWidth,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
    }
  })
  const file = path.join(OUT, `scenario-${name}-${width}.png`)
  await page.screenshot({ path: file })
  console.log(`${name} @${width}: cards=${geom.cards} w=${geom.cardWidths.join(',')} h=${geom.cardHeights.join(',')} overflow=${geom.horizontalOverflowEls} scrollW=${geom.docScrollW}/${geom.innerW}`)
  if (geom.docScrollW > geom.innerW + 1) console.log(`  ⚠ 横向滚动：${geom.text}`)
  await ctx.close()
  return { file, geom }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  await shoot(browser, { name: 's1-multi', tasks: CASES.s1, width: 1025 })
  await shoot(browser, { name: 's2-single', tasks: CASES.s2, width: 1025 })
  await shoot(browser, { name: 's3-done-abandoned', tasks: CASES.s3, width: 1025 })
  await shoot(browser, { name: 's4-missing-fields', tasks: CASES.s4, width: 1025 })
  await shoot(browser, { name: 's1-multi', tasks: CASES.s1, width: 768 })
  await shoot(browser, { name: 's1-multi', tasks: CASES.s1, width: 390, height: 844 })
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
