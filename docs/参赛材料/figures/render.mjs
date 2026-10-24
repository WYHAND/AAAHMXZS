import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pw from '../../..//tools/render-check/node_modules/playwright-core/index.js'
const { chromium } = pw

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EDGE = process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const pages = [
  ['fig-multimodel.html', 'fig-multimodel.png', 1500],
  ['fig-testing.html', 'fig-testing.png', 1500],
  ['fig-architecture.html', 'fig-architecture.png', 1500],
]

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
for (const [html, png, width] of pages) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await page.goto('file:///' + path.join(__dirname, html).replace(/\\/g, '/'), { waitUntil: 'load' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(__dirname, png), fullPage: true })
  await ctx.close()
  console.log('rendered', png)
}
await browser.close()
