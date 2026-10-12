/**
 * i-check.mjs — I 号子智能体自检（只读，不改 frontend/src）
 *
 * 1) 1025 / 1024 宽度：整页无横向溢出，且页面内所有 button/a/input 的 right <= innerWidth
 * 2) 选中态可辨识：读取选中卡/未选中卡的 borderColor / backgroundColor / boxShadow
 * 3) 交互真跑：点全真模拟 / 技术面 / 输入岗位 → 概要条联动；
 *    再点主按钮，用 page.route 记录 POST /interview/start 的请求体并 mock 成功
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/i-check.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const INIT = `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 选中态 / 未选中态取计算样式（不看截图，直接读值） */
const CARD_STYLE = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return null
  const cs = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    ariaPressed: el.getAttribute('aria-pressed'),
    borderColor: cs.borderTopColor,
    borderWidth: cs.borderTopWidth,
    backgroundColor: cs.backgroundColor,
    boxShadow: cs.boxShadow,
    ring: cs.getPropertyValue('--tw-ring-color'),
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    // 左上角琥珀状态点（选中态才有颜色）
    dot: (() => {
      // 用父选择器定位状态点，避免在注入的源码里写 CSS 转义
      const d = el.querySelector('span > span:first-child')
      if (!d || !el.querySelector('span.text-headline-sm')) return null
      const dcs = getComputedStyle(d)
      const dr = d.getBoundingClientRect()
      const title = el.querySelector('span.text-headline-sm')
      const tr = title ? title.getBoundingClientRect() : null
      return {
        color: dcs.backgroundColor,
        w: Math.round(dr.width), h: Math.round(dr.height),
        left: Math.round(dr.left), top: Math.round(dr.top),
        gapToTitle: tr ? Math.round(tr.left - dr.right) : null,
      }
    })(),
  }
})()`

/** 节奏取样：卡内边距 / 卡间距 / 区块间距 / 面板有无阴影描边 */
const RHYTHM = `(() => {
  const panel = document.querySelector('[data-slot="panel"]')
  const pcs = panel ? getComputedStyle(panel) : null
  const cards = [...document.querySelectorAll('button[aria-pressed]')]
  const cols = cards.map((c) => Math.round(c.getBoundingClientRect().top))
  const cs = cards[0] ? getComputedStyle(cards[0]) : null
  const sections = [...document.querySelectorAll('main section[aria-labelledby]')]
  const secGaps = []
  for (let i = 1; i < sections.length; i += 1) {
    const prev = sections[i - 1].getBoundingClientRect()
    const cur = sections[i].getBoundingClientRect()
    secGaps.push(Math.round(cur.top - prev.bottom))
  }
  const strength = document.querySelector('section[aria-labelledby="intensity-title"]')
  const heading = strength ? strength.querySelector('h2').closest('div') : null
  const grid = strength ? strength.querySelector('div.grid') : null
  const g = heading && grid
    ? Math.round(grid.getBoundingClientRect().top - heading.getBoundingClientRect().bottom)
    : null
  return {
    panelShadow: pcs ? pcs.boxShadow : null,
    panelBorder: pcs ? pcs.borderTopWidth + ' ' + pcs.borderTopColor : null,
    panelPadding: pcs ? pcs.paddingTop : null,
    cardPadding: cs ? cs.paddingTop + ' / ' + cs.paddingLeft : null,
    cardRadius: cs ? cs.borderTopLeftRadius : null,
    cardTops: cols,
    sameRowGapX: cards.length > 1
      ? Math.round(cards[1].getBoundingClientRect().left - cards[0].getBoundingClientRect().right)
      : null,
    sectionGapY: secGaps,
    headingToGrid: g,
  }
})()`

/** 整页溢出 + 交互元素右边界 */
const OVERFLOW = `(() => {
  const de = document.documentElement
  const els = [...document.querySelectorAll('button, a, input')].map((el) => {
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || el.placeholder || '').trim().slice(0, 18),
      left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
    }
  })
  return {
    innerWidth: window.innerWidth,
    scrollWidth: de.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    overflowX: de.scrollWidth - window.innerWidth,
    count: els.length,
    maxRight: els.length ? Math.max(...els.map((e) => e.right)) : 0,
    offenders: els.filter((e) => e.right > window.innerWidth + 0.5),
  }
})()`

async function open(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/interview', { waitUntil: 'networkidle', timeout: 25000 })
  // 等页面**真的**渲染出来再量：否则量到的是空白页，会给出 maxRight=0 的假绿
  await page.waitForSelector('main button[aria-pressed]', { timeout: 15000 })
  await sleep(800)
  return { ctx, page }
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const shots = path.join(__dirname, 'audit/round3')

  /* ---------- 1) 1025 / 1024 横向溢出 ---------- */
  for (const width of [1025, 1024]) {
    const { ctx, page } = await open(browser, width, 900)
    const o = await page.evaluate(OVERFLOW)
    const out = path.join(shots, `i-interview-${width}.png`)
    await page.screenshot({ path: out })
    console.log(`\n===== ${width}px =====`)
    console.log(
      `innerWidth=${o.innerWidth} scrollWidth=${o.scrollWidth} bodyScrollWidth=${o.bodyScrollWidth} 横向溢出=${o.overflowX} | 量到 button/a/input ${o.count} 个，最大 right=${o.maxRight}`,
    )
    console.log(o.offenders.length ? `  越界元素: ${JSON.stringify(o.offenders)}` : '  越界元素: 无')
    console.log(`  PASS(scrollWidth<=innerWidth)=${o.scrollWidth <= o.innerWidth}`)
    console.log(
      `  PASS(所有 button/a/input right<=innerWidth)=${o.count > 0 && o.maxRight <= o.innerWidth}   (count>0 才算有效测量)`,
    )
    console.log(`  shot -> ${path.relative(process.cwd(), out)}`)
    await ctx.close()
  }

  /* ---------- 2) 选中态可辨识（默认：小测试选中 / 全真模拟未选中；HR 面选中 / 项目面未选中） ---------- */
  const { ctx, page } = await open(browser, 1440, 900)
  const pairs = [
    ['强度·小测试（选中=默认）', 'section[aria-labelledby="intensity-title"] button[aria-pressed="true"]', 'section[aria-labelledby="intensity-title"] button[aria-pressed="false"]'],
    ['场景·HR 面（选中=默认）', 'section[aria-labelledby="scene-title"] button[aria-pressed="true"]', 'section[aria-labelledby="scene-title"] button[aria-pressed="false"]'],
  ]
  console.log('\n===== 选中态 / 未选中态 计算样式 =====')
  for (const [label, selA, selB] of pairs) {
    const a = await page.evaluate(CARD_STYLE(selA))
    const b = await page.evaluate(CARD_STYLE(selB))
    console.log(`\n[${label}]`)
    console.log('  选中  :', JSON.stringify(a))
    console.log('  未选中:', JSON.stringify(b))
    const diff = {
      borderColor: a.borderColor !== b.borderColor,
      backgroundColor: a.backgroundColor !== b.backgroundColor,
      boxShadow: a.boxShadow !== b.boxShadow,
    }
    console.log(`  三项差异 borderColor/backgroundColor/boxShadow = ${JSON.stringify(diff)}`)
    console.log(`  PASS(三项全有差异)=${Object.values(diff).every(Boolean)}`)
  }

  /* ---------- 2b) 节奏取样（卡内 16 / 卡间 12 / 区块间 24 / 静止态无阴影） ---------- */
  const rh = await page.evaluate(RHYTHM)
  console.log('\n===== 节奏取样 =====')
  console.log('  面板 shadow =', rh.panelShadow, '| border =', rh.panelBorder, '| padding =', rh.panelPadding)
  console.log('  选项卡 padding(上下/左右) =', rh.cardPadding, '| 圆角 =', rh.cardRadius)
  console.log('  同排卡间距 =', rh.sameRowGapX, '| 同排卡顶边 =', JSON.stringify(rh.cardTops))
  console.log('  区块间距(上块底→下块顶) =', JSON.stringify(rh.sectionGapY), '| 小节标题→选项卡 =', rh.headingToGrid)

  /* ---------- 2c) hover / focus-visible / loading ---------- */
  console.log('\n===== hover / focus-visible / loading =====')
  const unsel = page.locator('section[aria-labelledby="intensity-title"] button[aria-pressed="false"]')
  const st = async (loc) =>
    loc.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { borderColor: cs.borderTopColor, boxShadow: cs.boxShadow }
    })
  const before = await st(unsel)
  await unsel.hover()
  await sleep(150)
  const after = await st(unsel)
  console.log('  未选中卡静止:', JSON.stringify(before))
  console.log('  未选中卡 hover:', JSON.stringify(after))
  console.log(
    `  PASS(hover 抬边 borderColor 变化)=${before.borderColor !== after.borderColor}`,
  )

  const sel = page.locator('section[aria-labelledby="intensity-title"] button[aria-pressed="true"]')
  const selBefore = await st(sel)
  await sel.focus()
  await sleep(150)
  const selFocused = await st(sel)
  const outline = await sel.evaluate((el) => getComputedStyle(el).outlineStyle)
  console.log('  选中卡 focus-visible:', JSON.stringify(selFocused), '| outlineStyle =', outline)
  console.log(
    `  PASS(focus-visible 有可见区别)=${
      selBefore.boxShadow !== selFocused.boxShadow || selBefore.borderColor !== selFocused.borderColor
    }`,
  )

  /* 联动 + POST 之前先测 loading 文案（本次 mock 延迟 900ms） */
  await page.fill('#target_job', '前端开发')
  await page.getByRole('button', { name: '全真模拟' }).click()
  await page.getByRole('button', { name: '技术面' }).click()
  await sleep(150)

  // 记录 POST /interview/start 的 body（mock 成功 + 延迟 900ms，好抓 loading 文案）
  let captured = null
  await page.route('**/interview/start', async (route) => {
    const req = route.request()
    captured = { method: req.method(), url: req.url(), body: req.postDataJSON?.() ?? req.postData() }
    await sleep(900)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
        user_id: 'u-mock',
        mode: '全真',
        scene: '技术',
        status: '进行中',
        created_at: '2026-10-09T09:00:00Z',
        updated_at: '2026-10-09T09:00:00Z',
        report: null,
      }),
    })
  })

  const btn = page.getByRole('button', { name: /下一步：准备设备/ })
  console.log('  主按钮可见=', await btn.isVisible(), 'disabled=', await btn.isDisabled())
  // 点之前先确认概要条已联动（真数据）
  const summaryText = (await page.locator('p:has-text("已选：")').first().textContent())?.trim()
  console.log('  点主按钮前的概要:', summaryText)

  await btn.click()
  await sleep(350) // 请求被延迟 900ms，此刻应处于 loading
  const loadingLabel = (await page.getByRole('button', { name: /准备中/ }).count())
    ? '准备中…'
    : (await page.locator('button:has-text("下一步")').first().textContent())?.trim()
  const loadingDisabled = await page
    .locator('button:has-text("准备中")')
    .first()
    .isDisabled()
    .catch(() => null)
  console.log(`  loading 态文案 = ${loadingLabel} | disabled = ${loadingDisabled}`)

  await sleep(1400)
  console.log('\n  POST 捕获:', JSON.stringify(captured))
  const body = captured?.body ?? {}
  console.log(
    `  PASS(方法=POST)=${captured?.method === 'POST'} PASS(三个字段)=${JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['mode', 'scene', 'target_job'])}`,
  )
  console.log(
    `  body 校验 mode=${body.mode} scene=${body.scene} target_job=${body.target_job} -> PASS=${body.mode === '全真' && body.scene === '技术' && body.target_job === '前端开发'}`,
  )
  console.log('  点击后 URL:', page.url())

  await ctx.close()
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
