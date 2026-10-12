/**
 * task-verify.mjs — /task 增强后的实测：路径覆盖范围、筛选、溢出、当前行动真值。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/task-verify.mjs
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'audit', 'round3')
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const env = (data) => ({
  status: 200,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify({ code: 0, message: 'success', data }),
})

const T = (o) => ({
  id: 'x', user_id: 'u1', title: '任务', description: null, pain_point: null, status: '进行中',
  value_note: null, difficulty: null, estimated_days: null,
  created_at: '2026-09-10T20:05:00+08:00', updated_at: '2026-09-18T09:24:31+08:00', progress: 0,
  ...o,
})

/** 5 条进行中（验证"只有前 2 条有路径"）+ 1 条已完成 + 1 条已放弃 */
const TASKS = [
  T({ id: 'a', title: '做一个命令行待办清单小工具', value_note: '通过一个完整的小项目，掌握输入处理、本地存储和基本的程序组织。', difficulty: '中等', estimated_days: 7, pain_point: '缺项目经验', progress: 0 }),
  T({ id: 'b', title: '用一天时间画出技术兴趣地图', value_note: '迷茫常常是因为选项太多又太模糊。', difficulty: '简单', estimated_days: 3, progress: 0.5 }),
  T({ id: 'c', title: '把简历里的项目描述补上量化结果', value_note: '把「做了什么」改成「做出了什么结果」。', difficulty: '中等', estimated_days: 2, progress: 0 }),
  T({ id: 'd', title: '整理一次课程项目的技术选型理由', difficulty: '简单', estimated_days: 1, progress: 0.2 }),
  T({ id: 'e', title: '读完《鸿蒙应用开发实战》前三章', difficulty: '中等', estimated_days: 5, progress: 0 }),
  T({ id: 'f', title: '搭建 ArkTS 基础环境并跑通 Hello World', status: '已完成', progress: 1 }),
  T({ id: 'g', title: '读完《鸿蒙应用开发实战》前三章', status: '已放弃', progress: 0.2 }),
]

/** /home/summary 只覆盖前 2 条（模拟后端 MAX_ONGOING_TASKS=2） */
const SUMMARY = {
  stage: 'prepare', stage_label: '求职准备期',
  profile: { clarity_score: 68, action_score: 54, resume_score: 41, total_score: 54, stage: 'prepare', tested: true },
  tags: [], daily_question: null, ai_findings: [],
  ongoing_tasks: [
    { id: 'a', title: TASKS[0].title, difficulty: '中等', estimated_days: 7, done_steps: 1, total_steps: 4, current_step_title: '梳理待办事项需要支持的操作' },
    { id: 'b', title: TASKS[1].title, difficulty: '简单', estimated_days: 3, done_steps: 2, total_steps: 4, current_step_title: '画出三条你最想深入的技术线' },
  ],
  completed_tasks: 1, completed_steps: 7, active_days: 12,
  next_action: { text: '继续把命令行工具做完', route: '/task/a', reason: '任务已经做到一半。' },
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
await mkdir(OUT, { recursive: true })
const ctx = await browser.newContext({ viewport: { width: 1025, height: 900 }, locale: 'zh-CN' })
const page = await ctx.newPage()
await installApi(page, {})
await page.route('**/api/v1/task', (r) => (r.request().method() === 'GET' ? r.fulfill(env(TASKS)) : r.continue()))
await page.route('**/api/v1/home/summary', (r) => r.fulfill(env(SUMMARY)))
await page.addInitScript(INIT)
await page.goto(BASE_URL + '/task', { waitUntil: 'networkidle', timeout: 25000 })
await sleep(1500)

const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-slot="panel"]')]
  const pathLabels = [...document.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && e.textContent.trim() === '任务路径')
  const currentActions = [...document.querySelectorAll('*')].filter((e) => e.childElementCount === 0 && /当前行动/.test(e.textContent))
  const overflow = [...document.querySelectorAll('button, a, input')].filter((el) => {
    const r = el.getBoundingClientRect()
    return r.right > innerWidth + 1 || r.left < -1
  }).length
  const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
  return {
    cards: cards.length,
    cardParaWords: pathLabels.length,
    currentActionLines: currentActions.length,
    overflow,
    scrollW: document.documentElement.scrollWidth,
    innerW: innerWidth,
    tabs,
    texts: { a: '1/4 步', b: '2/4 步' },
    bodyHasA: document.body.innerText.includes('1/4 步'),
    bodyHasB: document.body.innerText.includes('2/4 步'),
    bodyHasC3: document.body.innerText.includes('3/4 步'),
    currentA: document.body.innerText.includes('梳理待办事项需要支持的操作'),
    currentB: document.body.innerText.includes('画出三条你最想深入的技术线'),
  }
})
console.log('== 默认视图 ==')
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: path.join(OUT, 'task-enhanced-1025.png') })

// 切到「已完成」
await page.getByRole('tab', { name: /已完成/ }).click()
await sleep(600)
const doneView = await page.evaluate(() => ({
  cards: document.querySelectorAll('[data-slot="panel"]').length,
  hasShelf: document.body.innerText.includes('记录还在，可以回看'),
  hasOngoingTitle: document.body.innerText.includes('做一个命令行待办清单小工具'),
}))
console.log('== 已完成筛选 ==', JSON.stringify(doneView))
await page.screenshot({ path: path.join(OUT, 'task-enhanced-1025-done.png') })

// 切到「进行中」
await page.getByRole('tab', { name: /进行中/ }).click()
await sleep(600)
const ongoingView = await page.evaluate(() => ({
  cards: document.querySelectorAll('[data-slot="panel"]').length,
  hasShelf: document.body.innerText.includes('记录还在，可以回看'),
}))
console.log('== 进行中筛选 ==', JSON.stringify(ongoingView))
await page.screenshot({ path: path.join(OUT, 'task-enhanced-1025-ongoing.png') })

await browser.close()
