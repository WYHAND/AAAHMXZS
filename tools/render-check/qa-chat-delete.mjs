/**
 * 渲染验证：「删除会话」功能（E2E，mock 后端）
 *
 * 为什么必须跑真实渲染：删除入口是 **hover 才出现**的浮层图标、二次确认是 Radix
 * AlertDialog（Portal + 焦点陷阱 + "点完就关"），这些都不是单测能覆盖的渲染行为。
 *
 * 覆盖两条路径：
 *   A 删除成功：hover 出现图标 → 点图标出弹窗 → 点「删除」→ 发出 DELETE
 *               → 列表少一条 → 删的是当前会话，消息区切到下一条 → 无 pageerror
 *   B 删除失败（DELETE 500）：列表**一个字节都不变**，且出现错误 toast
 *
 * 用法（前置：frontend 里 npx vite preview --port 4173 --strictPort）：
 *   node qa-chat-delete.mjs
 *
 * ⚠️ 只能连 http://localhost:4173（vite preview 只监听 IPv6），不要用 127.0.0.1。
 */
import { chromium } from 'playwright-core'

const BASE = 'http://localhost:4173'
const C1 = 'c-1'
const C2 = 'c-2'

const ok = (data) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ code: 0, message: 'success', data }),
})
const err = (code, message, status) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ code, message, data: null }),
})

const CONVERSATIONS = [
  {
    id: C1, title: '会话一', message_count: 2, conclusion: null,
    followup_round: null, followup_direction: null,
    created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z',
  },
  {
    id: C2, title: '会话二', message_count: 1, conclusion: null,
    followup_round: null, followup_direction: null,
    created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z',
  },
]

const msg = (id, cid, role, content) => ({
  id, conversation_id: cid, role, content, created_at: '2026-09-18T00:00:00Z',
})

/** 打开一个场景：mock 全部 /api/v1/**，返回页面与探针 */
async function openScenario(browser, { deleteFails }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  /** 抓真实发出的 DELETE 请求 */
  const deletes = []
  page.on('request', (req) => {
    if (req.method() === 'DELETE') deletes.push(req.url())
  })

  await page.addInitScript(() => {
    localStorage.setItem('ai_job_helper:token', JSON.stringify('qa-token'))
  })

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const p = new URL(req.url()).pathname

    // 被测端点：DELETE /chat/conversations/{id}
    if (req.method() === 'DELETE' && p.includes('/chat/conversations/')) {
      return route.fulfill(deleteFails ? err(5000, 'boom', 500) : ok(null))
    }
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
        summary: '你是个喜欢自己动手折腾的人：会写代码，也一直在琢磨技术怎么变成产品。',
        tags: [], updated_at: '2026-09-18T00:00:00Z',
      }))
    }
    if (p.endsWith('/chat/conversations')) {
      return route.fulfill(ok(CONVERSATIONS))
    }
    if (p.endsWith(`/chat/conversations/${C1}/messages`)) {
      return route.fulfill(ok([msg('m1', C1, 'user', 'C1的历史问题')]))
    }
    if (p.endsWith(`/chat/conversations/${C2}/messages`)) {
      return route.fulfill(ok([msg('m3', C2, 'user', 'C2的历史问题')]))
    }
    return route.fulfill(ok(null))
  })

  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  return { page, deletes, pageErrors }
}

/** Playwright 的 visible 不看 opacity，这里直接读计算样式 */
const opacityOf = (locator) =>
  locator.evaluate((el) => getComputedStyle(el).opacity)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
let pass = true

/* ============================ 场景 A：删除成功 ============================ */
{
  const { page, deletes, pageErrors } = await openScenario(browser, { deleteFails: false })

  const listBefore = await page.locator('body').innerText()
  const a0 = listBefore.includes('会话一') && listBefore.includes('会话二')

  const row = page.getByRole('button', { name: '会话一', exact: true })
  const trash = page.getByRole('button', { name: '删除会话「会话一」' })

  // A1 不 hover：图标存在但不可见（opacity 0）
  const opacityIdle = await opacityOf(trash)
  const a1 = opacityIdle === '0'

  await page.screenshot({ path: 'shots/qa-chat-delete-1-idle.png' })

  // A2 hover 会话项：图标浮出
  await row.hover()
  await page.waitForTimeout(250)
  const opacityHover = await opacityOf(trash)
  const a2 = opacityHover === '1'

  await page.screenshot({ path: 'shots/qa-chat-delete-2-hover.png' })

  // A3 点图标 → 二次确认弹窗（且**没有**切换到别的会话：activeId 仍是 会话一）
  await trash.click()
  await page.waitForTimeout(300)
  const dialog = page.getByRole('alertdialog')
  const dialogText = (await dialog.count()) ? await dialog.innerText() : ''
  const a3 =
    (await dialog.count()) === 1 &&
    dialogText.includes('删除这个会话？') &&
    dialogText.includes('画像和成长任务都会保留')

  await page.screenshot({ path: 'shots/qa-chat-delete-3-dialog.png' })

  // A4 点「删除」
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(900)

  const bodyAfter = await page.locator('body').innerText()
  const a4 = deletes.length === 1 && deletes[0].includes(`/chat/conversations/${C1}`)
  const a5 = !bodyAfter.includes('会话一') && bodyAfter.includes('会话二')
  const a6 = (await page.getByRole('alertdialog').count()) === 0
  // 删掉的是当前会话（activeId=c-1）→ 消息区应切到下一条 c-2
  const a7 = bodyAfter.includes('C2的历史问题')
  const a8 = pageErrors.length === 0

  await page.screenshot({ path: 'shots/qa-chat-delete-4-success.png' })

  console.log('========== 场景 A：删除成功 ==========')
  console.log(`  A0 初始列表有两条会话          : ${a0 ? '通过 ✔' : '失败 ✘'}`)
  console.log(`  A1 未 hover 时图标 opacity=${opacityIdle}   : ${a1 ? '通过 ✔' : '失败 ✘'}（预期 0）`)
  console.log(`  A2 hover 后图标 opacity=${opacityHover}     : ${a2 ? '通过 ✔' : '失败 ✘'}（预期 1）`)
  console.log(`  A3 弹窗出现且文案正确          : ${a3 ? '通过 ✔' : '失败 ✘'}`)
  console.log(`     弹窗文案: ${dialogText.replace(/\s+/g, ' ').slice(0, 80)}`)
  console.log(`  A4 发出 DELETE 请求            : ${a4 ? '通过 ✔' : '失败 ✘'}  ${JSON.stringify(deletes)}`)
  console.log(`  A5 列表少一条（会话一消失）    : ${a5 ? '通过 ✔' : '失败 ✘'}`)
  console.log(`  A6 弹窗已关闭                  : ${a6 ? '通过 ✔' : '失败 ✘'}`)
  console.log(`  A7 消息区切到下一条(c-2)       : ${a7 ? '通过 ✔' : '失败 ✘'}`)
  console.log(`  A8 没有 pageerror              : ${a8 ? '通过 ✔' : '失败 ✘'}${pageErrors.length ? ' ' + pageErrors.join(' | ') : ''}`)

  pass = pass && a0 && a1 && a2 && a3 && a4 && a5 && a6 && a7 && a8
  await page.close()
}

/* ========================= 场景 B：删除失败（500） ========================= */
{
  const { page, deletes, pageErrors } = await openScenario(browser, { deleteFails: true })

  const row = page.getByRole('button', { name: '会话一', exact: true })
  const trash = page.getByRole('button', { name: '删除会话「会话一」' })
  await row.hover()
  await page.waitForTimeout(250)
  await trash.click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(1200)

  const body = await page.locator('body').innerText()
  const b1 = deletes.length === 1
  const b2 = body.includes('会话一') && body.includes('会话二')
  const toastCount = await page.locator('[data-sonner-toast]').count()
  const b3 = body.includes('服务器开小差了')
  const b4 = (await page.getByRole('alertdialog').count()) === 0
  const b5 = pageErrors.length === 0

  await page.screenshot({ path: 'shots/qa-chat-delete-5-fail.png' })

  console.log('\n========== 场景 B：删除失败（DELETE 500） ==========')
  console.log(`  B1 确实发出了 DELETE 请求      : ${b1 ? '通过 ✔' : '失败 ✘'}  ${JSON.stringify(deletes)}`)
  console.log(`  B2 列表没有变化（两条都还在）  : ${b2 ? '通过 ✔' : '失败 ✘'}`)
  console.log(`  B3 出现错误提示（toast=${toastCount}）  : ${b3 ? '通过 ✔' : '失败 ✘'}`)
  console.log(`  B4 弹窗已关闭                  : ${b4 ? '通过 ✔' : '失败 ✘'}`)
  console.log(`  B5 没有 pageerror              : ${b5 ? '通过 ✔' : '失败 ✘'}${pageErrors.length ? ' ' + pageErrors.join(' | ') : ''}`)

  pass = pass && b1 && b2 && b3 && b4 && b5
  await page.close()
}

await browser.close()
console.log(pass ? '\n结果: 全部通过' : '\n结果: 未通过')
process.exit(pass ? 0 : 1)
