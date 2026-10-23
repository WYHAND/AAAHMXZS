/**
 * theme-preview.mjs — 把 design-preview/mockup.html 的三套主题渲染成 PNG。
 *
 * 用法：node tools/render-check/theme-preview.mjs
 * 产物：design-preview/theme-a.png / theme-b.png / theme-c.png
 * 只为"选配色"服务，不参与项目构建，随时可删。
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../design-preview')
const EDGE = process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1.5,
  locale: 'zh-CN',
})

for (const theme of ['a', 'b', 'c']) {
  const page = await ctx.newPage()
  const url = pathToFileURL(path.join(ROOT, 'mockup.html')).href + `?theme=${theme}`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
  const out = path.join(ROOT, `theme-${theme}.png`)
  await page.screenshot({ path: out, fullPage: true })
  console.log(`ok -> ${path.relative(process.cwd(), out)}`)
  await page.close()
}

await browser.close()
