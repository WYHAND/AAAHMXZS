/**
 * 几何验证：历史会话行不得溢出侧栏；删除按钮必须落在可视区内且可点。
 *
 * 背景：Radix ScrollArea 的 Viewport 内层是 `<div style="min-width:100%;display:table">`，
 * table 宽度按内容撑开 → 长标题把整行撑出面板，选中底/描边溢出、省略号落在容器外、
 * 删除按钮（absolute right-1）跟着跑出可视区。
 *
 * 用法（前置：frontend 里 npx vite preview --port 4173 --strictPort）：
 *   node qa-chat-title-width.mjs
 */
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:4173'
const LONG = '实习方向怎么选：后端还是 AI 应用，我到底该往哪个方向准备'
const rows = [
  { id: 'c-1', title: LONG, message_count: 2 },
  ...Array.from({ length: 13 }, (_, i) => ({
    id: `c-${i + 2}`, title: `新对话 ${15 - i}`, message_count: 1,
  })),
]

const ok = (data) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ code: 0, message: 'success', data }),
})

const msg = (id, cid) => ({
  id, conversation_id: cid, role: 'user', content: `${cid} 的历史问题`,
  created_at: '2026-09-18T00:00:00Z',
})

const conv = (r) => ({
  id: r.id, title: r.title, message_count: r.message_count, conclusion: null,
  followup_round: null, followup_direction: null,
  created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z',
})

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))

await page.addInitScript(() => {
  localStorage.setItem('ai_job_helper:token', JSON.stringify('qa-token'))
})

await page.route('**/api/v1/**', async (route) => {
  const req = route.request()
  const p = new URL(req.url()).pathname
  if (p.endsWith('/auth/me')) {
    return route.fulfill(ok({
      id: 'u1', username: 'qa', school: 'S', major: 'M', grade: '大三',
      created_at: '2026-09-18T00:00:00Z',
    }))
  }
  if (p.endsWith('/profile')) {
    return route.fulfill(ok({
      id: 'p1', user_id: 'u1', clarity_score: 50, action_score: 0, resume_score: 0,
      total_score: 20, stage: 'explore', stage_label: '职业探索期', tested: true,
      summary: '喜欢自己动手折腾。', tags: [], updated_at: '2026-09-18T00:00:00Z',
    }))
  }
  if (p.endsWith('/chat/conversations')) {
    return route.fulfill(ok(rows.map(conv)))
  }
  const m = p.match(/\/chat\/conversations\/([^/]+)\/messages$/)
  if (m) return route.fulfill(ok([msg('m-' + m[1], m[1])]))
  return route.fulfill(ok(null))
})

await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

/* ---------- 几何量测 ---------- */
const geo = await page.evaluate(() => {
  const root = document.querySelector('aside [data-slot="scroll-area"]')
  const panel = root.parentElement
  const viewport = root.querySelector('[data-slot="scroll-area-viewport"]')
  const innerTable = viewport.firstElementChild
  const firstRow = innerTable.querySelector(':scope > div')
  const titleBtn = firstRow.querySelector(':scope > button')
  const trash = root.querySelector('button[aria-label^="删除会话"]')
  const scrollbar = root.querySelector('[data-slot="scroll-area-scrollbar"]')
  const r = (el) => {
    const b = el.getBoundingClientRect()
    return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1) }
  }
  return {
    panel: r(panel),
    panelOverflowX: getComputedStyle(panel).overflowX,
    viewport: r(viewport),
    innerDisplay: getComputedStyle(innerTable).display,
    inner: r(innerTable),
    innerScrollW: innerTable.scrollWidth,
    row: r(firstRow),
    titleBtn: r(titleBtn),
    titleClientW: titleBtn.clientWidth,
    titleScrollW: titleBtn.scrollWidth,
    trash: r(trash),
    trashOpacity: getComputedStyle(trash).opacity,
    scrollbar: scrollbar ? r(scrollbar) : null,
  }
})

const panelRight = geo.panel.right
const checks = {
  '内层不是 table（!block 生效）': geo.innerDisplay === 'block',
  '内层宽度 ≤ 面板可视宽': geo.inner.width <= geo.viewport.width + 1,
  '会话行右边界在面板内': geo.row.right <= panelRight,
  '标题按钮右边界在面板内': geo.titleBtn.right <= panelRight,
  '标题真的被截断（scrollW > clientW）': geo.titleScrollW > geo.titleClientW + 1,
  '删除按钮在面板内': geo.trash.right <= panelRight && geo.trash.left >= geo.panel.left,
  '删除按钮与滚动条不重叠': !geo.scrollbar || geo.trash.right <= geo.scrollbar.left + 0.5,
  '删除按钮默认可见（opacity > 0）': Number(geo.trashOpacity) > 0,
}

/* ---------- 不 hover 直接点删除，确认能点开确认框 ---------- */
const trash = page.getByRole('button', { name: `删除会话「${LONG}」` })
await page.screenshot({ path: 'shots/qa-chat-width-1-idle.png' })
let clickable = false
try {
  await trash.click({ timeout: 2500 })
  await page.waitForTimeout(350)
  clickable = (await page.getByRole('alertdialog').count()) === 1
} catch {
  clickable = false
}
checks['不 hover 也能点开删除确认框'] = clickable
await page.screenshot({ path: 'shots/qa-chat-width-2-dialog.png' })

console.log('========== 历史会话行几何 ==========')
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '通过 ✔' : '失败 ✘'}  ${k}`)
console.log('  --- 实测 ---')
console.log(JSON.stringify(geo, null, 2))
console.log(`  pageerror: ${pageErrors.length ? pageErrors.join(' | ') : '无'}`)

const pass = Object.values(checks).every(Boolean) && pageErrors.length === 0
console.log(`\n结论：${pass ? '全部通过 ✔' : '有失败项 ✘'}`)
await browser.close()
process.exit(pass ? 0 : 1)
