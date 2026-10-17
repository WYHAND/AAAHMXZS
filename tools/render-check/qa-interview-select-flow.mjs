/**
 * /interview 交互流程测试（改版后必须仍然"点得动、跳得对"）。
 *
 * 为什么单独写一个：`shot.mjs` 只看首屏画面对不对，`probe.mjs` 只看对比度，
 * 两者都**不会点按钮** —— 而这次是整页重排，最容易出的 bug 正是
 * 「换了个写法以后点击/联动/跳转坏了」。
 *
 * ⚠️ 2026-10-11 修掉两条**空断言**（独立复核指出，是真问题）：
 * 原版用 `body.includes('技术面')` 判"右侧预览跟着变了"、`body.includes('6 题')`
 * 判"题量跟着变了" —— 但三个场景行、以及"全真模拟"行的 desc 本身就含这些字，
 * **不点任何按钮就已经为真**，等于没测。现在所有联动断言都**只读右侧预览区
 * `[data-slot="panel-inset"]` 里的 h2 / p / dt+dd**，以及底部"将开始"摘要行。
 *
 * 用法：RC_BASE_URL=http://localhost:5173 node tools/render-check/qa-interview-select-flow.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const MOBILE = { width: 390, height: 844 }

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const errors = []

  /* ---------------- 第一段：1025px 的联动与提交 ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 1025, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + '/interview', { waitUntil: 'networkidle', timeout: 25000 })
  await page.waitForTimeout(1200)

  /** 只读右侧预览区（联动断言一律走这里，不再读 body） */
  const readInset = () =>
    page.evaluate(() => {
      const inset = document.querySelector('[data-slot="panel-inset"]')
      if (!inset) return { title: '', desc: '', note: '', facts: {} }
      const h2 = inset.querySelector('h2')
      const ps = [...inset.querySelectorAll('p')].map((p) => p.textContent.trim())
      const facts = {}
      inset.querySelectorAll('dt').forEach((dt) => {
        const dd = dt.parentElement ? dt.parentElement.querySelector('dd') : null
        facts[dt.textContent.trim()] = dd ? dd.textContent.trim() : ''
      })
      return { title: h2 ? h2.textContent.trim() : '', desc: ps[0] ?? '', note: ps[1] ?? '', facts }
    })

  /** 底部「将开始：…」摘要行 */
  const readSummary = () =>
    page.evaluate(() => {
      const p = [...document.querySelectorAll('main p')].find((x) =>
        x.textContent.trim().startsWith('将开始'),
      )
      return p ? p.textContent.trim() : ''
    })

  /** chip：按你的阶段推荐 / 你选的场景 */
  const readChip = () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll('main span')].find((s) =>
        /按你的阶段推荐|你选的场景/.test(s.textContent.trim()),
      )
      return el ? el.textContent.trim() : ''
    })

  // 1) 初始态：右栏就是默认推荐的那个场景（不是"页面里出现过这几个字"）
  const first = await readInset()
  check('初始右栏标题=项目面（按阶段推荐）', first.title === '项目面', first.title)
  check('初始右栏描述=你做过的项目与细节追问', first.desc === '你做过的项目与细节追问', first.desc)
  check('初始题量=3 题', first.facts['题量'] === '3 题', String(first.facts['题量']))
  check(
    '出题依据=简历·目标岗位·画像（不说没做的事）',
    first.facts['出题依据'] === '简历 · 目标岗位 · 画像',
    String(first.facts['出题依据']),
  )
  check('初始摘要行=按你的简历出题 · 3 题 · 项目面', (await readSummary()) === '将开始：按你的简历出题 · 3 题 · 项目面', await readSummary())

  // 2) 选中行都有非颜色指示器
  const dots = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-pressed="true"]')].map((el) => {
      const filled = [...el.querySelectorAll('span')].filter((s) => {
        const cs = getComputedStyle(s)
        const w = s.getBoundingClientRect().width
        return w > 0 && w <= 12 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'
      })
      return { text: (el.textContent || '').trim().slice(0, 6), dots: filled.length }
    }),
  )
  check(
    '选中行都有非颜色指示器（实心墨点）',
    dots.length === 2 && dots.every((d) => d.dots === 1),
    JSON.stringify(dots),
  )

  // 3) 切场景 -> 右栏与摘要必须真的变
  await page.getByRole('button', { name: /技术面/ }).click()
  await page.waitForTimeout(400)
  const afterTech = await readInset()
  check('点技术面后右栏标题=技术面', afterTech.title === '技术面', afterTech.title)
  check('点技术面后右栏描述=岗位相关的专业知识', afterTech.desc === '岗位相关的专业知识', afterTech.desc)
  check('点技术面后右栏理由变成"已换成…"', afterTech.note.includes('已换成技术面'), afterTech.note)
  check('点技术面后 chip=你选的场景', (await readChip()) === '你选的场景', await readChip())
  check('摘要行同步为技术面', (await readSummary()).includes('技术面'), await readSummary())
  check('页面上没有"方向大体选对了"这种评价口吻', !(await page.locator('body').innerText()).includes('方向大体选对了'))

  // 4) 切模式 -> 题量必须真的变
  await page.getByRole('button', { name: /全真模拟/ }).click()
  await page.waitForTimeout(400)
  const afterFull = await readInset()
  check('点全真模拟后题量=6 题', afterFull.facts['题量'] === '6 题', String(afterFull.facts['题量']))
  check('摘要行同步为 6 题', (await readSummary()).includes('6 题'), await readSummary())
  check('页面不出现假数字"3-5 题"', !(await page.locator('body').innerText()).includes('3-5 题'))

  // 5) 填目标岗位 -> 摘要联动
  await page.locator('#target_job').fill('鸿蒙开发工程师')
  await page.waitForTimeout(300)
  check('摘要联动目标岗位', (await readSummary()).includes('鸿蒙开发工程师'), await readSummary())

  // 6) 列表语义（选项组应是 ul/li，不是裸 div）
  const lists = await page.evaluate(() => document.querySelectorAll('main ul').length)
  check('两个选项组保留 ul/li 列表语义', lists === 2, `main ul = ${lists}`)

  // 7) 提交 -> 跳转
  await page.getByRole('button', { name: /开始这一场/ }).click()
  await page.waitForURL(/\/interview\/prepare/, { timeout: 10000 }).catch(() => {})
  check('点「开始这一场」后跳到 /interview/prepare', /\/interview\/prepare/.test(page.url()), page.url())
  await page.waitForTimeout(800)
  const prepare = await page.locator('body').innerText()
  check('准备页渲染出「面试准备」', prepare.includes('面试准备'))
  check(
    '准备页题量是真值（小测试 3 题 / 全真模拟 6 题）',
    prepare.includes('小测试 3 题') && prepare.includes('全真模拟 6 题'),
    prepare.match(/小测试[^\n]*/) ?? '',
  )
  check('准备页不出现"3-5 题"', !prepare.includes('3-5 题'))
  await page.screenshot({ path: path.join(__dirname, 'audit/interview-flow-prepare.png'), fullPage: true })
  await ctx.close()

  /* ---------------- 第二段：390px 首屏必须看得见主 CTA ---------------- */
  const mctx = await browser.newContext({ viewport: MOBILE, locale: 'zh-CN' })
  const mpage = await mctx.newPage()
  mpage.on('pageerror', (e) => errors.push('mobile: ' + String(e.message ?? e)))
  await installApi(mpage, {})
  await mpage.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await mpage.goto(BASE_URL + '/interview', { waitUntil: 'networkidle', timeout: 25000 })
  await mpage.waitForTimeout(1200)
  const cta = await mpage.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      (x.textContent || '').includes('开始这一场'),
    )
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), viewport: window.innerHeight }
  })
  check(
    `390px 首屏看得见主 CTA（bottom ${cta ? cta.bottom : '未找到'} ≤ ${MOBILE.height}）`,
    Boolean(cta) && cta.bottom <= MOBILE.height,
    cta ? JSON.stringify(cta) : '未找到按钮',
  )
  await mpage.screenshot({ path: path.join(__dirname, 'audit/interview-mobile-firstfold.png') })
  await mctx.close()

  check('console 无报错', errors.length === 0, errors.slice(0, 3).join(' | '))

  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n共 ${results.length} 条，通过 ${results.length - failed.length}，失败 ${failed.length}`)
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
