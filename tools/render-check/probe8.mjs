/**
 * probe8.mjs — 逐项打印工具类的 color / backgroundColor 两项（避免探针自己写错用哪一项）。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe8.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const classes = ['text-secondary','bg-secondary','bg-primary-soft','text-caption-foreground','bg-accent','text-on-surface'];
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(host);
  const rows = {};
  for (const c of classes) {
    const el = document.createElement('div');
    el.textContent = 'x';
    el.className = c;
    host.appendChild(el);
    const cs = getComputedStyle(el);
    rows[c] = { color: cs.color, backgroundColor: cs.backgroundColor };
  }
  host.remove();
  const root = getComputedStyle(document.documentElement);
  const vars = {};
  for (const k of ['--secondary','--color-secondary','--primary-soft','--color-primary-soft','--border','--color-border','--accent','--color-accent']) {
    vars[k] = root.getPropertyValue(k).trim() || '(未定义)';
  }
  // 样式表自检：把 CSSOM 里 .text-secondary / .bg-secondary 的真实声明打出来
  const rules = {};
  for (const sheet of document.styleSheets) {
    let list
    try { list = [...sheet.cssRules] } catch { continue }
    for (const rule of list) {
      const sel = rule.selectorText
      if (!sel) continue
      for (const t of ['text-secondary','bg-secondary']) {
        if (sel.split(',').some((s) => s.trim() === '.' + t) && !rules[t]) {
          rules[t] = rule.style.cssText
        }
      }
    }
  }
  // 直接读 :root 上 --secondary 的解析值（不经工具类）
  return { rows, vars, rules, resolvedSecondaryOnRoot: getComputedStyle(document.documentElement).getPropertyValue('--secondary').trim() };
})()`


async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1200)
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
