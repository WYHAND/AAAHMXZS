/**
 * compare-shot.mjs — 把三套主题并排拼成一张总览图（Review 面板一次只能显示一个文件）。
 * 用法：node tools/render-check/compare-shot.mjs
 * 产物：design-preview/compare.png
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../design-preview')
const EDGE = process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 2136, height: 1200 }, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(path.join(ROOT, 'compare.html')).href, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const height = await page.evaluate(() => document.body.scrollHeight)
await page.screenshot({
  path: path.join(ROOT, 'compare.png'),
  clip: { x: 0, y: 0, width: 2136, height },
})
console.log('ok -> design-preview/compare.png')
await browser.close()
