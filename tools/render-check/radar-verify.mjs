/**
 * radar-verify.mjs — 「画像雷达」可见性改动的**独立复核**（像素 + 几何，不复述 recharts props）。
 *
 * 为什么要有这一层：实现方交的是一张「computed style 表」（读的是 DOM 属性），
 * 而属性证明不了「用户到底看不看得见六边形」。这里用**渲染出来的像素**和
 * **渲染出来的几何**独立验：
 *
 *   1. 网格可见性（核心）：从极坐标中心（= 已渲染网格组的包围盒中心，不是读 prop）
 *      朝 6 条轴各打一条射线，在**最外圈六边形所在的半径带**里逐像素找最暗那一档，
 *      再跟卡片底色算 WCAG 对比度。6 个方向都必须能测到，且 ≥ 1.4:1。
 *      —— 采样一律在 PNG 像素上做；卡片底色取卡片区域内出现次数最多的颜色（众数），
 *         不读 CSS 变量。AA 补偿：每个采样点取 3×3 邻域的最小明度（±1px，脚本里另报原始值）。
 *   2. 数据多边形描边：沿**已渲染**的 `path.recharts-radar-polygon` 采样
 *      （getTotalLength/getPointAtLength + getScreenCTM 转页面坐标），
 *      报描边像素对卡片底色的对比度（≥ 10:1）。
 *   3. 轴标签：1100/1200/1440/1920/390 下 6 个轴标签的 bounding box 是否完整落在
 *      卡片内边距盒内、是否两两不重叠、字号是否仍是 13px。
 *   4. 回归 1：首页 compact 雷达 —— `/` 1440 整页与改动前基线做像素差异，
 *      雷达图区域以外应基本无差异（允许区内差异，区内差异率一并报出）。
 *   5. 回归 2：1440/1200 下「雷达卡底边 − 最后一个内容元素底边」= 20px（±1）。
 *   6. 静态：`tsc -p tsconfig.app.json --noEmit` 必须无输出；
 *      `oxlint` 只允许报既有的那 2 条 react(set-state-in-effect)。
 *
 * 用法（**不要另起 dev server**，默认打已有的 5199）：
 *   node tools/render-check/radar-verify.mjs
 *
 * 环境变量：
 *   RC_BASE_URL       默认 http://localhost:5199
 *   RC_EDGE           默认本机 Edge
 *   RC_HOME_BASELINE  首页整页基线路径（默认在 preview/ 下按候选名找，见 HOME_BASELINE_CANDIDATES）
 *
 * 产物（全部落在 tools/render-check/audit/preview/，一律以 radar-verify- 开头）：
 *   radar-verify-profile-<w>.png   各视口 /profile 整页截图
 *   radar-verify-radar-1440.png    1440 下雷达卡元素截图（人眼看的证据）
 *   radar-verify-home-1440.png     / 整页截图
 *   radar-verify-report.json       汇总（含每项判定与全部数字）
 *
 * 纪律：本脚本只读渲染结果，不碰 src/。
 */
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

import { chromium } from 'playwright-core'

import { installApi } from './audit-mock.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, 'audit', 'preview')
const FRONTEND = path.join(__dirname, '..', '..', 'frontend')

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TOKEN_KEY = 'ai_job_helper:token'

/** 六个维度；顺序与 ProfileRadar 的轴线一致，用于把 <text> 认出来 */
const DIMENSIONS = ['兴趣', '能力', '技能', '痛点', '焦虑', '认知']
const PANEL_TITLE = '画像雷达'

/**
 * 第 4 项用的首页基线候选（按优先级）。
 *
 * 任务书最早点名 `after-home-full.png`，但那个文件**不存在**（已被删除）；
 * 改动方为此在改动前另存了真基线 `before-home-1440.png`（1440×1282），
 * 它就是第 4 项要用的基线，所以排第一。命中哪个会在报告里写清楚（含 mtime）。
 */
const HOME_BASELINE_CANDIDATES = [
  'before-home-1440.png',
  'before-home-full.png',
  'after-home-full.png',
  'home-1440.png',
  'home-after-full.png',
]

/** 判定阈值 —— 全部写在这里，报告时直接引用 */
const GATE = {
  /** 第 1 项：最外圈六边形对卡片底色的对比度 */
  gridContrast: 1.4,
  /** 第 2 项：数据多边形描边对卡片底色的对比度 */
  polyContrast: 10,
  /** 第 3 项：轴标签字号 */
  labelFontPx: 13,
  /** 第 5 项：雷达卡底边到最后一个内容元素底边的距离 */
  bottomWhitespace: 20,
  bottomWhitespaceTol: 1,
  /** 第 4 项：雷达图区域**之外**允许的差异像素占比 */
  offRegionDiffRatio: 0.001,
  /** 第 4 项：像素差异的单通道容差（0-255） */
  diffTolerance: 8,
  /** 第 6 项：oxlint 允许的既有告警条数 */
  oxlintAllowed: 2,
}

/** 采样参数 */
const PIXEL = {
  /** 射线步长（px） */
  step: 0.5,
  /** 明度取最小值的邻域半径（px）—— AA 补偿 */
  windowRadius: 1,
  /*
   * 最外圈六边形所在半径带（相对 R）——轴方向打的是顶点。
   * 上界必须收紧到 1.03R：**轴标签文字就落在 ≈1.06R**（recharts 把 tick 放在
   * outerRadius+8px，实测 134.4px/126.4px = 1.063），上界一旦放到 1.08R 就会
   * 量到文字字形（实测把"兴趣"量成 5.64:1），那证明的是"字画出来了"不是"六边形画出来了"。
   * 外圈六边形（含 axisLine 1.5px 描边）在 R±0.8px 内，1.03R 留了 4px 余量。
   */
  outerBandAxis: [0.92, 1.03],
  /** 最外圈六边形所在半径带（相对 R）——轴之间打的是边（边心距 = cos30° ≈ 0.866R） */
  outerBandEdge: [0.78, 0.96],
  /** 内圈（环 + 辐条）所在半径带（相对 R），仅作"网格线本身有多暗"的参考 */
  innerBandAxis: [0.3, 0.5],
  /** 盒内判定容差（px） */
  boxTol: 0.5,
  /** 两两不重叠判定容差（px²） */
  overlapTol: 0.25,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ============================================================================
 * 一、PNG 解码（零依赖，node:zlib + 手写反滤波）
 *    Chromium 截图是 8bit、非隔行、ct=2(RGB) 或 ct=6(RGBA)；
 *    统一展开成 RGBA，方便后面按 (x,y) 取像素。
 * ==========================================================================*/

function unfilter(type, line, prev, bpp) {
  const n = line.length
  for (let i = 0; i < n; i += 1) {
    const a = i >= bpp ? line[i - bpp] : 0
    const b = prev[i]
    const c = i >= bpp ? prev[i - bpp] : 0
    switch (type) {
      case 0:
        break
      case 1:
        line[i] = (line[i] + a) & 255
        break
      case 2:
        line[i] = (line[i] + b) & 255
        break
      case 3:
        line[i] = (line[i] + ((a + b) >> 1)) & 255
        break
      case 4: {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        line[i] = (line[i] + pred) & 255
        break
      }
      default:
        throw new Error(`PNG 不支持的滤波类型 ${type}`)
    }
  }
}

function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + len
  }
  if (bitDepth !== 8) throw new Error(`PNG 只支持 8bit，实为 ${bitDepth}`)
  if (interlace !== 0) throw new Error('PNG 不支持隔行')
  if (colorType !== 2 && colorType !== 6) throw new Error(`PNG 只支持 ct=2/6，实为 ${colorType}`)
  const channels = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride)
  let p = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p]
    p += 1
    const line = Buffer.from(raw.subarray(p, p + stride))
    p += stride
    if (filter !== 0) unfilter(filter, line, prev, channels)
    for (let x = 0; x < width; x += 1) {
      const s = x * channels
      const d = (y * width + x) * 4
      out[d] = line[s]
      out[d + 1] = line[s + 1]
      out[d + 2] = line[s + 2]
      out[d + 3] = channels === 4 ? line[s + 3] : 255
    }
    prev = line
  }
  return { width, height, data: out }
}

/* ============================================================================
 * 二、像素工具：取色 / 明度 / WCAG 对比度 / 众数底色 / 邻域最暗
 * ==========================================================================*/

const at = (img, x, y) => {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

const toLinear = (c) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const luminance = ([r, g, b]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 区域内出现次数最多的颜色 = 卡片底色（纯像素推导，不读 CSS 变量） */
function modalColor(img, region) {
  const x0 = Math.max(0, Math.round(region.x))
  const y0 = Math.max(0, Math.round(region.y))
  const x1 = Math.min(img.width, Math.round(region.x + region.w))
  const y1 = Math.min(img.height, Math.round(region.y + region.h))
  const counts = new Map()
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * img.width + x) * 4
      const key = (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const total = (x1 - x0) * (y1 - y0)
  return {
    color: [(sorted[0][0] >> 16) & 255, (sorted[0][0] >> 8) & 255, sorted[0][0] & 255],
    share: sorted[0][1] / total,
    top3: sorted.slice(0, 3).map(([k, n]) => ({
      rgb: [(k >> 16) & 255, (k >> 8) & 255, k & 255],
      share: n / total,
    })),
  }
}

/** 采样点 3×3 邻域里的最暗像素（AA 补偿；rad=0 时就是该点本身） */
function minLumNear(img, cx, cy, rad) {
  let best = null
  for (let dy = -rad; dy <= rad; dy += 1) {
    for (let dx = -rad; dx <= rad; dx += 1) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      const c = at(img, x, y)
      const l = luminance(c)
      if (!best || l < best.lum) best = { lum: l, color: c, x, y }
    }
  }
  return best
}

/**
 * 从 (cx,cy) 沿数学角 theta（弧度，逆时针为正）打一条射线，
 * 只在半径带 [r0,r1] 内取「最暗那一档」。
 * 屏幕 y 轴向下，所以 y = cy - sin(theta)*r。
 */
function rayBandDarkest(img, cx, cy, theta, r0, r1) {
  let best = null
  let bestRaw = null
  for (let r = r0; r <= r1; r += PIXEL.step) {
    const x = Math.round(cx + Math.cos(theta) * r)
    const y = Math.round(cy - Math.sin(theta) * r)
    if (x < 1 || y < 1 || x >= img.width - 1 || y >= img.height - 1) continue
    const w = minLumNear(img, x, y, PIXEL.windowRadius)
    if (w && (!best || w.lum < best.lum)) best = { lum: w.lum, color: w.color, r }
    const rawColor = at(img, x, y)
    const rawLum = luminance(rawColor)
    if (!bestRaw || rawLum < bestRaw.lum) bestRaw = { lum: rawLum, color: rawColor, r }
  }
  return { best, bestRaw }
}

/** 整条射线（0 → rMax）里的最暗那一档，仅作背景数字 */
function rayDarkest(img, cx, cy, theta, rMax) {
  let best = null
  for (let r = 1; r <= rMax; r += PIXEL.step) {
    const x = Math.round(cx + Math.cos(theta) * r)
    const y = Math.round(cy - Math.sin(theta) * r)
    if (x < 1 || y < 1 || x >= img.width - 1 || y >= img.height - 1) continue
    const w = minLumNear(img, x, y, PIXEL.windowRadius)
    if (w && (!best || w.lum < best.lum)) best = { lum: w.lum, color: w.color, r }
  }
  return best
}

/* ============================================================================
 * 三、页面侧几何采集（页面坐标；采集前把页面滚到顶，所以页面坐标 = 视口坐标）
 * ==========================================================================*/

/** 雷达卡里的东西：面板盒、内边距、图表容器、已渲染网格组的包围盒、轴线、多边形路径点、轴标签 */
function collectRadarGeometry(page) {
  return page.evaluate(
    ({ DIMENSIONS, PANEL_TITLE }) => {
      const box = (el) => {
        const r = el.getBoundingClientRect()
        const x = r.x + window.scrollX
        const y = r.y + window.scrollY
        return {
          x,
          y,
          w: r.width,
          h: r.height,
          left: x,
          top: y,
          right: x + r.width,
          bottom: y + r.height,
          cx: x + r.width / 2,
          cy: y + r.height / 2,
        }
      }
      const h2 = Array.from(document.querySelectorAll('h2')).find(
        (h) => (h.textContent ?? '').trim() === PANEL_TITLE,
      )
      const panel = h2 ? h2.closest('[data-slot="panel"]') : null
      if (!panel) return { error: `找不到 h2「${PANEL_TITLE}」的 [data-slot="panel"] 祖先` }
      const cs = getComputedStyle(panel)
      const panelRect = box(panel)
      const pad = {
        top: parseFloat(cs.paddingTop) || 0,
        right: parseFloat(cs.paddingRight) || 0,
        bottom: parseFloat(cs.paddingBottom) || 0,
        left: parseFloat(cs.paddingLeft) || 0,
      }
      const chart = panel.querySelector('[role="img"]')
      const grid = panel.querySelector('.recharts-polar-grid')
      /*
       * 数据多边形的**描边**在 path 上：recharts 3.10 把 class `recharts-radar-polygon`
       * 挂在包一层的 <g> 上，真正带 d= 的是它内部的 `path.recharts-polygon`
       * （见 audit/radar-lines-after.txt：idx 51 = g.recharts-radar-polygon，
       *  idx 52 = path.recharts-polygon）。<g> 上没有 getTotalLength，
       * 所以必须落到 path 上；且**不能**用 `path.recharts-polygon` 单独选 ——
       * PolarAngleAxis 的 axisLine 也是 `recharts-polygon`（idx 23）且在 DOM 里更靠前。
       * 依次尝试，取第一个真的是 path（有 getTotalLength）的。
       */
      const polyCandidates = [
        '.recharts-radar-polygon path',
        'path.recharts-radar-polygon',
        '.recharts-radar-polygon',
      ]
      let poly = null
      let polySelector = null
      for (const sel of polyCandidates) {
        const el = panel.querySelector(sel)
        if (el && typeof el.getTotalLength === 'function') {
          poly = el
          polySelector = sel
          break
        }
      }
      const radialLines = Array.from(panel.querySelectorAll('.recharts-polar-grid-angle line')).map(
        (l) => ({
          x1: Number(l.getAttribute('x1')),
          y1: Number(l.getAttribute('y1')),
          x2: Number(l.getAttribute('x2')),
          y2: Number(l.getAttribute('y2')),
        }),
      )
      let polyPoints = []
      let polyLength = 0
      if (poly) {
        polyLength = poly.getTotalLength()
        const ctm = poly.getScreenCTM()
        const N = 720
        for (let i = 0; i < N; i += 1) {
          const pt = poly.getPointAtLength((i / N) * polyLength)
          const sp = pt.matrixTransform(ctm)
          polyPoints.push({ x: sp.x + window.scrollX, y: sp.y + window.scrollY })
        }
      }
      const labels = DIMENSIONS.map((dimension) => {
        const el = Array.from(panel.querySelectorAll('svg text')).find(
          (t) => (t.textContent ?? '').trim() === dimension,
        )
        if (!el) return { dimension, missing: true }
        return {
          dimension,
          missing: false,
          ...box(el),
          fontSize: getComputedStyle(el).fontSize,
        }
      })
      // 第 5 项：面板内最后一个叶子内容元素（不进 SVG）
      let leaf = panel
      let guard = 0
      while (
        leaf.lastElementChild &&
        !(leaf.lastElementChild instanceof SVGElement) &&
        guard < 20
      ) {
        leaf = leaf.lastElementChild
        guard += 1
      }
      return {
        error: null,
        panelRect,
        pad,
        chartRect: chart ? box(chart) : null,
        gridRect: grid ? box(grid) : null,
        radialLines,
        polyPresent: Boolean(poly),
        polySelector,
        polyLength,
        polyPoints,
        labels,
        leafRect: leaf === panel ? null : box(leaf),
        leafTag: leaf === panel ? null : String(leaf.tagName).toLowerCase(),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      }
    },
    { DIMENSIONS, PANEL_TITLE },
  )
}

/** 首页 compact 雷达：找 aria-label 以「画像雷达」开头的 role=img 容器 */
function collectHomeRadarRegion(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect()
      return {
        x: r.x + window.scrollX,
        y: r.y + window.scrollY,
        w: r.width,
        h: r.height,
        left: r.x + window.scrollX,
        top: r.y + window.scrollY,
        right: r.right + window.scrollX,
        bottom: r.bottom + window.scrollY,
      }
    }
    const imgs = Array.from(document.querySelectorAll('[role="img"]')).filter((el) =>
      (el.getAttribute('aria-label') ?? '').startsWith('画像雷达'),
    )
    const el = imgs[0] ?? null
    return {
      found: Boolean(el),
      count: imgs.length,
      rect: el ? box(el) : null,
      pageHeight: document.documentElement.scrollHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    }
  })
}

/* ============================================================================
 * 四、第 1 / 第 2 项：像素判定
 * ==========================================================================*/

const deg = (d) => (d * Math.PI) / 180
const norm360 = (d) => ((d % 360) + 360) % 360

/**
 * 第 1 项：6 条轴方向上的最外圈六边形可见性。
 *  - 中心取**已渲染网格组包围盒的中心**（几何推导，不读 recharts prop）
 *  - R 取包围盒长边的 1/2（正六边形任一起见：max(w,h) = 2R）
 *  - 方向优先取**已渲染的径向网格线**（.recharts-polar-grid-angle line）的角度；
 *    没有径向线时退化成用轴标签中心的方向
 */
function checkGridPixels(img, geo, cardBg) {
  const g = geo.gridRect
  if (!g) return { pass: false, reason: '找不到 .recharts-polar-grid（网格没渲染出来）' }
  const cx = g.cx
  const cy = g.cy
  const R = Math.max(g.w, g.h) / 2
  if (!(R > 20)) {
    return {
      pass: false,
      reason: `已渲染网格组包围盒太小（${g.w.toFixed(1)}×${g.h.toFixed(1)}），网格多半没画出来`,
    }
  }
  const labelAngles = {}
  for (const l of geo.labels) {
    if (l.missing) continue
    labelAngles[l.dimension] = norm360((Math.atan2(-(l.cy - cy), l.cx - cx) * 180) / Math.PI)
  }
  const lineAngles = geo.radialLines.map((l) =>
    norm360((Math.atan2(-(l.y2 - l.y1), l.x2 - l.x1) * 180) / Math.PI),
  )
  /*
   * 数据多边形在每条轴方向上的半径。
   * 归一化之后必有一条轴 = 100（= 顶到 R），那条轴的外圈带量到的是**数据描边**（很黑），
   * 不是网格 —— 统计里要把它单独拎出来，否则会把"描边很黑"算成"网格看清了"。
   * 半径由已渲染的多边形路径点算出来（与 checkPolygonStroke 同一份点）。
   */
  const dataRadius = {}
  for (const p of geo.polyPoints) {
    const r = Math.hypot(p.x - cx, -(p.y - cy))
    if (r < 1) continue
    const ang = norm360((Math.atan2(-(p.y - cy), p.x - cx) * 180) / Math.PI)
    for (const dim of Object.keys(labelAngles)) {
      const a = labelAngles[dim]
      const d = Math.min(Math.abs(ang - a), 360 - Math.abs(ang - a))
      if (d <= 12 && (!(dim in dataRadius) || r > dataRadius[dim])) dataRadius[dim] = r
    }
  }
  const axes = geo.labels.map((l) => {
    let angle = labelAngles[l.dimension]
    let source = 'label'
    if (lineAngles.length >= 6 && angle !== undefined) {
      let best = null
      for (const a of lineAngles) {
        const d = Math.min(Math.abs(a - angle), 360 - Math.abs(a - angle))
        if (!best || d < best.d) best = { a, d }
      }
      if (best && best.d <= 20) {
        angle = best.a
        source = 'radial-line'
      }
    }
    if (angle === undefined) {
      return {
        dimension: l.dimension,
        angleDeg: null,
        angleSource: 'missing-label',
        labelPresent: false,
        outerBandAxis: null,
        outerBandEdgeMid: null,
        innerBand: null,
        fullRayDarkest: null,
      }
    }
    const band = PIXEL.outerBandAxis
    const st = rayBandDarkest(img, cx, cy, deg(angle), band[0] * R, band[1] * R)
    const mid = rayBandDarkest(img, cx, cy, deg(angle + 30), PIXEL.outerBandEdge[0] * R, PIXEL.outerBandEdge[1] * R)
    const inner = rayBandDarkest(
      img,
      cx,
      cy,
      deg(angle),
      PIXEL.innerBandAxis[0] * R,
      PIXEL.innerBandAxis[1] * R,
    )
    const full = rayDarkest(img, cx, cy, deg(angle), R * 1.02)
    const pick = (s) =>
      s && s.best
        ? {
            contrast: contrastRatio(s.best.color, cardBg),
            contrastRaw: contrastRatio(s.bestRaw.color, cardBg),
            radiusRatio: R ? s.best.r / R : null,
            rgb: s.best.color,
          }
        : null
    // rayDarkest 直接返回采样点本身（没有 best/bestRaw 包装），单独包一层
    const pickSample = (s) =>
      s
        ? {
            contrast: contrastRatio(s.color, cardBg),
            contrastRaw: contrastRatio(s.color, cardBg),
            radiusRatio: R ? s.r / R : null,
            rgb: s.color,
          }
        : null
    return {
      dimension: l.dimension,
      angleDeg: angle,
      angleSource: source,
      labelPresent: !l.missing,
      dataRadiusRatio: dataRadius[l.dimension] ? dataRadius[l.dimension] / R : null,
      outerBandAxis: pick(st),
      outerBandEdgeMid: pick(mid),
      innerBand: pick(inner),
      fullRayDarkest: pickSample(full),
    }
  })

  const measurable = (a) => a.outerBandAxis && a.outerBandAxis.contrast >= GATE.gridContrast
  const edgeMeasurable = (a) =>
    a.outerBandEdgeMid && a.outerBandEdgeMid.contrast >= GATE.gridContrast
  const axisOk = axes.filter(measurable).length
  const edgeOk = axes.filter(edgeMeasurable).length
  /**
   * 带内可能混进"数据描边"的轴：只要该轴的数据顶点半径落在（或贴近）
   * 外圈带的范围内，这条读数就很可能是 18:1 的描边而不是 4.5:1 的网格。
   * 实测 技能 dataR=0.932 正好压在外圈带下沿 0.92 上 —— 它那条 18.43 是描边，不是网格。
   * 所以"纯网格"证据只取数据顶点明显在带外（< 带下沿−0.02）的轴。
   */
  const bandLo = PIXEL.outerBandAxis[0]
  const contaminated = axes.filter(
    (a) => a.dataRadiusRatio !== null && a.dataRadiusRatio >= bandLo - 0.02,
  )
  /** 数据多边形顶到 R 的轴（= 100 那一根） */
  const saturated = axes.filter((a) => a.dataRadiusRatio !== null && a.dataRadiusRatio > 0.97)
  const pureGrid = axes.filter((a) => !contaminated.includes(a))
  const darkest = axes
    .map((a) => (a.outerBandAxis ? a.outerBandAxis.contrast : 0))
    .reduce((m, v) => Math.min(m, v), Infinity)
  const darkestPureGrid = pureGrid.length
    ? pureGrid.map((a) => a.outerBandAxis.contrast).reduce((m, v) => Math.min(m, v), Infinity)
    : null

  return {
    pass:
      axes.length === 6 &&
      axes.every((a) => a.labelPresent && measurable(a)) &&
      darkestPureGrid !== null &&
      darkestPureGrid >= GATE.gridContrast,
    center: { cx, cy, source: 'bbox-of-.recharts-polar-grid' },
    outerRadiusPx: R,
    gridBBox: { w: g.w, h: g.h },
    radialLineCount: geo.radialLines.length,
    cardBg,
    axes,
    axisDirectionsMeasured: `${axisOk}/6`,
    edgeMidDirectionsMeasured: `${edgeOk}/6`,
    saturatedAxes: saturated.map((a) => a.dimension),
    /** 外圈带里可能混进数据描边的轴（读到的 18:1 是描边，不是网格） */
    bandContaminatedAxes: contaminated.map((a) => a.dimension),
    gridDarkestContrast: darkest,
    gridDarkestContrastPureGrid: darkestPureGrid,
    /** 内圈（环 + 辐条）那条带上的最暗一档：这是"网格线本身"的可见度，注意可能含数据填充 */
    innerBandDarkestContrast: axes
      .map((a) => (a.innerBand ? a.innerBand.contrast : 0))
      .reduce((m, v) => Math.min(m, v), Infinity),
    pureGridDirections: pureGrid.map((a) => a.dimension),
    gate: GATE.gridContrast,
    edgeMidGatePass: edgeOk === 6,
    conclusion:
      axisOk === 6
        ? `6/6 方向都测到最外圈六边形；最暗一档 ${darkest.toFixed(2)}:1` +
          (darkestPureGrid === null
            ? '（六轴全被数据多边形顶满，无法把网格与描边分开）'
            : `，其中不含"顶满那条轴"的 ${darkestPureGrid.toFixed(2)}:1（阈值 ${GATE.gridContrast}）`)
        : `只有 ${axisOk}/6 个方向测到最外圈六边形（最暗一档 ${darkest.toFixed(2)}:1）`,
  }
}
/** 第 2 项：沿已渲染的多边形描边采样，报描边 vs 卡片底色 */
function checkPolygonStroke(img, geo, cardBg) {
  if (!geo.polyPresent || !geo.polyPoints.length) {
    return { pass: false, reason: '找不到 path.recharts-radar-polygon（数据多边形没渲染出来）' }
  }
  let darkest = null
  let sum = 0
  for (const p of geo.polyPoints) {
    const w = minLumNear(img, Math.round(p.x), Math.round(p.y), PIXEL.windowRadius)
    if (!w) continue
    sum += w.lum
    if (!darkest || w.lum < darkest.lum) darkest = { lum: w.lum, color: w.color }
  }
  const c = contrastRatio(darkest.color, cardBg)
  const meanLum = sum / geo.polyPoints.length
  const meanContrast = (Math.max(meanLum, luminance(cardBg)) + 0.05) / (Math.min(meanLum, luminance(cardBg)) + 0.05)
  return {
    pass: c >= GATE.polyContrast,
    samples: geo.polyPoints.length,
    cardBg,
    strokeDarkestRgb: darkest.color,
    strokeContrast: c,
    strokeMeanContrast: meanContrast,
    gate: GATE.polyContrast,
  }
}

/* ============================================================================
 * 五、第 3 / 第 5 项：DOM 几何判定
 * ==========================================================================*/

function checkAxisLabels(geo) {
  const p = geo.panelRect
  const pad = geo.pad
  const content = {
    left: p.left + pad.left,
    right: p.right - pad.right,
    top: p.top + pad.top,
    bottom: p.bottom - pad.bottom,
  }
  const t = PIXEL.boxTol
  const rows = geo.labels.map((l) => {
    if (l.missing) {
      return { dimension: l.dimension, missing: true, inside: false, fontSizeOk: false }
    }
    const inside =
      l.left >= content.left - t &&
      l.right <= content.right + t &&
      l.top >= content.top - t &&
      l.bottom <= content.bottom + t
    const overflow = {
      left: Math.max(0, content.left - l.left),
      right: Math.max(0, l.right - content.right),
      top: Math.max(0, content.top - l.top),
      bottom: Math.max(0, l.bottom - content.bottom),
    }
    const fontSizePx = parseFloat(l.fontSize)
    return {
      dimension: l.dimension,
      missing: false,
      rect: { x: l.x, y: l.y, w: l.w, h: l.h },
      inside,
      overflow,
      fontSize: l.fontSize,
      fontSizePx,
      fontSizeOk: Math.abs(fontSizePx - GATE.labelFontPx) < 0.05,
      text: l.dimension,
    }
  })
  const overlaps = []
  const present = rows.filter((r) => !r.missing)
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const a = present[i].rect
      const b = present[j].rect
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      const area = ox > 0 && oy > 0 ? ox * oy : 0
      if (area > PIXEL.overlapTol) {
        overlaps.push({ a: present[i].dimension, b: present[j].dimension, area })
      }
    }
  }
  const badInside = rows.filter((r) => r.missing || !r.inside)
  const badFont = rows.filter((r) => !r.missing && !r.fontSizeOk)
  return {
    pass: badInside.length === 0 && badFont.length === 0 && overlaps.length === 0,
    labelCount: present.length,
    panelRect: { x: p.x, y: p.y, w: p.w, h: p.h },
    contentBox: content,
    labels: rows,
    clipped: badInside.map((r) => ({ dimension: r.dimension, missing: r.missing, overflow: r.overflow })),
    overlaps,
    badFontSize: badFont.map((r) => ({ dimension: r.dimension, fontSize: r.fontSize })),
  }
}

function checkBottomWhitespace(geo) {
  if (!geo.leafRect) return { pass: false, reason: '找不到面板内的叶内容元素' }
  const gap = geo.panelRect.bottom - geo.leafRect.bottom
  const expected = geo.pad.bottom
  return {
    pass: Math.abs(gap - GATE.bottomWhitespace) <= GATE.bottomWhitespaceTol,
    gap,
    expected: GATE.bottomWhitespace,
    panelPaddingBottom: expected,
    leafTag: geo.leafTag,
    leafBottom: geo.leafRect.bottom,
    panelBottom: geo.panelRect.bottom,
    tolerance: GATE.bottomWhitespaceTol,
  }
}

/* ============================================================================
 * 五之二、与实现方探针表的交叉校验（验证"我方取点"没取错）
 *
 * 探针表 audit/radar-lines-after.txt 是**另一套方法**（读 DOM 属性，不读像素），
 * 里面原样贴着已渲染多边形的 `d=`。这里把它解析出来，按角度对齐到 6 个维度，
 * 算每条轴的 r/R，再跟我方从像素/屏幕 CTM 量到的 dataRadiusRatio 逐轴比。
 * 两边独立取点却应当收敛 —— 这就是"取点对不对"的证据。
 * 探针表不存在/不可解析时只报 unavailable，不参与判定。
 * ==========================================================================*/

const PROBE_FILE = path.join(__dirname, 'audit', 'radar-lines-after.txt')

function parsePathPoints(d) {
  const nums = d
    .replace(/[MmLlZz]/g, ' ')
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  const pts = []
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] })
  return pts
}

async function parseProbeTable() {
  let text
  try {
    text = await readFile(PROBE_FILE, 'utf8')
  } catch {
    return { available: false, reason: `读不到 ${path.relative(process.cwd(), PROBE_FILE)}` }
  }
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map((s) => s.trim())
    if (cells.length < 8 || !/^\d+$/.test(cells[0])) continue
    rows.push({
      idx: Number(cells[0]),
      tag: cells[1],
      cls: cells[2],
      stroke: cells[3],
      contrast: cells[7],
      detail: cells[8] ?? '',
    })
  }
  const dOf = (row) => {
    const m = row.detail.match(/d=(\S.*)$/)
    return m ? m[1] : null
  }
  // 数据多边形描边：class 恰好是 recharts-polygon（排除 PolarAngleAxis 的 axisLine）
  const polyRow = rows.find((r) => r.cls === 'recharts-polygon' && dOf(r))
  /*
   * 极坐标中心与 R **不用**同心环来推：探针表的长列会被截断
   * （实测 idx 9 的外圈 `d=` 就断在 "80.06902997779832,243.68L 8"，
   *  只有 5 个顶点，质心会被拉偏到 211.4 —— 用它算 r/R 会得到 0.8075 这种错值）。
   * 径向网格线这一行很短、没被截断：6 条线**共用一个起点** = 极坐标中心，
   * 终点正好落在外圈六边形的 6 个顶点上，所以 R = 终点到起点的距离。
   */
  /*
   * 探针表里 tag=line 的有 12 条：6 条是网格辐条（共用圆心），
   * 6 条是轴标签的 tick 引线（起点在外圈顶点上，终点在圈外 8px）。
   * 所以**按起点分组、取起点相同的那一组**，才是真正共圆的辐射线。
   */
  const lineRows = rows.filter((r) => r.tag === 'line' && /x1=/.test(r.detail))
  const parsedSegs = lineRows
    .map((r) => {
      const m = r.detail.match(
        /x1=([-\d.eE+]+) y1=([-\d.eE+]+) x2=([-\d.eE+]+) y2=([-\d.eE+]+)/,
      )
      return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null
    })
    .filter(Boolean)
  const groups = new Map()
  for (const s of parsedSegs) {
    const key = `${s.x1.toFixed(3)},${s.y1.toFixed(3)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  const segs = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? []
  if (!polyRow || segs.length < 3) {
    return { available: false, reason: '探针表里没解析到多边形描边或径向网格线' }
  }
  const center = { x: segs[0].x1, y: segs[0].y1 }
  const spread = Math.max(
    ...segs.map((s) => Math.hypot(s.x1 - center.x, s.y1 - center.y)),
  )
  const outerRadius = Math.max(
    ...segs.map((s) => Math.hypot(s.x2 - center.x, s.y2 - center.y)),
  )
  if (!(outerRadius > 20) || spread > 0.5) {
    return {
      available: false,
      reason: `探针表径向线不收敛（起点离差 ${spread.toFixed(2)}px，R=${outerRadius.toFixed(2)}px）`,
    }
  }
  const ringRows = rows.filter((r) => r.cls.includes('concentric-polygon') && dOf(r))
  const outer = { cx: center.x, cy: center.y, rad: outerRadius }
  const polyPts = parsePathPoints(dOf(polyRow))
  // 去掉闭合重复点（首尾同一个点，且相邻重复点也去掉）
  const verts = []
  for (const p of polyPts) {
    const last = verts[verts.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) verts.push(p)
  }
  while (
    verts.length > 1 &&
    Math.hypot(verts[0].x - verts[verts.length - 1].x, verts[0].y - verts[verts.length - 1].y) <=
      0.01
  ) {
    verts.pop()
  }
  const byAngle = []
  for (const p of verts) {
    const rad = Math.hypot(p.x - outer.cx, p.y - outer.cy)
    byAngle.push({
      angleDeg: norm360((Math.atan2(-(p.y - outer.cy), p.x - outer.cx) * 180) / Math.PI),
      radiusRatio: rad / outer.rad,
    })
  }
  const contrastOf = (needle) => rows.find((r) => r.cls.includes(needle))?.contrast ?? null
  return {
    available: true,
    file: path.relative(process.cwd(), PROBE_FILE),
    probeSvg: {
      center: { x: outer.cx, y: outer.cy },
      outerRadius: outer.rad,
      ringCount: ringRows.length,
      vertexCount: verts.length,
    },
    probeReportedContrast: {
      gridRingAndSpoke: contrastOf('concentric-polygon'),
      angleAxisLine: contrastOf('polar-angle-axis-line'),
      dataPolygon: polyRow.contrast,
      strokes: {
        grid: rows.find((r) => r.cls.includes('concentric-polygon'))?.stroke ?? null,
        axisLine: rows.find((r) => r.cls.includes('polar-angle-axis-line'))?.stroke ?? null,
        polygon: polyRow.stroke,
      },
    },
    byAngle,
  }
}

/** 把探针表按角度对齐到我方 6 条轴，逐轴比 r/R */
function crossCheckWithProbe(probe, grid) {
  if (!probe.available) return { pass: null, status: 'unavailable', reason: probe.reason }
  const rows = []
  for (const a of grid.axes ?? []) {
    if (a.angleDeg === null || a.angleDeg === undefined) continue
    let best = null
    for (const p of probe.byAngle) {
      const d = Math.min(
        Math.abs(p.angleDeg - a.angleDeg),
        360 - Math.abs(p.angleDeg - a.angleDeg),
      )
      if (!best || d < best.d) best = { ...p, d }
    }
    rows.push({
      dimension: a.dimension,
      angleDeg: a.angleDeg,
      probeRadiusRatio: best ? best.radiusRatio : null,
      probeAngleDeltaDeg: best ? best.d : null,
      measuredRadiusRatio: a.dataRadiusRatio,
      delta:
        best && a.dataRadiusRatio !== null && a.dataRadiusRatio !== undefined
          ? Math.abs(a.dataRadiusRatio - best.radiusRatio)
          : null,
    })
  }
  const maxDelta = rows.reduce((m, r) => (r.delta === null ? m : Math.max(m, r.delta)), 0)
  const tol = 0.04
  const probeSat = rows.filter((r) => r.probeRadiusRatio !== null && r.probeRadiusRatio > 0.97)
  const measuredSat = rows.filter((r) => r.measuredRadiusRatio !== null && r.measuredRadiusRatio > 0.97)
  return {
    pass: rows.length === 6 && maxDelta <= tol,
    status: 'checked',
    tolerance: tol,
    maxDelta,
    rows,
    probeSaturated: probeSat.map((r) => r.dimension),
    measuredSaturated: measuredSat.map((r) => r.dimension),
    saturatedAgree:
      probeSat.length === measuredSat.length &&
      probeSat.every((r) => measuredSat.some((m) => m.dimension === r.dimension)),
    probeReportedContrast: probe.probeReportedContrast,
    probeSvg: probe.probeSvg,
  }
}

/* ============================================================================
 * 六、第 4 项：整页像素差异
 * ==========================================================================*/

function diffImages(a, b, allowed, tolerance) {
  const width = Math.min(a.width, b.width)
  const height = Math.min(a.height, b.height)
  const inAllowed = (x, y) =>
    Boolean(
      allowed &&
        x >= allowed.x &&
        x <= allowed.x + allowed.w &&
        y >= allowed.y &&
        y <= allowed.y + allowed.h,
    )
  let diffTotal = 0
  let diffOutside = 0
  let diffInside = 0
  let outsideBBox = null
  const outsideRowCounts = new Map()
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * a.width + x) * 4
      const j = (y * b.width + x) * 4
      const d = Math.max(
        Math.abs(a.data[i] - b.data[j]),
        Math.abs(a.data[i + 1] - b.data[j + 1]),
        Math.abs(a.data[i + 2] - b.data[j + 2]),
      )
      if (d > tolerance) {
        diffTotal += 1
        if (inAllowed(x, y)) {
          diffInside += 1
        } else {
          diffOutside += 1
          // 记下区外差异落在哪 —— 万一是真回归（比如整条带子偏了），不至于被"占比小于阈值"糊过去
          outsideRowCounts.set(y, (outsideRowCounts.get(y) ?? 0) + 1)
          if (!outsideBBox) outsideBBox = { x0: x, y0: y, x1: x, y1: y }
          else {
            outsideBBox.x0 = Math.min(outsideBBox.x0, x)
            outsideBBox.x1 = Math.max(outsideBBox.x1, x)
            outsideBBox.y1 = Math.max(outsideBBox.y1, y)
          }
        }
      }
    }
  }
  const total = width * height
  return {
    comparedWidth: width,
    comparedHeight: height,
    sizeMatch: a.width === b.width && a.height === b.height,
    diffTotal,
    diffRatio: diffTotal / total,
    diffInside,
    diffOutside,
    diffOutsideRatio: diffOutside / total,
    outsideBBox,
    outsideTopRows: [...outsideRowCounts.entries()]
      .sort((p, q) => q[1] - p[1])
      .slice(0, 5)
      .map(([y, n]) => ({ y, count: n })),
  }
}

/* ============================================================================
 * 七、第 6 项：静态检查
 * ==========================================================================*/

function runCmd(command, args, cwd) {
  const r = spawnSync(command, args, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? String(r.error.message) : null }
}

function checkTsc() {
  const r = runCmd('npx', ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], FRONTEND)
  const out = `${r.stdout}`.trim()
  const err = `${r.stderr}`.trim()
  return {
    pass: out === '' && err === '' && !r.error,
    status: r.status,
    stdout: out,
    stderr: err,
    error: r.error,
    command: 'npx tsc -p tsconfig.app.json --noEmit',
  }
}

function checkOxlint() {
  const cmd = 'npx oxlint --format=json src/components/ProfileRadar.tsx src/pages/profile/ProfilePage.tsx'
  const r = runCmd(
    'npx',
    ['oxlint', '--format=json', 'src/components/ProfileRadar.tsx', 'src/pages/profile/ProfilePage.tsx'],
    FRONTEND,
  )
  const text = `${r.stdout}`
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let diagnostics = []
  let parseError = null
  if (start >= 0 && end > start) {
    try {
      diagnostics = JSON.parse(text.slice(start, end + 1)).diagnostics ?? []
    } catch (e) {
      parseError = String(e.message ?? e)
    }
  } else {
    parseError = 'oxlint 没有输出 JSON'
  }
  const codes = diagnostics.map((d) => d.code)
  const foreign = diagnostics.filter((d) => !String(d.code).includes('set-state-in-effect'))
  const pass =
    !parseError &&
    diagnostics.length <= GATE.oxlintAllowed &&
    foreign.length === 0 &&
    codes.every((c) => String(c).includes('set-state-in-effect'))
  return {
    pass,
    command: cmd,
    status: r.status,
    count: diagnostics.length,
    allowed: GATE.oxlintAllowed,
    codes,
    foreign: foreign.map((d) => ({ code: d.code, filename: d.filename, message: d.message })),
    note:
      diagnostics.length < GATE.oxlintAllowed
        ? `告警比既有的还少（${diagnostics.length} < ${GATE.oxlintAllowed}），不算回归`
        : null,
    parseError,
    stderr: `${r.stderr}`.trim(),
  }
}

/* ============================================================================
 * 八、主流程
 * ==========================================================================*/

async function openPage(browser, viewport, route) {
  const ctx = await browser.newContext({ viewport, locale: 'zh-CN' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)))
  await installApi(page, {})
  await page.addInitScript(
    `window.localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, JSON.stringify('rc.mock.jwt.token'));`,
  )
  await page.goto(BASE_URL + route, { waitUntil: 'networkidle', timeout: 25000 })
  await sleep(2000)
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(120)
  return { ctx, page, errors }
}

async function shootFull(page, name) {
  const file = path.join(OUT_DIR, name)
  await page.screenshot({ path: file, fullPage: true })
  return decodePng(await readFile(file))
}

async function findHomeBaseline() {
  if (process.env.RC_HOME_BASELINE) {
    const p = path.isAbsolute(process.env.RC_HOME_BASELINE)
      ? process.env.RC_HOME_BASELINE
      : path.resolve(process.env.RC_HOME_BASELINE)
    try {
      const s = await stat(p)
      return { path: p, name: path.basename(p), mtime: s.mtime.toISOString(), source: 'env' }
    } catch {
      return { path: p, name: path.basename(p), missing: true, source: 'env' }
    }
  }
  const tried = []
  for (const name of HOME_BASELINE_CANDIDATES) {
    const p = path.join(OUT_DIR, name)
    try {
      const s = await stat(p)
      return { path: p, name, mtime: s.mtime.toISOString(), source: 'candidate', tried }
    } catch {
      tried.push(name)
    }
  }
  return { missing: true, source: 'candidate', tried }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const report = {
    meta: {
      baseUrl: BASE_URL,
      edge: EDGE,
      ranAt: new Date().toISOString(),
      node: process.version,
      gates: GATE,
      method: {
        grid:
          '从已渲染网格组包围盒中心打射线，在最外圈半径带里逐像素取 3×3 邻域最小明度，与卡片底色（面板区域颜色众数）算 WCAG 对比度',
        polygon: '沿已渲染 path.recharts-radar-polygon 用 getPointAtLength+getScreenCTM 采样',
      },
    },
    checks: {},
    verdict: null,
  }
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const viewports = [1440, 1200, 1100, 1920, 390]
  const gatePixels = 1440

  try {
    /* ---- 第 1/2/3/5 项：/profile 各视口 ---- */
    const probe = await parseProbeTable()
    for (const width of viewports) {
      const vp = width === 390 ? { width: 390, height: 844 } : { width, height: 900 }
      const { ctx, page, errors } = await openPage(browser, vp, '/profile')
      const geo = await collectRadarGeometry(page)
      if (geo.error) {
        report.checks[`profile_${width}`] = { error: geo.error, pageErrors: errors }
        await ctx.close()
        continue
      }
      const img = await shootFull(page, `radar-verify-profile-${width}.png`)
      const card = modalColor(img, geo.panelRect)
      const grid = checkGridPixels(img, geo, card.color)
      const poly = checkPolygonStroke(img, geo, card.color)
      const labels = checkAxisLabels(geo)
      const bottom = checkBottomWhitespace(geo)
      report.checks[`pixels_${width}`] = {
        gate: width === gatePixels,
        cardBg: card,
        grid,
        polygon: poly,
      }
      report.checks[`labels_${width}`] = labels
      report.checks[`bottom_${width}`] = bottom
      if (width === gatePixels) {
        report.checks.probeCrossCheck = crossCheckWithProbe(probe, grid)
        report.checks.probe = probe
        await page.evaluate(() => window.scrollTo(0, 0))
        await sleep(120)
        // 雷达卡本体（h2「画像雷达」最近的 [data-slot="panel"] 祖先）单独出一张，给人眼看。
        // 必须用 elementHandle.screenshot()：page.screenshot({clip}) 的 clip 是**视口**坐标，
        // 卡片在首屏之下时只会拍到一条边（实测就是这样）。
        const handle = await page.evaluateHandle(() => {
          const h2 = Array.from(document.querySelectorAll('h2')).find(
            (h) => (h.textContent ?? '').trim() === '画像雷达',
          )
          return h2 ? h2.closest('[data-slot="panel"]') : null
        })
        const el = handle.asElement()
        if (el) {
          await el.screenshot({
            path: path.join(OUT_DIR, 'radar-verify-radar-1440.png'),
          })
        }
      }
      if (errors.length) report.checks[`pixels_${width}`].pageErrors = errors
      await ctx.close()
    }

    /* ---- 第 4 项：首页整页回归 ---- */
    const homeBaseline = await findHomeBaseline()
    const { ctx: homeCtx, page: homePage, errors: homeErrors } = await openPage(
      browser,
      { width: 1440, height: 900 },
      '/',
    )
    const homeRegion = await collectHomeRadarRegion(homePage)
    const homeImg = await shootFull(homePage, 'radar-verify-home-1440.png')
    const allowed = homeRegion.rect
      ? {
          x: Math.max(0, homeRegion.rect.left - 6),
          y: Math.max(0, homeRegion.rect.top - 6),
          w: homeRegion.rect.w + 12,
          h: homeRegion.rect.h + 12,
        }
      : null
    const homeCheck = {
      baseline: homeBaseline,
      fresh: { width: homeImg.width, height: homeImg.height },
      radarRegion: homeRegion.rect,
      allowedRegion: allowed,
      pageErrors: homeErrors,
    }
    if (homeBaseline.missing) {
      homeCheck.pass = false
      homeCheck.status = 'SKIP'
      homeCheck.reason =
        '首页整页基线不存在（任务书点名的 after-home-full.png 不在 preview/ 里）。' +
        `已尝试：${(homeBaseline.tried ?? []).join(', ') || '(env 指定路径)'}。` +
        '没有基线就不给 PASS —— 请提供改动前的首页整页存档后重跑。'
    } else {
      const baseImg = decodePng(await readFile(homeBaseline.path))
      homeCheck.baselineSize = { width: baseImg.width, height: baseImg.height }
      if (baseImg.width !== homeImg.width || baseImg.height !== homeImg.height) {
        const overlap = diffImages(homeImg, baseImg, allowed, GATE.diffTolerance)
        homeCheck.pass = false
        homeCheck.status = 'SKIP'
        homeCheck.diff = overlap
        homeCheck.reason = `基线与新图尺寸不一致（${baseImg.width}x${baseImg.height} vs ${homeImg.width}x${homeImg.height}），不能作为整页回归基线`
      } else {
        const d = diffImages(homeImg, baseImg, allowed, GATE.diffTolerance)
        homeCheck.diff = d
        homeCheck.diffInsideRatioOfRegion =
          allowed && allowed.w * allowed.h > 0 ? d.diffInside / (allowed.w * allowed.h) : undefined
        homeCheck.pass = d.diffOutsideRatio <= GATE.offRegionDiffRatio
        homeCheck.status = homeCheck.pass ? 'PASS' : 'FAIL'
        homeCheck.thresholdOffRegionRatio = GATE.offRegionDiffRatio
      }
    }
    report.checks.homeRegression = homeCheck
    await homeCtx.close()

    /* ---- 第 6 项：静态检查 ---- */
    report.checks.tsc = checkTsc()
    report.checks.oxlint = checkOxlint()
  } finally {
    await browser.close()
  }

  /* ---- 汇总判定 ---- */
  const pixels = report.checks[`pixels_${gatePixels}`]
  const items = [
    {
      id: '1_grid_pixels',
      name: `网格线像素可见性（${gatePixels}px，6 条轴方向）`,
      pass: Boolean(pixels && pixels.grid && pixels.grid.pass),
      detail: pixels && pixels.grid ? (pixels.grid.conclusion ?? pixels.grid.reason ?? '无数据') : '无数据',
    },
    {
      id: '1b_probe_crosscheck',
      name: '与实现方探针表的几何交叉校验（不读像素，只对齐 r/R）',
      pass: Boolean(report.checks.probeCrossCheck && report.checks.probeCrossCheck.pass),
      detail: (() => {
        const c = report.checks.probeCrossCheck
        if (!c) return '无数据'
        if (c.status === 'unavailable') return `SKIP：${c.reason}`
        return (
          `6 轴 r/R 与探针 d= 的最大偏差 ${c.maxDelta.toFixed(4)}（容差 ${c.tolerance}）；` +
          `探针顶满轴 ${JSON.stringify(c.probeSaturated)} vs 实测顶满轴 ${JSON.stringify(c.measuredSaturated)}（一致=${c.saturatedAgree}）；` +
          `探针自带对比度：网格 ${c.probeReportedContrast.gridRingAndSpoke} / 最外圈 axisLine ${c.probeReportedContrast.angleAxisLine} / 数据描边 ${c.probeReportedContrast.dataPolygon}`
        )
      })(),
    },
    {
      id: '2_polygon_stroke',
      name: `数据多边形描边对比度（${gatePixels}px）`,
      pass: Boolean(pixels && pixels.polygon && pixels.polygon.pass),
      detail: pixels && pixels.polygon
        ? pixels.polygon.strokeContrast
          ? `${pixels.polygon.strokeContrast.toFixed(2)}:1（阈值 ${GATE.polyContrast}）`
          : (pixels.polygon.reason ?? '无数据')
        : '无数据',
    },
    {
      id: '3_axis_labels',
      name: '轴标签不被裁 / 不重叠 / 13px（1100/1200/1440/1920/390）',
      pass: viewports.every((w) => {
        const v = report.checks[`labels_${w}`]
        return v && v.pass
      }),
      detail: viewports
        .map((w) => {
          const v = report.checks[`labels_${w}`]
          if (!v) return `${w}:无数据`
          return `${w}:${v.pass ? 'PASS' : `FAIL(裁 ${v.clipped.length} / 叠 ${v.overlaps.length} / 字号 ${v.badFontSize.length})`}`
        })
        .join('  '),
    },
    {
      id: '4_home_regression',
      name: '首页整页回归（雷达区以外无差异）',
      pass: Boolean(report.checks.homeRegression && report.checks.homeRegression.pass),
      detail: (() => {
        const h = report.checks.homeRegression
        if (!h) return '无数据'
        if (h.status === 'SKIP') return `SKIP：${h.reason}`
        return `基线 ${h.baseline.name}（mtime ${h.baseline.mtime}）；总差异 ${h.diff.diffTotal}px（${(h.diff.diffRatio * 100).toFixed(3)}%）` +
          `，区内 ${h.diff.diffInside}px（占雷达矩形 ${h.diffInsideRatioOfRegion === undefined ? '?' : (h.diffInsideRatioOfRegion * 100).toFixed(2)}%）` +
          `，区外 ${h.diff.diffOutside}px（${(h.diff.diffOutsideRatio * 100).toFixed(3)}%，阈值 ${(GATE.offRegionDiffRatio * 100).toFixed(2)}%）` +
          (h.diff.outsideBBox
            ? `；区外差异范围 x[${h.diff.outsideBBox.x0}-${h.diff.outsideBBox.x1}] y[${h.diff.outsideBBox.y0}-${h.diff.outsideBBox.y1}]，最多的行 ${JSON.stringify(h.diff.outsideTopRows)}`
            : '')
      })(),
    },
    {
      id: '5_bottom_whitespace',
      name: '雷达卡底部死白 = 20px（1440/1200）',
      pass: [1440, 1200].every((w) => {
        const b = report.checks[`bottom_${w}`]
        return b && b.pass
      }),
      detail: [1440, 1200]
        .map((w) => {
          const b = report.checks[`bottom_${w}`]
          return b ? `${w}:${b.gap !== undefined ? `${b.gap.toFixed(1)}px` : b.reason}` : `${w}:无数据`
        })
        .join('  '),
    },
    {
      id: '6_static',
      name: 'tsc 无输出 + oxlint 只有 2 条既有告警',
      pass: Boolean(report.checks.tsc && report.checks.tsc.pass && report.checks.oxlint && report.checks.oxlint.pass),
      detail:
        `tsc:${report.checks.tsc && report.checks.tsc.pass ? 'PASS' : `FAIL(${((report.checks.tsc && (report.checks.tsc.stdout || report.checks.tsc.stderr)) || '').slice(0, 120)})`}` +
        `  oxlint:${report.checks.oxlint && report.checks.oxlint.pass ? `PASS(${report.checks.oxlint.count} 条 set-state-in-effect)` : `FAIL(count=${report.checks.oxlint && report.checks.oxlint.count}, foreign=${report.checks.oxlint && report.checks.oxlint.foreign.length})`}`,
    },
  ]
  const skipped = items.filter((i) => !i.pass && i.detail.startsWith('SKIP'))
  const hardFail = items.some((i) => !i.pass && !i.detail.startsWith('SKIP'))
  report.items = items
  report.verdict = hardFail ? 'FAIL' : items.every((i) => i.pass) ? 'PASS' : 'INCOMPLETE'

  const outJson = path.join(OUT_DIR, 'radar-verify-report.json')
  await writeFile(outJson, JSON.stringify(report, null, 2), 'utf8')

  /* ---- 打印 ---- */
  console.log('')
  console.log('===== 画像雷达独立复核（radar-verify）=====')
  for (const it of items) {
    const status = it.pass ? 'PASS' : it.detail.startsWith('SKIP') ? 'SKIP' : 'FAIL'
    console.log(`[${it.id}] ${status.padEnd(4)} ${it.name}`)
    console.log(`        ${it.detail}`)
  }
  const px = report.checks[`pixels_${gatePixels}`]
  if (px && px.grid && px.grid.axes) {
    console.log('')
    console.log(`-- 第 1 项逐方向（中心 ${px.grid.center.cx.toFixed(1)},${px.grid.center.cy.toFixed(1)}；R=${px.grid.outerRadiusPx.toFixed(1)}px；卡片底色 rgb(${px.cardBg.color.join(',')}) 占比 ${(px.cardBg.share * 100).toFixed(1)}%）`)
    for (const a of px.grid.axes) {
      const f = (x) => (x ? `${x.contrast.toFixed(2)}:1` : 'n/a')
      const raw = a.outerBandAxis ? `${a.outerBandAxis.contrastRaw.toFixed(2)}:1` : 'n/a'
      const th = a.angleDeg === null || a.angleDeg === undefined ? 'n/a' : `${a.angleDeg.toFixed(1)}°`
      const dr = a.dataRadiusRatio === null || a.dataRadiusRatio === undefined ? 'n/a' : a.dataRadiusRatio.toFixed(3)
      const flag = px.grid.bandContaminatedAxes.includes(a.dimension) ? ' ⚠带内混入数据描边' : ''
      console.log(
        `   ${a.dimension}  θ=${th}(${a.angleSource})  外圈带 ${f(a.outerBandAxis)}` +
          `  原始 ${raw}  最暗处 r/R=${a.outerBandAxis ? a.outerBandAxis.radiusRatio.toFixed(3) : 'n/a'}` +
          `  边心带 ${f(a.outerBandEdgeMid)}  内圈 ${f(a.innerBand)}  数据半径 r/R=${dr}${flag}`,
      )
    }
    console.log(
      `   轴方向测得 ${px.grid.axisDirectionsMeasured}，轴间(边)方向测得 ${px.grid.edgeMidDirectionsMeasured}；径向网格线 ${px.grid.radialLineCount} 条`,
    )
    console.log(
      `   数据顶满的轴 ${JSON.stringify(px.grid.saturatedAxes)}；外圈带混入描边的轴 ${JSON.stringify(px.grid.bandContaminatedAxes)}` +
        `；纯网格方向 ${JSON.stringify(px.grid.pureGridDirections)} → 最暗 ${px.grid.gridDarkestContrastPureGrid === null ? 'n/a' : px.grid.gridDarkestContrastPureGrid.toFixed(2) + ':1'}`,
    )
    console.log(
      `   内圈(环+辐条)最暗一档 ${px.grid.innerBandDarkestContrast?.toFixed?.(2) ?? 'n/a'}:1（含数据填充/描边，仅参考）`,
    )
    const cc = report.checks.probeCrossCheck
    if (cc && cc.status === 'checked') {
      console.log('-- 第 1b 项 探针交叉校验（探针读 DOM 属性，我方读屏幕几何/像素）')
      for (const r of cc.rows) {
        const fmt = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(4))
        console.log(
          `   ${r.dimension}  我方 r/R=${fmt(r.measuredRadiusRatio)}` +
            `  探针 r/R=${fmt(r.probeRadiusRatio)}` +
            `  Δ=${fmt(r.delta)}  (角度差 ${r.probeAngleDeltaDeg === null ? 'n/a' : r.probeAngleDeltaDeg.toFixed(1)}°)`,
        )
      }
      console.log(
        `   探针自带对比度：网格 ${cc.probeReportedContrast.gridRingAndSpoke} / 最外圈 axisLine ${cc.probeReportedContrast.angleAxisLine} / 数据描边 ${cc.probeReportedContrast.dataPolygon}`,
      )
    } else if (cc) {
      console.log(`-- 第 1b 项 探针交叉校验：${cc.status}（${cc.reason ?? ''}）`)
    }
  }
  for (const w of viewports) {
    const l = report.checks[`labels_${w}`]
    if (!l || l.pass) continue
    console.log(`-- 第 3 项 ${w}px 明细：裁切 ${JSON.stringify(l.clipped)} 重叠 ${JSON.stringify(l.overlaps)} 字号 ${JSON.stringify(l.badFontSize)}`)
  }
  console.log('')
  console.log(`汇总 -> ${path.relative(process.cwd(), outJson)}`)
  if (skipped.length) console.log(`注意：${skipped.length} 项被跳过（缺基线 / 交叉校验不可用），verdict=INCOMPLETE（没验到就不算验过）`)
  console.log(`verdict = ${report.verdict}`)
  if (report.verdict === 'FAIL') process.exitCode = 1
  else if (report.verdict === 'INCOMPLETE') process.exitCode = 2
}

main().catch((e) => {
  // 用 exitCode 而不是 process.exit()：后者会把还没 flush 的 stdout 丢掉（曾被吞掉整段报告）
  console.error(e)
  process.exitCode = 1
})
