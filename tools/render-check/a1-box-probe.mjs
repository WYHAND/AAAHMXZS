/**
 * a1-box-probe.mjs —— A1 号子工具（只读）：回答一个具体争议——
 *   在 `/test/question` 真实页面上，`h-[calc(100svh-var(--spacing-shell-total))]` + `pt-shell`
 *   这对组合到底是 border-box 还是 content-box？（决定按钮 y 是 750 还是 734）
 *
 * 做法：把父智能体给的那条类名原样贴到一个探针 div 上，量 computed height / padding /
 *       boundingBox 高，再加一条显式 `box-sizing` 对照组。数字说话，不猜。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/a1-box-probe.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PARENT_CLS =
  'mx-auto flex h-[calc(100svh-var(--spacing-shell-total))] min-h-0 w-full max-w-2xl flex-col gap-5 px-margin pt-shell'

const PROBE = (parentCls) => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:400px;height:0'
  document.body.appendChild(host)

  const rows = []
  const add = (label, cls, extra) => {
    const d = document.createElement('div')
    d.className = cls
    if (extra) d.style.cssText = extra
    host.appendChild(d)
    const cs = getComputedStyle(d)
    const r = d.getBoundingClientRect()
    rows.push({
      label,
      boxSizing: cs.boxSizing,
      computedHeight: cs.height,
      inlineHeight: d.style.height || '(none)',
      padTop: cs.paddingTop,
      padBottom: cs.paddingBottom,
      rectH: Math.round(r.height * 100) / 100,
      contentBox: cs.boxSizing === 'border-box' ? `rect(${Math.round(r.height)}) − pt(${cs.paddingTop}) = 内容 ${Math.round(r.height - parseFloat(cs.paddingTop))}` : 'n/a',
    })
  }

  add('父版类名原样', parentCls)
  add('同一类名 + 显式 content-box', parentCls, 'box-sizing:content-box')
  /* 冻结对照：显式 box-sizing:border-box + height:792px + padding-top:76px（border-box 下应渲染 792） */
  add('对照 border-box 792+pt76', '', 'box-sizing:border-box;height:792px;padding-top:76px')
  /* 冻结对照：显式 box-sizing:content-box + height:792px + padding-top:76px（应渲染 868） */
  add('对照 content-box 792+pt76', '', 'box-sizing:content-box;height:792px;padding-top:76px')
  /* 冻结对照：同样的表达式交给内联 style（不走 Tailwind 任意值），看 calc 本身算出多少 */
  add('inline calc(shell-total)', '', 'height:calc(100svh - var(--spacing-shell-total))')
  add('inline calc(shell-total)+pt-shell', 'pt-shell', 'height:calc(100svh - var(--spacing-shell-total))')

  host.remove()

  const htmlCS = getComputedStyle(document.documentElement)
  const bodyCS = getComputedStyle(document.body)
  // 真实页面根容器
  const rootEl = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('max-w-2xl'))
  const rs = rootEl ? getComputedStyle(rootEl) : null
  const rb = rootEl ? rootEl.getBoundingClientRect() : null
  // 全局有没有 *{box-sizing} 规则
  const resetRules = []
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (const r of rules) {
      if (r.selectorText && r.style && r.style.boxSizing && (r.selectorText === '*' || r.selectorText.includes('::before'))) {
        resetRules.push(r.selectorText + ' { box-sizing: ' + r.style.boxSizing + ' }')
      }
    }
  }
  return {
    htmlBoxSizing: htmlCS.boxSizing,
    bodyBoxSizing: bodyCS.boxSizing,
    resetRules,
    tokenShellTotal: htmlCS.getPropertyValue('--spacing-shell-total').trim(),
    tokenShell: htmlCS.getPropertyValue('--spacing-shell').trim(),
    root: rootEl ? {
      cls: rootEl.className,
      boxSizing: rs.boxSizing,
      computedHeight: rs.height,
      padTop: rs.paddingTop,
      marginTop: rs.marginTop,
      rectY: Math.round(rb.y),
      rectH: Math.round(rb.height),
      rectBottom: Math.round(rb.bottom),
      footerBtnY: (() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '上一题')
        return b ? Math.round(b.getBoundingClientRect().y) : null
      })(),
      actionRowY: (() => {
        const row = [...document.querySelectorAll('div')].find((d) => typeof d.className === 'string' && d.className.includes('border-t') && d.className.includes('shrink-0'))
        return row ? { y: Math.round(row.getBoundingClientRect().y), h: Math.round(row.getBoundingClientRect().height) } : null
      })(),
    } : null,
    docScrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
    rows,
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + '/test/question', { waitUntil: 'networkidle', timeout: 30000 })
  await sleep(1000)
  const r = await page.evaluate(PROBE, PARENT_CLS)
  console.log(`innerH=${r.innerH}  html=${r.htmlBoxSizing}  body=${r.bodyBoxSizing}  --spacing-shell-total=${r.tokenShellTotal}  --spacing-shell=${r.tokenShell}`)
  console.log(`全局 * 重置规则: ${r.resetRules.length ? r.resetRules.join(' | ') : '（无）'}`)
  console.log('\n--- 探针行 ---')
  for (const x of r.rows) {
    console.log(`[${x.label}] box-sizing=${x.boxSizing} computedH=${x.computedHeight} inlineH=${x.inlineHeight} pt=${x.padTop} pb=${x.padBottom} rectH=${x.rectH} → ${x.contentBox}`)
  }
  console.log('\n--- 真实根容器 ---')
  console.log(JSON.stringify(r.root, null, 2))
  console.log(`docScrollH=${r.docScrollH}`)
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
