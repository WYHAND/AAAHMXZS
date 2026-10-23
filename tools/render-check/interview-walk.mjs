/**
 * 模拟面试全程走查 + 逐步截屏（真机：真后端、真 AI、真登录）。
 *
 * 为什么用 Playwright 而不是 OpenCode 的浏览器工具：后者的窗口在本机不可见，
 * 截图会报 "Screenshot needs a visible tab"，点击也会 UnknownVizError。
 * 本项目的 render-check 一直是用 playwright-core + 本地 Edge 无头跑渲染校验的。
 *
 * ⚠️ 会话页的主 CTA 文案是**随状态变的**（InterviewSessionPage.tsx:379-385）：
 *   没输入 "写下回答后开始"（禁用） -> 有输入 "提交并继续" / 追问时 "回答追问" / 提交中 "提交中…"
 * 所以不能用固定文案去点，必须先等它变成可点的「提交并继续 / 回答追问」再点。
 *
 * 用法：
 *   cd tools/render-check
 *   $env:RC_USER="probe_xxx"; $env:RC_PASS="probe-pass-123456"; node interview-walk.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5173'
const API = process.env.RC_API ?? 'http://127.0.0.1:8000/api/v1'
const EDGE = process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const USER = process.env.RC_USER
const PASS = process.env.RC_PASS ?? 'probe-pass-123456'
const TARGET_JOB = process.env.RC_JOB ?? '前端开发工程师'
const OUT = path.join(__dirname, 'shots', 'interview-walk')
const TOKEN_KEY = 'ai_job_helper:token'

const shots = []
const errors = []
const log = (...a) => console.log(...a)

const ANSWERS = [
  '我是软件工程大三学生，前端方向，最熟的技术栈是 Vue3 和 TypeScript。做过一个校园二手交易平台，我负责全部前端，用 Vue3 + Vite 一个人写了商品发布、搜索和站内聊天三个模块，最后校内 500 多个同学在用。',
  'Vue2 是用 Object.defineProperty 劫持属性的 get/set，数组变更和新增属性得特殊处理；Vue3 换成了 Proxy，能直接代理整个对象、天然支持数组和新增属性，再配合依赖收集和派发更新来驱动视图刷新。',
  '我会先看首屏资源体积：路由懒加载、组件按需加载，再用 Vite 把第三方库拆包，图片压缩并转 WebP，配合 CDN 和强缓存；最后用 Lighthouse 对比 FCP 和 LCP。我们那次就是把首屏从 3 秒左右降到 1.5 秒。',
]
const FOLLOWUPS = [
  '商品发布、搜索、站内聊天三个模块都是我写的，其中搜索做了输入防抖和分页加载。',
  '选 Vue3 是因为团队之前就用 Vue2，迁移成本低；而且 Vite 的冷启动和热更新都比之前快很多，开发体验好。',
  '主要是路由懒加载加图片压缩，另外把首屏的第三方库做了拆分，Lighthouse 上 LCP 从 3.1 秒降到 1.4 秒。',
  '我用的是组合式 API，把列表数据、分页和筛选抽成了 composable，页面里只留渲染逻辑。',
  '遇到的坑是初次加载时聊天列表很长，我加上了虚拟滚动，滚动时不再卡顿。',
]

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })

  const login = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then((r) => r.json())
  const token = login?.data?.access_token
  if (!token) {
    log('LOGIN_FAILED ' + JSON.stringify(login))
    process.exit(1)
  }
  log('登录成功 user=' + USER)

  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message ?? e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(JSON.stringify(token))});`,
  )

  let n = 0
  const shot = async (name, full = true) => {
    n += 1
    const file = path.join(OUT, String(n).padStart(2, '0') + '-' + name + '.png')
    await page.screenshot({ path: file, fullPage: full })
    shots.push(file)
    log('SHOT ' + path.basename(file))
  }
  const onReview = () => /\/interview\/review\//.test(page.url())

  /** 会话页的主 CTA 文案（随状态变） */
  const ctaText = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /^(提交并继续|回答追问|写下回答后开始|提交中…)$/.test((x.innerText || '').trim()),
      )
      return b ? b.innerText.trim() : ''
    })

  /** 等到「可以输入了」：正文框可用 + 主 CTA 是 提交并继续 / 回答追问 且可点 */
  const waitReady = (timeout = 90000) =>
    page.waitForFunction(
      () => {
        const t = document.querySelector('textarea')
        const b = [...document.querySelectorAll('button')].find((x) =>
          /^(提交并继续|回答追问)$/.test((x.innerText || '').trim()),
        )
        return !!t && !t.disabled && !!b && !b.disabled
      },
      null,
      { timeout },
    )

  // ---------------- ① 面试配置页 ----------------
  await page.goto(BASE_URL + '/interview', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await shot('面试配置页')

  await page.getByRole('button', { name: /技术面/ }).first().click()
  await page.getByRole('button', { name: /小测试/ }).first().click()
  await page.fill('#target_job', TARGET_JOB)
  await page.waitForTimeout(700)
  await shot('已选-技术面-小测试-已填目标岗位')

  // ---------------- ② 准备页 ----------------
  await page.getByRole('button', { name: /开始这一场/ }).click()
  await page.waitForURL(/interview\/(prepare|session)/, { timeout: 40000 }).catch(() => {})
  await page.waitForTimeout(1500)
  if (/\/interview\/prepare/.test(page.url())) {
    await shot('面试准备页-未勾选')
    for (const label of ['麦克风可用', '网络稳定', '环境安静']) {
      await page.getByRole('button', { name: new RegExp(label) }).first().click()
      await page.waitForTimeout(180)
    }
    await page.waitForTimeout(400)
    await shot('面试准备页-三项已勾选')
    await page.getByRole('button', { name: /我准备好了/ }).click()
  }

  // ---------------- ③ 面试进行 ----------------
  await page.waitForURL(/\/interview\/session/, { timeout: 40000 }).catch(() => {})
  await waitReady(60000).catch(() => log('!! 第 1 题就绪等待超时'))
  await page.waitForTimeout(1500)
  await shot('面试第1题')
  log('Q1: ' + (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 220))

  /** 当前题目状态（主问第几题 / 追问第几轮）—— 每换一个状态就截一张 */
  const stateInfo = () =>
    page.evaluate(() => {
      const t = document.body.innerText
      const q = t.match(/第\s*(\d+)\s*\/\s*(\d+)\s*题/)
      const f = t.match(/追问\s*(\d+)\s*\/\s*(\d+)/)
      const ph = document.querySelector('textarea')?.getAttribute('placeholder') || ''
      return { q: q ? q[1] : '?', follow: f ? f[1] : null, isFollow: /追问/.test(ph) }
    })

  let mainIdx = 0
  let followIdx = 0
  let rounds = 0
  let lastKey = ''
  let shotDialog = false

  while (rounds < 30 && !onReview()) {
    const st = await stateInfo()
    const key = `q${st.q}-f${st.follow ?? 0}`
    if (key !== lastKey) {
      lastKey = key
      await shot(st.follow ? `第${st.q}题-追问${st.follow}轮` : `第${st.q}题(主问)`)
    }
    // 中途截一张「结束面试」二次确认弹窗，然后取消（不真的结束）
    if (!st.isFollow && !shotDialog && st.q === '2') {
      shotDialog = true
      try {
        await page.getByRole('button', { name: /^结束面试$/ }).first().click({ timeout: 8000 })
        await page.waitForTimeout(700)
        await shot('结束面试-二次确认弹窗', false)
        await page.getByRole('button', { name: /再答一会儿/ }).first().click({ timeout: 8000 })
        await page.waitForTimeout(600)
        log('  （已截图并取消了「结束面试」弹窗）')
      } catch (e) {
        log('  弹窗截图跳过: ' + String(e).slice(0, 90))
      }
    }

    rounds += 1
    const answer = st.isFollow
      ? FOLLOWUPS[Math.min(followIdx++, FOLLOWUPS.length - 1)]
      : ANSWERS[Math.min(mainIdx++, ANSWERS.length - 1)]

    await page.locator('textarea').first().fill(answer)
    await waitReady(30000).catch(() => {})
    const label2 = await ctaText()
    await page
      .getByRole('button', { name: new RegExp('^' + (label2 || '提交并继续') + '$') })
      .first()
      .click({ timeout: 15000 })
    log(`第 ${rounds} 轮：${st.isFollow ? '追问 ' + st.follow : '主问 Q' + st.q} 已提交`)
    await page.waitForTimeout(1200)
    if (onReview()) break
    await waitReady(90000).catch(() => {})
  }

  // 若没自动结束，走「结束面试 → 确认」
  if (!onReview()) {
    try {
      await page.getByRole('button', { name: /^结束面试$/ }).first().click({ timeout: 8000 })
      await page.waitForTimeout(700)
      await page.getByRole('button', { name: /结束并生成复盘/ }).first().click({ timeout: 8000 })
      log('（手动结束面试）')
    } catch (e) {
      log('手动结束失败: ' + String(e).slice(0, 120))
    }
  }

  // ---------------- ④ 复盘 ----------------
  await page.waitForURL(/\/interview\/review\//, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(2000)
  await shot('复盘生成中')
  await page
    .waitForFunction(() => /综合得分|这次考得怎么样|AI 点评/.test(document.body.innerText), null, {
      timeout: 120000,
    })
    .catch(() => log('!! 等复盘内容超时'))
  await page.waitForTimeout(3000)
  await shot('复盘页-完整')
  await page.evaluate(() => window.scrollTo(0, 960))
  await page.waitForTimeout(700)
  await shot('复盘页-下滑看逐题点评', false)

  log('\n===== 复盘页文字（前 1500 字）=====')
  log((await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n').slice(0, 1500))
  log('\n===== 控制台报错 =====')
  log(errors.length ? errors.slice(0, 10).join('\n') : '（无）')
  log('\n===== 截图清单 =====')
  log(shots.join('\n'))

  await browser.close()
}

main().catch((e) => {
  console.log('FATAL ' + (e?.stack ?? e))
  process.exit(1)
})
