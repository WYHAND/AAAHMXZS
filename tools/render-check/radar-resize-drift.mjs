/**
 * radar-resize-drift.mjs — 画像雷达「窗口缩放时色块漂移」探针（只读，不改代码）。
 *
 * 根因（recharts 3.10.1，已读源码）：
 *   Radar 的数据多边形默认 `isAnimationActive: 'auto'`。`AnimatedItems` 用
 *   `useAnimationId(props)` **按引用**比较，props（含 points）一变就换 key → 重放
 *   1500ms 补间。窗口缩放会改 points 引用 → 网格即时重排、多边形却从旧几何慢慢
 *   「漂」向新几何；持续拖动窗口时它永远追不上外框 —— 就是看到的色块乱飘。
 *
 * 量什么：把最外圈六边形（PolarAngleAxis.axisLine）与数据多边形（Radar）的顶点抽出来。
 *   - grid*：外框顶点（缩放后应即时落位）
 *   - poly*：数据多边形顶点
 *   - lag  ：每个顶点与「最终稳定位置」的最大距离（px）。缩放后应立刻为 0；
 *            带重放动画时会用 ~1.5s 慢慢收敛 —— 这就是漂移量。
 *
 * 用法：
 *   RC_BASE_URL=http://127.0.0.1:4173 node tools/render-check/radar-resize-drift.mjs
 *   RC_TAG=before- 给截图/JSON 加前缀
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = process.env.RC_BASE_URL ?? 'http://127.0.0.1:4173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'
const TAG = process.env.RC_TAG ?? ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 抽出 path 的 d 里的折线顶点 [{x,y}] */
function parseVerts(d) {
  if (!d) return []
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
  const pts = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
  return pts
}

const SAMPLE = () => {
  const root = [...document.querySelectorAll('[aria-label^="画像雷达"]')].pop()
  if (!root) return { error: 'no-radar' }
  const svg = root.querySelector('svg')
  const grid = root.querySelector('path.recharts-polar-angle-axis-line')
  const poly = root.querySelector('.recharts-radar-polygon path.recharts-polygon')
  return {
    svgW: svg ? +svg.getAttribute('width') : null,
    svgH: svg ? +svg.getAttribute('height') : null,
    gridD: grid ? grid.getAttribute('d') : null,
    polyD: poly ? poly.getAttribute('d') : null,
  }
}

const maxLag = (a, b) => {
  if (!a?.length || !b?.length) return null
  const n = Math.min(a.length, b.length)
  let m = 0
  for (let i = 0; i < n; i++) m = Math.max(m, Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y))
  return +m.toFixed(2)
}

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const out = { baseUrl: BASE_URL, samples: [] }
  const preview = path.join(__dirname, 'audit', 'preview')
  await mkdir(preview, { recursive: true })

  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: 'zh-CN' })
  const page = await ctx.newPage()
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(2000)
  await page.screenshot({ path: path.join(preview, `${TAG}resize-small.png`) })

  // 从「缩小」切到「放大」——一次性把视口放大
  const resizeAt = Date.now()
  await page.setViewportSize({ width: 1700, height: 1000 })
  const marks = [0, 60, 150, 300, 500, 800, 1200, 1700, 2400]
  for (const ms of marks) {
    const wait = ms - (Date.now() - resizeAt)
    if (wait > 0) await sleep(wait)
    out.samples.push({ t: Date.now() - resizeAt, ...(await page.evaluate(SAMPLE)) })
  }
  await page.screenshot({ path: path.join(preview, `${TAG}resize-large.png`) })

  await browser.close()

  // 以最后一次采样为「最终稳定几何」
  const last = out.samples[out.samples.length - 1]
  const finalPoly = parseVerts(last.polyD)
  const finalGrid = parseVerts(last.gridD)
  for (const s of out.samples) {
    s.polyLag = maxLag(parseVerts(s.polyD), finalPoly)
    s.gridLag = maxLag(parseVerts(s.gridD), finalGrid)
  }

  const polyLags = out.samples.map((s) => s.polyLag ?? 0)
  const gridLags = out.samples.map((s) => s.gridLag ?? 0)
  const mid = out.samples.find((s) => s.t >= 150 && s.t <= 400)
  const summary = {
    baseUrl: BASE_URL,
    samples: out.samples.map(({ polyD, gridD, ...rest }) => rest),
    verdict: {
      maxPolyLag: Math.max(...polyLags),
      maxGridLag: Math.max(...gridLags),
      polyLagAt150_400: mid?.polyLag ?? null,
      finalPolyLag: polyLags[polyLags.length - 1] ?? null,
      // 判据：缩放后 150–400ms 内多边形就贴合最终位置（<2px），且外框本身即时稳定
      snapsImmediately: (mid?.polyLag ?? 999) < 2,
    },
  }
  await writeFile(
    path.join(__dirname, 'audit', `${TAG}radar-resize-drift.json`),
    JSON.stringify(summary, null, 2),
  )
  console.log(`TAG=${TAG || '(none)'}`)
  for (const s of out.samples) {
    console.log(
      `t=${String(s.t).padStart(4)}ms  svg=${s.svgW}x${s.svgH}  polyLag=${s.polyLag}px  gridLag=${s.gridLag}px  polyVerts=${parseVerts(s.polyD).length}`,
    )
  }
  console.log('verdict:', JSON.stringify(summary.verdict))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
