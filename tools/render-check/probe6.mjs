/**
 * probe6.mjs — 落地探针：在真页面上建临时元素取"工具类真实取值"，并读首页关键元素。
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/probe6.mjs
 */
import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const INIT = `window.localStorage.setItem('ai_job_helper:token', JSON.stringify('rc.mock.jwt.token'));`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PROBE = `(() => {
  const classes = ['bg-secondary','text-secondary','bg-accent','bg-primary-soft','bg-canvas','bg-surface-container','border-border','text-on-surface-variant','bg-surface-container-low'];
  const host = document.createElement('div');
  host.style.position = 'fixed'; host.style.left = '-9999px'; host.style.top = '0';
  document.body.appendChild(host);
  const utils = {};
  for (const c of classes) {
    const el = document.createElement('div');
    el.className = c;
    host.appendChild(el);
    const cs = getComputedStyle(el);
    utils[c] = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : cs.color;
  }
  host.remove();

  const bar = document.querySelector('main [style*="width"]');
  const pill = document.querySelector('header a');
  const amberTitle = [...document.querySelectorAll('main span')].find(e => e.textContent.trim() === 'AI 发现与画像动态');
  const amberCaption = [...document.querySelectorAll('main span')].find(e => e.textContent.includes('按微步前进中'));
  const sparkle = document.querySelector('main svg.text-secondary');
  const style = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { color: cs.color, bg: cs.backgroundColor, fs: cs.fontSize, fw: cs.fontWeight } };
  return {
    utils,
    heroBar: bar ? { style: bar.getAttribute('style'), bg: getComputedStyle(bar).backgroundColor } : null,
    pill: pill ? { text: pill.textContent.trim().slice(0,8), ...style(pill) } : null,
    amberTitle: style(amberTitle),
    amberCaption: style(amberCaption),
    sparkleIcon: sparkle ? getComputedStyle(sparkle).color : null,
    rootVars: (() => { const cs = getComputedStyle(document.documentElement); const out={}; for (const k of ['--secondary','--color-secondary','--accent','--color-accent','--primary-soft','--color-primary-soft']) out[k]=cs.getPropertyValue(k).trim(); return out })(),
  };
})()`

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(INIT)
  await page.goto(BASE_URL + '/', { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(1500)
  console.log(JSON.stringify(await page.evaluate(PROBE), null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
