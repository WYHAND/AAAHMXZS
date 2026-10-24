import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pw from '../../..//tools/render-check/node_modules/playwright-core/index.js'
const { chromium } = pw
const dir = path.dirname(fileURLToPath(import.meta.url))
const pdf = path.resolve(dir, '..', 'check.pdf')
const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
for (const n of [1, 3]) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } })
  await page.goto('file:///' + pdf.replace(/\\/g, '/') + `#page=${n}&zoom=90`, { waitUntil: 'load' })
  await page.waitForTimeout(2200)
  await page.screenshot({ path: path.join(dir, `check-${n}.png`) })
  await page.close()
}
await browser.close()
console.log('ok')
