/**
 * regression.mjs — 第二轮：全量回归 + 新增断言 N1..N5
 *
 * 被测：frontend 生产构建（vite preview :4173），本轮产物 index-u9bgTdbk.js
 * 浏览器：本机 Edge（playwright-core，不下载 Chromium）
 * 不修改 frontend/src/ 任何代码。
 *
 * 复用第一轮 tools/render-check 的判定口径：白屏 / ErrorBoundary / pageerror / URL / 渲染文本。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS_DIR = path.join(__dirname, 'shots')

const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:4173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const TOKEN_STORAGE_KEY = 'ai_job_helper:token'
const INTERVIEW_ID_STORAGE_KEY = 'ai_job_helper:interview_id'
const TEST_PROGRESS_STORAGE_KEY = 'ai_job_helper:test_progress'
const TEST_TOKEN = 'rc.mock.jwt.token'

const ERROR_BOUNDARY_PHRASES = ['页面渲染时出错了', '服务开小差了']

const SESSION_ID = 'b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
const CONV_ID = 'c1'
const RESUME_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const TASK_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70'
const NOW = '2026-09-18T09:24:31+08:00'

/* ------------------------------------------------------------- fixtures */

const user = {
  id: '11111111-2222-4333-8444-555555555555',
  username: '林小满',
  school: '华中科技大学',
  major: '软件工程',
  grade: '大三',
  created_at: '2026-08-02T10:12:00+08:00',
}

const tags = [
  { id: 't1', user_id: user.id, dimension: '痛点', label: '缺项目经验', weight: 0.86, source: 'chat', extra: null, updated_at: NOW },
  { id: 't2', user_id: user.id, dimension: '能力', label: '算法基础扎实', weight: 0.72, source: 'test', extra: null, updated_at: NOW },
  { id: 't3', user_id: user.id, dimension: '兴趣', label: '对鸿蒙应用开发感兴趣', weight: 0.64, source: 'chat', extra: null, updated_at: NOW },
]

const profileTested = {
  id: 'p1', user_id: user.id, clarity_score: 68, action_score: 54, resume_score: 41,
  total_score: 54, stage: 'prepare', updated_at: NOW, tested: true, tags, user,
}
const profileUntested = {
  id: 'p2', user_id: user.id, clarity_score: 0, action_score: 0, resume_score: 0,
  total_score: 0, stage: 'explore', updated_at: NOW, tested: false, tags: [], user,
}

const task = {
  id: TASK_ID, user_id: user.id, title: '做一个鸿蒙待办清单小应用',
  description: '从 0 到 1 写一个能跑在真机上的 ArkTS 小应用。', pain_point: '缺项目经验',
  status: '进行中', value_note: '简历上能写成一个完整项目。', difficulty: '中等',
  estimated_days: 14, created_at: '2026-09-10T20:05:00+08:00', updated_at: NOW, progress: 0.4,
}
const taskSteps = [
  { id: 's1', task_id: TASK_ID, step_order: 1, title: '装好 DevEco Studio 并跑通 Hello World', action: '用官网稳定版建模板工程。', resource: null, completed: true, feedback: '顺利。', completed_at: '2026-09-11T21:40:00+08:00' },
  { id: 's2', task_id: TASK_ID, step_order: 2, title: '实现待办列表页与本地存储', action: '用 List 渲染，preferences 存本地。', resource: null, completed: false, feedback: null, completed_at: null },
]
const taskDetail = { ...task, steps: taskSteps }

const resumeDetail = {
  id: RESUME_ID, user_id: user.id, title: '林小满-鸿蒙客户端开发-2026 秋招',
  file_path: `${user.id}/resume.pdf`,
  parsed_data: {
    basics: { name: '林小满', phone: '138****2233', email: 'lin@example.com', city: '武汉', target_job: '鸿蒙应用开发工程师' },
    education: [{ school: '华中科技大学', major: '软件工程', degree: '本科', start: '2023-09', end: '2027-06' }],
    projects: [{ name: '鸿蒙待办清单', role: '独立开发', tech: ['ArkTS'], description: '从 0 到 1。' }],
    skills: ['ArkTS', 'TypeScript'],
  },
  ats_score: 76, completeness: 0.82, target_job: '鸿蒙应用开发工程师',
  created_at: '2026-09-12T15:30:00+08:00', updated_at: NOW,
}

/** N2 用的题目：首屏只给 1 道（贴近后端「答一题给下一题」的增量行为） */
const IV_FIRST_QUESTION = { id: 'q-1', interview_id: SESSION_ID, question_order: 1, content: '先花一分钟介绍一下你自己，重点讲鸿蒙客户端开发相关的部分。', answer: null, followups: [], score: null, created_at: NOW, answered_at: null, kind: 'main', current_followup: null, followup_round: 0 }
const ivQuestionsResponse = {
  interview_id: SESSION_ID, mode: '全真', scene: '项目', status: '进行中',
  questions: [IV_FIRST_QUESTION], current_index: 1,
}

/** N2：answer 依次返回 followup / followup / next_question / finished */
const FOLLOWUP_1 = '（追问）能举个具体例子吗？'
const FOLLOWUP_2 = '（追问·第2轮）那这个例子里的数字是多少？'
const NEW_Q = { id: 'q-2', interview_id: SESSION_ID, question_order: 2, content: '（新题）说说你项目里最得意的一次性能优化。', answer: null, followups: [], score: null, created_at: NOW, answered_at: null, kind: 'main', current_followup: null, followup_round: 0 }
const IV_ANSWER_SEQ = [
  { action: 'followup', is_followup: true, finished: false, question_id: 'q-1', parent_question_id: 'q-1', display_content: FOLLOWUP_1, followup_round: 1, next_question: null, message: '继续聊' },
  { action: 'followup', is_followup: true, finished: false, question_id: 'q-1', parent_question_id: 'q-1', display_content: FOLLOWUP_2, followup_round: 2, next_question: null, message: '再补一句' },
  { action: 'next_question', is_followup: false, finished: false, question_id: 'q-2', parent_question_id: null, display_content: NEW_Q.content, followup_round: 0, next_question: NEW_Q, message: '换下一题' },
  { action: 'finished', is_followup: false, finished: true, question_id: null, parent_question_id: null, display_content: null, followup_round: 0, next_question: null, message: '面试结束' },
].map((x) => ({ ...x, interview_id: SESSION_ID }))

/** N3：逐题点评，含 answer_summary / comment / better_answer */
const REVIEW_ANSWER = '我是软件工程大三学生，做过一个鸿蒙待办清单应用，负责全部客户端开发。'
const REVIEW_COMMENT = '结构完整但缺亮点，建议把最有说服力的一段经历前置。'
const REVIEW_BETTER = '先说结论：两年鸿蒙客户端经验，做过一个 800 日活的小应用，再展开细节。'
const interviewReview = {
  interview_id: SESSION_ID, status: '已完成', overall_score: 71,
  dimension_scores: { 表达清晰度: 74, 项目深度: 66, 技术基础: 78, 岗位匹配: 68 },
  strengths: ['能把项目背景讲清楚，技术选型有理由。', '对 ArkUI 声明式写法理解扎实。'],
  improvements: ['回答里缺少量化结果。', '被追问边界情况时容易泛泛而谈。'],
  question_reviews: [
    { question: '先花一分钟介绍一下你自己。', answer_summary: REVIEW_ANSWER, score: 68, comment: REVIEW_COMMENT, better_answer: REVIEW_BETTER },
  ],
  summary: '整体在及格线以上，项目能讲但不够深。',
  generated_at: NOW,
}

const growthReport = {
  id: 'rp1', user_id: user.id, type: 'growth',
  content: {
    stage: 'prepare', stage_changed: true, clarity_score: 68, action_score: 54, resume_score: 41,
    total_score: 54, score_delta: { clarity_score: 8, action_score: 12, resume_score: 5, total_score: 25 },
    completed_tasks: 1, completed_steps: 7, active_days: 12,
    highlights: ['方向清晰度一周内涨了 8 分。'], suggestions: ['把项目描述补上量化结果。'],
  },
  created_at: NOW,
}

const BADGES = [
  { id: 'ub-1', badge_id: 'badge_starter', name: '起步行动家', condition: { type: 'completed_steps', value: 5 }, obtained_at: '2026-09-14T19:02:00+08:00' },
  { id: 'ub-2', badge_id: 'badge_first_resume', name: '第一份简历', condition: { type: 'resume_created', value: 1 }, obtained_at: '2026-09-12T16:00:00+08:00' },
]

const testQuestions = [
  { id: 'q_clarity_01', dimension: 'clarity', content: '想到未来的工作，你现在的感觉更接近哪一种？', options: [{ key: 'A', text: '完全不知道能做什么', score: 1 }, { key: 'B', text: '有几个方向但都很模糊', score: 2 }, { key: 'C', text: '有一个比较想去的方向', score: 4 }], multiple: false },
  { id: 'q_action_01', dimension: 'action', content: '过去一个月，你为求职做过下面哪件事？', options: [{ key: 'A', text: '还没有开始', score: 1 }, { key: 'B', text: '看过一些岗位要求', score: 2 }], multiple: false },
]
const testResult = { id: 'tr1', user_id: user.id, clarity_score: 68, action_score: 54, resume_score: 41, total_score: 54, stage: 'prepare', created_at: NOW, answers: {}, free_text: null }

/* --------------------------------------------------------------- SSE */

const SSE_DELTAS = ['你提到的「投了几家没回音」，', '通常不是能力问题，', '而是简历里的项目描述没有给出可验证的结果。']
const SSE_EVENTS = [
  { event: 'start', payload: JSON.stringify({ code: 0, message: 'success', data: { type: 'start', conversation_id: CONV_ID, followup_round: 0, followup_direction: '项目经历' } }) },
  ...SSE_DELTAS.map((c) => ({ event: 'delta', payload: JSON.stringify({ code: 0, message: 'success', data: { type: 'delta', content: c, conversation_id: CONV_ID, followup_round: 1, followup_direction: '项目经历' } }) })),
  { event: 'tag', payload: JSON.stringify({ code: 0, message: 'success', data: { type: 'tag', conversation_id: CONV_ID, data: { tags: [{ id: 'nt1', user_id: user.id, dimension: '痛点', label: '简历无量化结果', weight: 0.77, source: 'chat', extra: null, updated_at: NOW }] } } }) },
  { event: 'done', payload: JSON.stringify({ code: 0, message: 'success', data: { type: 'done', conversation_id: CONV_ID, message_id: 'a-9001', followup_round: 2, followup_direction: '项目经历', conclusion_ready: true } }) },
  { event: 'end', payload: '[DONE]' },
]
const sseBody = SSE_EVENTS.map((e) => `event: ${e.event}\ndata: ${e.payload}\n\n`).join('')

/* ------------------------------------------------------- localStorage init */

const TOKEN_INIT = `window.localStorage.setItem(${JSON.stringify(TOKEN_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(TEST_TOKEN)}));`

/**
 * N1 探针：整页重载会让所有 window 标记归零。
 * 同时把 pushState/replaceState 计数暴露出来（SPA 内跳转才会计数）。
 */
const SPA_PROBE = `
  window.__spaAlive = (window.__spaAlive ?? 0) + 1;
  window.__spaMarks = window.__spaMarks ?? { push: 0, replace: 0, pop: 0 };
  if (!window.__historyPatched) {
    window.__historyPatched = true;
    const p = history.pushState.bind(history);
    const r = history.replaceState.bind(history);
    history.pushState = function (...a) { window.__spaMarks.push++; return p(...a); };
    history.replaceState = function (...a) { window.__spaMarks.replace++; return r(...a); };
    window.addEventListener('popstate', () => { window.__spaMarks.pop++; });
  }
`

function envelope(data, status = 200) {
  return { status, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ code: 0, message: 'success', data }) }
}

/** 统一的 /api/v1 mock。每次请求都记录，末尾全量导出。 */
async function installApi(page, opts = {}) {
  const { mode = 'ok', tested = true, badge = 'data', ivAnswerSeq = IV_ANSWER_SEQ } = opts
  const log = []
  let ivAnswerIdx = 0

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const method = req.method().toUpperCase()
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1/, '') || '/'
    log.push({ method, path: p, body: req.postData() ?? null })

    if (mode === 'all401') {
      return route.fulfill({ status: 401, contentType: 'application/json; charset=utf-8', body: JSON.stringify({ code: 1002, message: '登录状态已过期，请重新登录', data: null }) })
    }

    const J = (data) => { const e = envelope(data); return route.fulfill(e) }
    const HEADERS = { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }

    if (method === 'POST' && /^\/chat\/conversations\/[^/]+\/stream$/.test(p)) {
      return route.fulfill({ status: 200, headers: HEADERS, body: sseBody })
    }

    if (method === 'GET' && p === '/auth/me') return J(user)
    if (method === 'POST' && (p === '/auth/login' || p === '/auth/register')) return J({ access_token: TEST_TOKEN, token_type: 'bearer', expires_in: 604800, user })

    if (method === 'GET' && p === '/profile') return J(tested ? profileTested : profileUntested)
    if (method === 'GET' && p === '/profile/tags') return J(tags)
    if (method === 'POST' && p === '/profile/feedback') return J(profileTested)

    if (method === 'GET' && p === '/home/summary') {
      return J({
        stage: 'prepare', stage_label: '求职准备期',
        profile: { clarity_score: 68, action_score: 54, resume_score: 41, total_score: 54, stage: 'prepare', tested: true },
        tags: tags.map((t) => ({ dimension: t.dimension, label: t.label, weight: t.weight, source: t.source })),
        daily_question: { id: 'dq1', content: '最近一次投递没回音，你觉得卡在哪个环节？', options: [], answered: false },
        ai_findings: [{ pain_point: '缺项目经验', label: '缺项目经验', reason: '三轮对话里都提到没有能写进简历的项目。', target_route: '/task' }],
        ongoing_tasks: [{ id: TASK_ID, title: task.title, difficulty: '中等', estimated_days: 14, done_steps: 1, total_steps: 2, current_step_title: '实现待办列表页与本地存储' }],
        next_action: { text: '先把这个鸿蒙小项目的删除交互补完', route: `/task/${TASK_ID}`, reason: '任务已经做到一半。' },
      })
    }

    if (method === 'GET' && p === '/task') return J([task])
    if (method === 'POST' && p === '/task/generate') return J(taskDetail)
    if (method === 'GET' && /^\/task\/[^/]+$/.test(p)) return J(taskDetail)
    if (method === 'POST' && /^\/task\/[^/]+\/steps\/[^/]+\/complete$/.test(p)) return J(taskDetail)
    if (method === 'POST' && /^\/task\/[^/]+\/abandon$/.test(p)) return J({ ...task, status: '已放弃' })

    if (method === 'GET' && p === '/daily/today') return J({ question: { id: 'dq1', dimension: '焦虑', content: '最近一次投递没回音，你觉得卡在哪个环节？', options: null, created_at: NOW }, answered: false, answer: null, streak: 4 })
    if (method === 'POST' && p === '/daily/answer') return J({ id: 'da1', user_id: user.id, question_id: 'dq1', answer: '大概是简历里的项目描述太虚了。', answered_at: NOW, profile_refreshed: true, extracted_tags: [] })

    // 新链路只用 GET /resume/template、GET|PUT /resume/mine、POST /resume/polish（无 stub）。
    // 这三条 GET/PUT 端点都落在下面这条通配的上，所以它不能跟着老端点一起删。
    if (method === 'GET' && /^\/resume\/[^/]+$/.test(p)) return J(resumeDetail)
    if (method === 'PUT' && /^\/resume\/[^/]+$/.test(p)) return J(resumeDetail)

    if (method === 'GET' && p === '/report') return J(growthReport)

    /* N4：奖章两态 */
    if (method === 'GET' && p === '/badge') return J(badge === 'empty' ? [] : BADGES)

    if (method === 'GET' && p === '/test/questions') return J(testQuestions)
    if (method === 'POST' && p === '/test/submit') return J(testResult)
    if (method === 'GET' && p === '/test/result') return J(testResult)

    if (method === 'POST' && p === '/interview/start') return J({ id: SESSION_ID, user_id: user.id, mode: '全真', scene: '项目', status: '进行中', created_at: NOW, updated_at: NOW, report: null })
    if (method === 'GET' && /^\/interview\/[^/]+\/questions$/.test(p)) return J(ivQuestionsResponse)
    /* N2：按序列返回 action */
    if (method === 'POST' && /^\/interview\/[^/]+\/answer$/.test(p)) {
      const item = ivAnswerSeq[Math.min(ivAnswerIdx, ivAnswerSeq.length - 1)]
      ivAnswerIdx += 1
      return J(item)
    }
    if (method === 'POST' && /^\/interview\/[^/]+\/finish$/.test(p)) return J({ interview_id: SESSION_ID, status: '已完成', report: null })
    if (method === 'GET' && /^\/interview\/[^/]+\/review$/.test(p)) return J(interviewReview)

    if (method === 'GET' && p === '/chat/conversations') return J([{ id: CONV_ID, user_id: user.id, title: '投了几家没回音', created_at: '2026-09-17T20:11:00+08:00', updated_at: NOW, message_count: 1, conclusion: null, followup_direction: '项目经历', followup_round: 1 }])
    if (method === 'POST' && p === '/chat/conversations') return J({ id: CONV_ID, user_id: user.id, title: '新对话', created_at: NOW, updated_at: NOW, message_count: 0, conclusion: null, followup_direction: null, followup_round: 0 })
    if (method === 'GET' && /^\/chat\/conversations\/[^/]+\/messages$/.test(p)) return J([{ id: 'm1', conversation_id: CONV_ID, role: 'assistant', content: '先从你投的岗位和简历逐条对一遍关键词。', client_msg_id: null, created_at: NOW }])
    if (method === 'POST' && /^\/chat\/conversations\/[^/]+\/messages$/.test(p)) return J({ conversation_id: CONV_ID, user_message: { id: 'm3', conversation_id: CONV_ID, role: 'user', content: 'x', client_msg_id: 'c3', created_at: NOW }, assistant_message: { id: 'm4', conversation_id: CONV_ID, role: 'assistant', content: 'y', client_msg_id: null, created_at: NOW }, extracted_tags: [] })
    if (method === 'GET' && /^\/chat\/conversations\/[^/]+\/conclusion$/.test(p)) return J({ conversation_id: CONV_ID, summary: '卡点在简历里没有可验证的成果。', pain_points: ['项目描述没有量化结果'], suggestions: ['每个项目补一条数字结果'], next_actions: ['今天就改第一个项目'], generated_at: NOW })

    if (method === 'POST' && p === '/events') return J(null)

    return J(null)
  })

  return { log, getIvAnswerCalls: () => log.filter((x) => /\/answer$/.test(x.path)) }
}

/* ------------------------------------------------------------ collectors */

function attach(page, store) {
  page.on('pageerror', (e) => store.pageErrors.push({ message: String(e.message ?? e), stack: String(e.stack ?? '') }))
  page.on('console', (m) => { if (m.type() === 'error') store.consoleErrors.push(m.text()) })
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) store.frameNavigations.push(f.url()) })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function gotoWithFallback(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 })
    return 'networkidle'
  } catch (err) {
    if (!/Timeout/i.test(String(err.message))) throw err
    await page.goto(url, { waitUntil: 'load', timeout: 25000 })
    await sleep(800)
    return 'load(fallback)'
  }
}

const snap = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('#root')
    const bodyText = document.body ? document.body.innerText.trim() : ''
    return {
      rootChildren: root ? root.children.length : -1,
      bodyText,
      len: bodyText.length,
      hasTextarea: !!document.querySelector('textarea'),
      inputCount: document.querySelectorAll('input').length,
      spaAlive: window.__spaAlive ?? null,
      spaMarks: window.__spaMarks ?? null,
      navType: performance.getEntriesByType('navigation')[0]?.type ?? null,
      navCount: performance.getEntriesByType('navigation').length,
    }
  })

const isNoise = (t) => /favicon/i.test(t) || /React DevTools/i.test(t) || /ResizeObserver loop/i.test(t) || /status of 401/i.test(t)

/* ----------------------------------------------------------------- routes */

const ROUTES = [
  { n: 1, path: '/login', name: 'login', expect: '/login' },
  { n: 2, path: '/register', name: 'register', expect: '/register' },
  { n: 3, path: '/test/intro', name: 'test-intro', expect: '/', verifiedAs: 'redirect-to-home-when-tested' },
  { n: 4, path: '/test/question', name: 'test-question', expect: '/test/question' },
  { n: 5, path: '/test/result', name: 'test-result', expect: '/test/result' },
  { n: 6, path: '/', name: 'home', expect: '/' },
  { n: 7, path: '/chat', name: 'chat', expect: '/chat' },
  { n: 8, path: '/task', name: 'task-list', expect: '/task' },
  { n: 9, path: `/task/${TASK_ID}`, name: 'task-detail', expect: `/task/${TASK_ID}` },
  { n: 10, path: '/profile', name: 'profile', expect: '/profile' },
  { n: 11, path: '/daily', name: 'daily', expect: '/daily' },
  { n: 12, path: '/resume', name: 'resume', expect: '/resume' },
  { n: 13, path: '/interview', name: 'interview-select', expect: '/interview' },
  { n: 14, path: '/interview/prepare', name: 'interview-prepare', expect: '/interview/prepare' },
  { n: 15, path: '/interview/session', name: 'interview-session', expect: '/interview/session', session: true },
  { n: 16, path: `/interview/review/${SESSION_ID}`, name: 'interview-review', expect: `/interview/review/${SESSION_ID}` },
  { n: 17, path: '/report', name: 'growth-report', expect: '/report' },
  { n: 18, path: '/404', name: '404', expect: '/404' },
  { n: 19, path: '/this-route-does-not-exist', name: 'wildcard-404', expect: '/this-route-does-not-exist' },
]

/* ------------------------------------------------------------------- run */

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true })
  const out = { baseUrl: BASE_URL, round: 2, startedAt: new Date().toISOString(), routes: [], scenarios: {}, newAssertions: {}, summary: {} }

  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })

  /* ===================== ① 全量回归 19 条路由 ===================== */
  for (const r of ROUTES) {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
    attach(page, store)
    const { log } = await installApi(page, {})
    const e = { index: r.n, path: r.path, name: r.name, screenshot: `shots/${String(r.n).padStart(2, '0')}-${r.name}.png` }
    try {
      await page.addInitScript(SPA_PROBE + TOKEN_INIT + (r.session ? `window.sessionStorage.setItem(${JSON.stringify(INTERVIEW_ID_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(SESSION_ID)}));` : ''))
      e.waitMode = await gotoWithFallback(page, BASE_URL + r.path)
      await sleep(700)
      const s = await snap(page)
      e.finalUrl = new URL(page.url()).pathname + new URL(page.url()).search
      e.urlOk = e.finalUrl === r.expect
      e.expectedUrl = r.expect
      e.renderedText = s.len
      e.rootChildren = s.rootChildren
      e.blank = s.rootChildren <= 0 && s.len === 0
      e.errorBoundary = ERROR_BOUNDARY_PHRASES.some((ph) => s.bodyText.includes(ph))
      e.bodySample = s.bodyText.slice(0, 260)
      e.apiCalls = [...new Set(log.map((x) => `${x.method} ${x.path}`))]
      e.pageErrors = store.pageErrors
      e.consoleErrorCount = store.consoleErrors.length
      e.consoleErrors = store.consoleErrors
      e.consoleReal = store.consoleErrors.filter((t) => !isNoise(t))
      await page.screenshot({ path: path.join(SHOTS_DIR, `${String(r.n).padStart(2, '0')}-${r.name}.png`), fullPage: true })
      const reasons = []
      if (e.blank) reasons.push('白屏')
      if (e.errorBoundary) reasons.push('落 ErrorBoundary')
      if (e.pageErrors.length) reasons.push(`pageerror x${e.pageErrors.length}`)
      if (!e.urlOk) reasons.push(`URL=${e.finalUrl} 期望 ${r.expect}`)
      if (e.renderedText < 10) reasons.push(`文本过少 ${e.renderedText}`)
      e.verdict = reasons.length ? 'FAIL' : 'PASS'
      e.notes = reasons
    } catch (err) {
      e.verdict = 'FAIL'
      e.notes = [`采集抛错: ${err.message}`]
      e.pageErrors = store.pageErrors
    }
    out.routes.push(e)
    console.log(`[R${String(r.n).padStart(2, '0')}] ${e.verdict} ${r.path} -> ${e.finalUrl} text=${e.renderedText} err=${e.consoleErrorCount}`)
    await page.close()
  }

  /* ===================== 场景 A：无 token ===================== */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
    attach(page, store)
    await installApi(page, {})
    const a = {}
    try {
      await page.addInitScript(SPA_PROBE + `window.localStorage.removeItem(${JSON.stringify(TOKEN_STORAGE_KEY)});`)
      await gotoWithFallback(page, BASE_URL + '/')
      await sleep(900)
      const s = await snap(page)
      a.finalUrl = new URL(page.url()).pathname
      a.redirectedToLogin = a.finalUrl === '/login'
      a.renderedText = s.len
      a.hasPasswordInput = await page.evaluate(() => !!document.querySelector('input[type="password"]'))
      a.bodySample = s.bodyText.slice(0, 200)
      a.blank = s.rootChildren <= 0 && s.len === 0
      a.pageErrors = store.pageErrors
      await page.screenshot({ path: path.join(SHOTS_DIR, 'A-no-token-login.png'), fullPage: true })
      a.verdict = a.redirectedToLogin && !a.blank && a.hasPasswordInput ? 'PASS' : 'FAIL'
    } catch (err) { a.error = err.message; a.verdict = 'FAIL' }
    out.scenarios.A = a
    console.log(`[A] ${a.verdict} -> ${a.finalUrl}`)
    await page.close()
  }

  /* ============ 场景 B + N1：全 401，且必须不整页重载 ============ */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
    attach(page, store)
    await installApi(page, { mode: 'all401' })
    const b = { spaLiveness: {} }
    try {
      await page.addInitScript(SPA_PROBE + TOKEN_INIT)
      const gotoMode = await gotoWithFallback(page, BASE_URL + '/')
      b.waitMode = gotoMode
      // 记录落地 / 之后 3 秒内的所有证据
      await sleep(3000)
      const s = await snap(page)
      b.finalUrl = new URL(page.url()).pathname
      b.redirectedToLogin = b.finalUrl === '/login'
      b.renderedText = s.len
      b.hasPasswordInput = await page.evaluate(() => !!document.querySelector('input[type="password"]'))
      b.blank = s.rootChildren <= 0 && s.len === 0
      b.bodySample = s.bodyText.slice(0, 220)

      /* ---- N1 断言 ---- */
      b.spaLiveness = {
        spaAlive: s.spaAlive,               // 1 = 从未整页重载；>1 说明被重载过
        spaMarks: s.spaMarks,               // pushState/replaceState 计数
        navType: s.navType,                 // 'navigate' | 'reload' | 'back_forward'
        navCount: s.navCount,               // performance navigation entries 数
        frameNavigations: store.frameNavigations,
        frameNavigationCount: store.frameNavigations.length,
      }
      b.n1_verdict =
        s.spaAlive === 1 &&
        s.navType === 'navigate' &&
        (s.spaMarks?.replace ?? 0) + (s.spaMarks?.push ?? 0) >= 1 &&
        b.redirectedToLogin &&
        !b.blank &&
        b.hasPasswordInput
          ? 'PASS'
          : 'FAIL'
      b.n1_reason = []
      if (s.spaAlive !== 1) b.n1_reason.push(`__spaAlive=${s.spaAlive}（>1 表示发生过整页重载）`)
      if (s.navType !== 'navigate') b.n1_reason.push(`navigation.type=${s.navType}`)
      if ((s.spaMarks?.replace ?? 0) + (s.spaMarks?.push ?? 0) < 1) b.n1_reason.push('history.replaceState/pushState 未被调用，不像是 SPA 内跳转')
      if (!b.redirectedToLogin) b.n1_reason.push(`最终 URL=${b.finalUrl}`)
      if (b.blank) b.n1_reason.push('白屏')

      b.pageErrors = store.pageErrors
      b.consoleErrors = store.consoleErrors
      b.consoleReal = store.consoleErrors.filter((t) => !isNoise(t))
      b.verdict = b.n1_verdict
      await page.screenshot({ path: path.join(SHOTS_DIR, 'B-all-401.png'), fullPage: true })
    } catch (err) { b.error = err.message; b.verdict = 'FAIL'; b.n1_verdict = 'FAIL' }
    out.scenarios.B = b
    out.newAssertions.N1 = { name: '401 之后没有整页重载（SPA 内跳转）', verdict: b.n1_verdict, evidence: b.spaLiveness, reasons: b.n1_reason }
    console.log(`[B/N1] ${b.n1_verdict} -> ${b.finalUrl} spaAlive=${b.spaLiveness?.spaAlive} navType=${b.spaLiveness?.navType}`)
    await page.close()
  }

  /* ===================== 场景 D：token 但未测评 ===================== */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
    attach(page, store)
    await installApi(page, { tested: false })
    const d = {}
    try {
      await page.addInitScript(SPA_PROBE + TOKEN_INIT)
      await gotoWithFallback(page, BASE_URL + '/')
      await sleep(1200)
      let s = await snap(page)
      d.finalUrlOnSlash = new URL(page.url()).pathname
      d.funnelRedirectToIntro = d.finalUrlOnSlash === '/test/intro'
      await gotoWithFallback(page, BASE_URL + '/test/intro')
      await sleep(900)
      s = await snap(page)
      d.introFinalUrl = new URL(page.url()).pathname
      d.introRendersGuide = s.bodyText.includes('先花 3 分钟做个职业测评')
      d.introText = s.bodyText.slice(0, 220)
      d.pageErrors = store.pageErrors
      d.verdict = d.funnelRedirectToIntro && d.introRendersGuide ? 'PASS' : 'FAIL'
      await page.screenshot({ path: path.join(SHOTS_DIR, 'D-untested-intro.png'), fullPage: true })
    } catch (err) { d.error = err.message; d.verdict = 'FAIL' }
    out.scenarios.D = d
    console.log(`[D] ${d.verdict} -> ${d.finalUrlOnSlash} / ${d.introFinalUrl}`)
    await page.close()
  }

  /* ===================== 场景 C：流式对话（沿用第一轮口径）===================== */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
    attach(page, store)
    const { log } = await installApi(page, {})
    const c = { deltaTexts: SSE_DELTAS, expectedFull: SSE_DELTAS.join('') }
    try {
      await page.addInitScript(SPA_PROBE + TOKEN_INIT)
      await gotoWithFallback(page, BASE_URL + '/chat')
      await sleep(1100)
      c.textareaCount = await page.locator('textarea').count()
      await page.locator('textarea').first().fill('我投了几家都没回音，简历我也改过。')
      await page.getByRole('button', { name: /发送/ }).first().click()
      await sleep(2000)
      const body = await page.evaluate(() => document.body.innerText)
      c.finalFullTextPresent = body.includes(c.expectedFull)
      c.userEcho = body.includes('简历我也改过')
      c.followupProgressText = (body.match(/追问进度\s*\d+\/3/) ?? [null])[0]
      c.conclusionCardVisible = body.includes('结论卡片')
      c.streamRequest = log.find((x) => /\/stream$/.test(x.path)) ?? null
      c.pageErrors = store.pageErrors
      c.verdict = c.streamRequest && c.finalFullTextPresent && c.userEcho && c.followupProgressText && !store.pageErrors.length ? 'PASS' : 'FAIL'
      await page.screenshot({ path: path.join(SHOTS_DIR, 'C-chat-stream-final.png'), fullPage: true })
    } catch (err) { c.error = err.message; c.verdict = 'FAIL' }
    out.scenarios.C = c
    console.log(`[C] ${c.verdict} full=${c.finalFullTextPresent} progress=${c.followupProgressText}`)
    await page.close()
  }

  /* ===================== N2：面试追问就地续问状态机 ===================== */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
    attach(page, store)
    const { log } = await installApi(page, {})
    const n2 = { steps: [] }
    try {
      await page.addInitScript(SPA_PROBE + TOKEN_INIT + `window.sessionStorage.setItem(${JSON.stringify(INTERVIEW_ID_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(SESSION_ID)}));`)
      await gotoWithFallback(page, BASE_URL + '/interview/session')
      await sleep(1000)

      const readState = async () => {
        const s = await page.evaluate(() => {
          const body = document.body.innerText
          // 「第 1 / 3 题」以及可选的「· 追问 1/2」后缀，拆开记录
          const m = body.match(/第\s*(\d+)\s*\/\s*(\d+)\s*题(\s*·\s*追问\s*(\d+)\/2)?/)
          const ta = document.querySelector('textarea')
          return {
            body,
            counterRaw: m ? m[0].replace(/\s+/g, ' ').trim() : null,
            qNo: m ? Number(m[1]) : null,
            qTotal: m ? Number(m[2]) : null,
            followupBadge: m && m[4] ? `追问 ${m[4]}/2` : null,
            textareaPlaceholder: ta?.getAttribute('placeholder') ?? null,
            buttonLabels: Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
          }
        })
        return s
      }

      const answerOnce = async (label) => {
        const before = await readState()
        await page.locator('textarea').first().fill(label)
        // 主按钮：'提交并继续' 或 '回答追问'
        const btn = page.getByRole('button', { name: /提交并继续|回答追问|提交中/ }).first()
        await btn.click()
        await sleep(1100)
        const after = await readState()
        return { before, after }
      }

      const step1 = await answerOnce('我的回答第一版')
      await page.screenshot({ path: path.join(SHOTS_DIR, 'N2-step1-followup1.png'), fullPage: true })
      n2.steps.push({
        step: 1, expectAction: 'followup(round=1)',
        counterBefore: step1.before.counterRaw, counterAfter: step1.after.counterRaw,
        qNoBefore: step1.before.qNo, qNoAfter: step1.after.qNo,
        qTotalBefore: step1.before.qTotal, qTotalAfter: step1.after.qTotal,
        followupTextRendered: step1.after.body.includes(FOLLOWUP_1),
        followupRoundBadge: step1.after.followupBadge,
        mainQuestionStillShown: step1.after.body.includes('先花一分钟介绍一下你自己'),
        placeholderAfter: step1.after.textareaPlaceholder,
        mainButtonAfter: step1.after.buttonLabels.find((x) => /追问|提交/.test(x)) ?? null,
        bodySample: step1.after.body,
      })

      const step2 = await answerOnce('我的回答第二版')
      n2.steps.push({
        step: 2, expectAction: 'followup(round=2)',
        counterBefore: step2.before.counterRaw, counterAfter: step2.after.counterRaw,
        qNoBefore: step2.before.qNo, qNoAfter: step2.after.qNo,
        qTotalBefore: step2.before.qTotal, qTotalAfter: step2.after.qTotal,
        followupTextRendered: step2.after.body.includes(FOLLOWUP_2),
        followupRoundBadge: step2.after.followupBadge,
        bodySample: step2.after.body,
      })

      const step3 = await answerOnce('我的回答第三版')
      await page.screenshot({ path: path.join(SHOTS_DIR, 'N2-step3-next-question.png'), fullPage: true })
      n2.steps.push({
        step: 3, expectAction: 'next_question',
        counterBefore: step3.before.counterRaw, counterAfter: step3.after.counterRaw,
        qNoBefore: step3.before.qNo, qNoAfter: step3.after.qNo,
        qTotalBefore: step3.before.qTotal, qTotalAfter: step3.after.qTotal,
        newQuestionRendered: step3.after.body.includes('最得意的一次性能优化'),
        followupTextGone: !step3.after.body.includes(FOLLOWUP_2),
        followupBadgeGone: step3.after.followupBadge === null,
        bodySample: step3.after.body,
      })

      const step4 = await answerOnce('我的回答第四版')
      await sleep(1500)
      const after4 = await page.evaluate(() => document.body.innerText)
      n2.steps.push({
        step: 4, expectAction: 'finished',
        finalUrl: new URL(page.url()).pathname,
        reviewRendered: after4.includes('面试复盘'),
        bodySample: after4,
      })

      n2.answerCalls = log.filter((x) => /\/answer$/.test(x.path)).map((x) => x.body)
      n2.finishCalls = log.filter((x) => /\/finish$/.test(x.path)).map((x) => `${x.method} ${x.path}`)
      n2.finalUrl = new URL(page.url()).pathname
      n2.pageErrors = store.pageErrors
      n2.consoleErrors = store.consoleErrors
      n2.consoleReal = store.consoleErrors.filter((t) => !isNoise(t))

      const s1 = n2.steps[0], s2 = n2.steps[1], s3 = n2.steps[2], s4 = n2.steps[3]
      const problems = []
      n2.invariants = {
        step1_questionNumberUnchanged: s1.qNoAfter === s1.qNoBefore,
        step1_totalUnchanged: s1.qTotalAfter === s1.qTotalBefore,
        step2_questionNumberUnchanged: s2.qNoAfter === s2.qNoBefore,
        step2_totalUnchanged: s2.qTotalAfter === s2.qTotalBefore,
      }
      if (!s1.followupTextRendered) problems.push('第1次作答后没渲染追问句')
      if (s1.qNoAfter !== s1.qNoBefore) problems.push(`followup 后题号前进: 第${s1.qNoBefore}题 -> 第${s1.qNoAfter}题`)
      if (s1.qTotalAfter !== s1.qTotalBefore) problems.push(`followup 后题目总数增加: ${s1.qTotalBefore} -> ${s1.qTotalAfter}`)
      if (!s1.mainQuestionStillShown) problems.push('followup 后主问题原文消失了')
      if (!s2.followupTextRendered) problems.push('第2次作答后没渲染第2轮追问句')
      if (s2.qNoAfter !== s2.qNoBefore) problems.push(`第2次 followup 后题号前进: ${s2.qNoBefore} -> ${s2.qNoAfter}`)
      if (s2.qTotalAfter !== s2.qTotalBefore) problems.push(`第2次 followup 后题目总数增加: ${s2.qTotalBefore} -> ${s2.qTotalAfter}`)
      if (!s3.newQuestionRendered) problems.push('第3次作答后没渲染新题面')
      if (s3.qNoAfter === null || s3.qNoAfter <= s3.qNoBefore) problems.push(`next_question 后题号未前进: ${s3.qNoBefore} -> ${s3.qNoAfter}`)
      if (!s3.followupTextGone) problems.push('next_question 后上一轮追问句仍在')
      if (!s3.followupBadgeGone) problems.push('next_question 后「追问 N/2」标记仍在')
      if (n2.answerCalls.length !== 4) problems.push(`answer 调用 ${n2.answerCalls.length} 次，期望 4`)
      if (n2.finishCalls.length !== 1) problems.push(`finish 调用 ${n2.finishCalls.length} 次，期望 1`)
      if (!/review/.test(n2.finalUrl)) problems.push(`第4次作答后未跳复盘页，最终 ${n2.finalUrl}`)
      if (!s4.reviewRendered) problems.push('复盘页未渲染')
      if (store.pageErrors.length) problems.push(`pageerror x${store.pageErrors.length}`)
      n2.problems = problems
      n2.verdict = problems.length ? 'FAIL' : 'PASS'
      await page.screenshot({ path: path.join(SHOTS_DIR, 'N2-step4-review.png'), fullPage: true })
    } catch (err) { n2.error = err.message; n2.verdict = 'FAIL' }
    out.newAssertions.N2 = { name: '面试追问就地续问状态机', ...n2 }
    console.log(`[N2] ${n2.verdict} ${JSON.stringify(n2.problems ?? [])}`)
    await page.close()
  }

  /* ===================== N3：复盘页不再是原始 JSON ===================== */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
    attach(page, store)
    await installApi(page, {})
    const n3 = {}
    try {
      await page.addInitScript(SPA_PROBE + TOKEN_INIT)
      await gotoWithFallback(page, BASE_URL + `/interview/review/${SESSION_ID}`)
      await sleep(1200)
      const body = await page.evaluate(() => document.body.innerText)
      n3.bodyText = body
      n3.answerSummaryRendered = body.includes(REVIEW_ANSWER)
      n3.commentRendered = body.includes(REVIEW_COMMENT)
      n3.betterAnswerRendered = body.includes(REVIEW_BETTER)
      n3.labels = ['你的回答', '更好的答法'].filter((x) => body.includes(x))
      // 扫「带引号花括号的 JSON 片段」
      n3.jsonLikeMatches = body.match(/\{\s*"|\"\s*:\s*"|\[\s*\{/g) ?? []
      n3.jsonLikeCount = n3.jsonLikeMatches.length
      n3.jsonSnippets = (body.match(/[^\n]*\{\s*"[^\n]*/g) ?? []).map((x) => x.trim()).slice(0, 5)
      n3.quoteKeySnippets = (body.match(/[^\n]*"(question|answer_summary|better_answer|score|comment)"\s*:[^\n]*/g) ?? []).map((x) => x.trim()).slice(0, 5)
      n3.pageErrors = store.pageErrors
      const problems = []
      if (!n3.answerSummaryRendered) problems.push('未渲染 answer_summary 内容')
      if (!n3.commentRendered) problems.push('未渲染 comment 内容')
      if (n3.jsonLikeCount > 0) problems.push(`正文出现 ${n3.jsonLikeCount} 处类 JSON 片段`)
      if (n3.pageErrors.length) problems.push(`pageerror x${n3.pageErrors.length}`)
      n3.problems = problems
      n3.verdict = problems.length ? 'FAIL' : 'PASS'
      await page.screenshot({ path: path.join(SHOTS_DIR, 'N3-interview-review.png'), fullPage: true })
    } catch (err) { n3.error = err.message; n3.verdict = 'FAIL' }
    out.newAssertions.N3 = { name: '复盘逐题点评按字段渲染，无原始 JSON', ...n3 }
    console.log(`[N3] ${n3.verdict} answer=${n3.answerSummaryRendered} comment=${n3.commentRendered} jsonLike=${n3.jsonLikeCount}`)
    await page.close()
  }

  /* ===================== N4：个人中心奖章两态 ===================== */
  for (const mode of ['data', 'empty']) {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
    attach(page, store)
    const { log } = await installApi(page, { badge: mode })
    const n4 = { mode }
    try {
      await page.addInitScript(SPA_PROBE + TOKEN_INIT)
      await gotoWithFallback(page, BASE_URL + '/profile')
      await sleep(1300)
      const body = await page.evaluate(() => document.body.innerText)
      n4.badgeRequested = log.some((x) => x.path === '/badge')
      n4.hasSection = body.includes('我的奖章')
      n4.badgeNames = mode === 'data' ? BADGES.map((b) => b.name).filter((n) => body.includes(n)) : []
      n4.emptyStateText = body.includes('还没有奖章') ? '还没有奖章。去任务列表做一个小任务，完成第一步就能拿到。' : null
      n4.loadingText = body.includes('正在读你的奖章') ? '正在读你的奖章…' : null
      n4.bodySample = body.slice(0, 700)
      n4.pageErrors = store.pageErrors
      const problems = []
      if (!n4.badgeRequested) problems.push('未调用 GET /badge')
      if (!n4.hasSection) problems.push('页面没有「我的奖章」区块')
      if (mode === 'data' && n4.badgeNames.length !== BADGES.length) problems.push(`有数据态只渲染了 ${n4.badgeNames.length}/${BADGES.length} 枚奖章`)
      if (mode === 'empty' && !n4.emptyStateText) problems.push('空数组态没有出现空态句子')
      if (n4.pageErrors.length) problems.push(`pageerror x${n4.pageErrors.length}`)
      n4.problems = problems
      n4.verdict = problems.length ? 'FAIL' : 'PASS'
      await page.screenshot({ path: path.join(SHOTS_DIR, `N4-badge-${mode}.png`), fullPage: true })
    } catch (err) { n4.error = err.message; n4.verdict = 'FAIL' }
    out.newAssertions[`N4-${mode}`] = { name: `奖章区块(${mode})`, ...n4 }
    console.log(`[N4-${mode}] ${n4.verdict} names=${JSON.stringify(n4.badgeNames)} empty=${!!n4.emptyStateText}`)
    await page.close()
  }

  /* ===================== N5：?retest=1 / 无参数 / 有进度 ===================== */
  {
    const cases = [
      { key: 'retest', url: '/test/intro?retest=1', seedProgress: false, expectUrl: '/test/intro?retest=1' },
      { key: 'noParam', url: '/test/intro', seedProgress: false, expectUrl: '/' },
      // 个人中心「继续上次答题」入口只在 TestIntroPage 上渲染卡片，
      // 而 tested=true 时无参数会被静默弹回 /，所以带进度必须走 ?retest=1 才看得到入口
      { key: 'retestWithProgress', url: '/test/intro?retest=1', seedProgress: true, expectUrl: '/test/intro?retest=1' },
      // 对照：有进度但无参数 → 仍按原行为回首页（卡片与入口都不渲染）
      { key: 'progressNoParam', url: '/test/intro', seedProgress: true, expectUrl: '/' },
      // 实测追问：未测评(tested=false) + 有进度 + 无参数，引导页到底渲不渲染"继续上次答题"
      { key: 'untestedWithProgress', url: '/test/intro', seedProgress: true, tested: false, expectUrl: '/test/intro', probeOnly: true },
    ]
    const n5 = { cases: [] }
    for (const c of cases) {
      const page = await context.newPage()
      const store = { pageErrors: [], consoleErrors: [], frameNavigations: [] }
      attach(page, store)
      await installApi(page, { tested: c.tested !== false })
      const rec = { key: c.key, url: c.url, seedProgress: c.seedProgress }
      try {
        await page.addInitScript(
          SPA_PROBE + TOKEN_INIT +
          (c.seedProgress
            ? `window.sessionStorage.setItem(${JSON.stringify(TEST_PROGRESS_STORAGE_KEY)}, JSON.stringify({index:1,answers:{"q_clarity_01":"C"},skipped:[]}));`
            : `window.sessionStorage.removeItem(${JSON.stringify(TEST_PROGRESS_STORAGE_KEY)});`),
        )
        await gotoWithFallback(page, BASE_URL + c.url)
        await sleep(1200)
        const body = await page.evaluate(() => document.body.innerText)
        rec.finalUrl = new URL(page.url()).pathname + new URL(page.url()).search
        rec.renderedText = body.length
        rec.hasRetestCard = body.includes('重新做一次职业测评')
        rec.hasRetestConfirmDesc = body.includes('重测会更新你当前的三项分数与阶段判断')
        rec.hasNormalIntro = body.includes('先花 3 分钟做个职业测评')
        rec.hasContinuePrompt = body.includes('上次还有没提交完的作答')
        rec.continueButton = body.includes('继续上次答题')
        rec.startButton = (body.match(/开始(重新)?测评/) ?? [null])[0]
        rec.bodySample = body.slice(0, 420)
        rec.pageErrors = store.pageErrors
        rec.problems = []
        if (c.key === 'retest') {
          if (rec.finalUrl !== '/test/intro?retest=1') rec.problems.push(`不应跳走，实际 ${rec.finalUrl}`)
          if (!rec.hasRetestCard) rec.problems.push('没出现重测确认卡')
          if (!rec.hasRetestConfirmDesc) rec.problems.push('重测确认卡缺说明文案')
        }
        if (c.key === 'retestWithProgress') {
          if (rec.finalUrl !== '/test/intro?retest=1') rec.problems.push(`不应跳走，实际 ${rec.finalUrl}`)
          if (!rec.hasRetestCard) rec.problems.push('没出现重测确认卡')
          if (!rec.hasContinuePrompt) rec.problems.push('有答题进度时没出现「继续上次答题」提示')
          if (!rec.continueButton) rec.problems.push('没渲染「继续上次答题」按钮')
        }
        if (c.key === 'noParam' || c.key === 'progressNoParam') {
          if (rec.finalUrl !== '/') rec.problems.push(`期望回到 /，实际 ${rec.finalUrl}`)
          if (rec.hasContinuePrompt) rec.problems.push('已弹回首页却仍渲染了进度提示')
        }
        if (c.key === 'untestedWithProgress') {
          // 探测题：只记录事实，不作为 pass/fail 判定
          rec.observation = {
            note: 'tested=false + 有进度 + 无参数：核实引导页是否渲染「继续上次答题」',
            stayedOnIntro: rec.finalUrl.startsWith('/test/intro'),
            continueEntryVisible: rec.hasContinuePrompt && rec.continueButton,
          }
          if (rec.finalUrl !== '/test/intro') rec.problems.push(`未测评用户被弹走了: ${rec.finalUrl}`)
          if (!rec.hasContinuePrompt) rec.problems.push('实测确认：未测评+有进度时，引导页未渲染「继续上次答题」')
        }
        if (store.pageErrors.length) rec.problems.push(`pageerror x${store.pageErrors.length}`)
        rec.verdict = rec.problems.length ? 'FAIL' : 'PASS'
        await page.screenshot({ path: path.join(SHOTS_DIR, `N5-${c.key}.png`), fullPage: true })
      } catch (err) { rec.error = err.message; rec.verdict = 'FAIL' }
      n5.cases.push(rec)
      console.log(`[N5-${c.key}] ${rec.verdict} -> ${rec.finalUrl}`)
      await page.close()
    }
    n5.verdict = n5.cases.every((c) => c.verdict === 'PASS') ? 'PASS' : 'FAIL'
    out.newAssertions.N5 = { name: '?retest=1 / 无参数 / 有进度 三态', ...n5 }
  }

  await browser.close()

  /* --------------------------------------------------------- summary */
  const rp = out.routes.filter((r) => r.verdict === 'PASS').length
  const rf = out.routes.length - rp
  out.summary = {
    regressionRoutes: { total: out.routes.length, pass: rp, fail: rf, failed: out.routes.filter((r) => r.verdict === 'FAIL').map((r) => `${r.path} (${r.notes.join('; ')})`) },
    scenarios: Object.fromEntries(Object.entries(out.scenarios).map(([k, v]) => [k, v.verdict])),
    newAssertions: Object.fromEntries(Object.entries(out.newAssertions).map(([k, v]) => [k, v.verdict])),
    anyBlank: out.routes.some((r) => r.blank),
    anyPageError: out.routes.some((r) => r.pageErrors.length > 0),
    anyErrorBoundary: out.routes.some((r) => r.errorBoundary),
    consoleErrorTotal: out.routes.reduce((s, r) => s + (r.consoleErrorCount ?? 0), 0),
  }
  out.finishedAt = new Date().toISOString()
  await writeFile(path.join(__dirname, 'report-round2.json'), JSON.stringify(out, null, 2), 'utf8')

  console.log('\n================ ROUND-2 SUMMARY ================')
  console.log(JSON.stringify(out.summary, null, 2))
}

main().catch(async (err) => {
  console.error('FATAL', err)
  try { await writeFile(path.join(__dirname, 'report-round2.fatal.json'), JSON.stringify({ fatal: String(err.stack ?? err) }, null, 2), 'utf8') } catch { /* ignore */ }
  process.exitCode = 1
})
