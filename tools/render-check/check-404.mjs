/**
 * check-404.mjs — 验证 404 / 通配路由的两条硬约束：
 *   ① 未登录也能看到（公开路由，不被重定向到 /login）
 *   ② 渲染在 BlankLayout 里（有 canvas 底色 + 448px 居中窄栏 + 底部系统名 + 卡片不铺满屏）
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/check-404.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const shell = document.querySelector('[data-blank-width]')
  const card = document.querySelector('[data-slot="panel"]') ?? document.querySelector('h1')
  const r = card ? card.getBoundingClientRect() : null
  return {
    url: location.pathname,
    hasH1: !!document.querySelector('h1'),
    h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null,
    h1Size: document.querySelector('h1') ? getComputedStyle(document.querySelector('h1')).fontSize : null,
    shellWidth: shell ? shell.getAttribute('data-blank-width') : null,
    cardWidth: r ? Math.round(r.width) : null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    footer: (document.body.innerText || '').includes('高校学生 AI 就业辅助系统'),
  }
})()`

async function check(browser, { path, withToken }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  if (withToken) {
    await page.addInitScript(
      `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
    )
  } else {
    await page.addInitScript(`window.localStorage.removeItem(${JSON.stringify(TOKEN_KEY)});`)
  }
  await page.goto(BASE_URL + path, { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(900)
  const out = await page.evaluate(PROBE)
  await ctx.close()
  return { path, withToken, ...out }
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const rows = []
  for (const path of ['/404', '/this-route-does-not-exist']) {
    rows.push(await check(browser, { path, withToken: false }))
    rows.push(await check(browser, { path, withToken: true }))
  }
  await browser.close()

  let bad = 0
  for (const r of rows) {
    const okPublic = r.url === r.path
    const okShell = r.shellWidth === 'md' && r.footer && r.cardWidth !== null && r.cardWidth <= 460
    const okH1 = r.hasH1 && r.h1Size === '26px'
    if (!(okPublic && okShell && okH1)) bad++
    console.log(
      `${r.path.padEnd(28)} token=${r.withToken ? 'yes' : 'no '} url=${r.url.padEnd(28)} h1=${r.h1Size ?? '-'} shell=${r.shellWidth} cardW=${r.cardWidth} footer=${r.footer} => ${
        okPublic && okShell && okH1 ? 'PASS' : 'FAIL'
      }`,
    )
  }
  console.log(bad ? `\n${bad} case(s) FAILED` : '\n全部 PASS')
  process.exit(bad ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
