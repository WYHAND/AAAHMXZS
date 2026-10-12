/**
 * a1-calibrate.mjs —— A1 号子工具：给几何脚本做**校准**（证明它量得准，不是脚本 bug）。
 *
 * 背景：改造后实测「上一题」y=750，而改造前基线是 734（差 16px）。
 * 现在页面结构已变（按钮 size、h1 字号都改过），没法原样回滚，所以用脚本在**浏览器里**把容器
 * 高度按 c 再减 16px（inline style patch，不改源码），看按钮是否落到 734 ——
 * 落了，说明 16px 这个差值是真实布局差、我的量测可信；没落，就是脚本有问题。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-calibrate.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MEASURE = `(() => {
  const c = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('max-w-2xl'))
  const cr = c.getBoundingClientRect()
  const cs = getComputedStyle(c)
  const btn = (name) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(name))
    return b ? { y: Math.round(b.getBoundingClientRect().y), h: Math.round(b.getBoundingClientRect().height) } : null
  }
  const rows = [...c.children].map((ch) => {
    const r = ch.getBoundingClientRect()
    return { y: Math.round(r.y), bottom: Math.round(r.bottom), h: Math.round(r.height) }
  })
  return {
    container: { y: Math.round(cr.y), h: Math.round(cr.height), bottom: Math.round(cr.bottom), pt: cs.paddingTop, inlineH: c.style.height || '(none)' },
    contentBottom: 0,
    children: rows,
    prev: btn('上一题'),
    skip: btn('跳过'),
    docScrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
  }
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + '/test/question', { waitUntil: 'networkidle', timeout: 30000 })
  await sleep(1200)

  const show = (label, m) => {
    console.log(`\n[${label}] 容器 y=${m.container.y} h=${m.container.h} pt=${m.container.pt} bottom=${m.container.bottom} inlineH=${m.container.inlineH}`)
    console.log(`  子元素（y → bottom，高）: ${m.children.map((c) => `${c.y}→${c.bottom}(${c.h})`).join('  ')}`)
    console.log(`  「上一题」y=${m.prev?.y} h=${m.prev?.h}   「跳过」y=${m.skip?.y} h=${m.skip?.h}   docScrollH=${m.docScrollH}/${m.innerH}`)
  }

  show('当前实现', await page.evaluate(MEASURE))

  // 校准探针：只在浏览器里把容器高度减去 16px，看按钮是否落到基线 734/724
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('max-w-2xl'))
    c.style.height = 'calc(100svh - var(--spacing-shell-total) - 16px)'
  })
  await sleep(600)
  const cal = await page.evaluate(MEASURE)
  show('校准（高度再 −16px）', cal)
  const hit = cal.prev?.y === 734 && cal.skip?.y === 724
  console.log(`\n校准判定: 按钮 y ${cal.prev?.y}/${cal.skip?.y} vs 基线 734/724 → ${hit ? '命中 ✔（说明量测可信，16px 是真实布局差）' : '未命中 ✘（需要复查量测方式）'}`)

  await browser.close()
  process.exit(hit ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
