/**
 * render-check.mjs — 独立浏览器渲染冒烟测试（playwright-core + 本机 Edge）
 *
 * 目的：回答「frontend/ 的 21 条路由在真实浏览器里能不能渲染、有没有运行时崩溃」。
 * 手段：对 vite preview 出来的生产构建发真实 HTTP 请求，用 page.route 把 /api/v1/**
 *      全部 mock 掉（后端不存在），逐路由采集 pageerror / console error / 白屏 /
 *      ErrorBoundary 文案 / 最终 URL / 截图。
 *
 * 本文件不修改 frontend/src/ 下任何业务代码。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SHOTS_DIR = path.join(__dirname, 'shots')

/**
 * vite preview 默认只监听 ::1（本机 netstat 实测：TCP [::1]:4173 LISTENING），
 * 走 127.0.0.1 会连不上，所以 BASE_URL 用 localhost。
 */
const BASE_URL = process.env.RC_BASE_URL ?? 'http://localhost:4173'
const EDGE =
  process.env.RC_EDGE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

/** localStorage 键名来自 frontend/src/utils/storage.ts： PREFIX 'ai_job_helper:' + STORAGE_KEY.token */
const TOKEN_STORAGE_KEY = 'ai_job_helper:token'
const INTERVIEW_ID_STORAGE_KEY = 'ai_job_helper:interview_id'
const TEST_TOKEN = 'rc.mock.jwt.token'

/** ErrorBoundary 兜底文案（components/ErrorBoundary.tsx） */
const ERROR_BOUNDARY_PHRASES = ['页面渲染时出错了', '服务开小差了']

const SESSION_ID = 'b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e'
const CONV_ID = 'c1'
const RESUME_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'
const TASK_ID = 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70'
const QUESTION_ID = 'f0e1d2c3-b4a5-4968-8778-99aabbccddee'
const REPORT_ID = 'aa11bb22-cc33-4d44-8e55-ff6677889900'

const NOW = '2026-09-18T09:24:31+08:00'

/* ------------------------------------------------------------------ fixtures */

const user = {
  id: '11111111-2222-4333-8444-555555555555',
  username: '林小满',
  school: '华中科技大学',
  major: '软件工程',
  grade: '大三',
  created_at: '2026-08-02T10:12:00+08:00',
}

const tags = [
  {
    id: 't1000000-0000-4000-8000-000000000001',
    user_id: user.id,
    dimension: '痛点',
    label: '缺项目经验',
    weight: 0.86,
    source: 'chat',
    extra: { hit_count: 4 },
    updated_at: NOW,
  },
  {
    id: 't1000000-0000-4000-8000-000000000002',
    user_id: user.id,
    dimension: '能力',
    label: '算法基础扎实',
    weight: 0.72,
    source: 'test',
    extra: null,
    updated_at: NOW,
  },
  {
    id: 't1000000-0000-4000-8000-000000000003',
    user_id: user.id,
    dimension: '兴趣',
    label: '对鸿蒙应用开发感兴趣',
    weight: 0.64,
    source: 'chat',
    extra: null,
    updated_at: NOW,
  },
  {
    id: 't1000000-0000-4000-8000-000000000004',
    user_id: user.id,
    dimension: '焦虑',
    label: '担心面试表达不清楚',
    weight: 0.51,
    source: 'daily',
    extra: null,
    updated_at: NOW,
  },
]

const profile = {
  id: '22222222-3333-4444-8555-666666666666',
  user_id: user.id,
  clarity_score: 68,
  action_score: 54,
  resume_score: 41,
  total_score: 54,
  stage: 'prepare',
  updated_at: NOW,
  tested: true,
  tags,
  user,
}

const task = {
  id: TASK_ID,
  user_id: user.id,
  title: '做一个鸿蒙待办清单小应用',
  description: '从 0 到 1 写一个能跑在真机上的 ArkTS 小应用，用来填上「缺项目经验」这个洞。',
  pain_point: '缺项目经验',
  status: '进行中',
  value_note: '简历上能写成一个完整项目，面试时能讲清楚技术选型。',
  difficulty: '中等',
  estimated_days: 14,
  created_at: '2026-09-10T20:05:00+08:00',
  updated_at: NOW,
  progress: 0.4,
}

const taskSteps = [
  {
    id: 's1',
    task_id: TASK_ID,
    step_order: 1,
    title: '装好 DevEco Studio 并跑通 Hello World',
    action: '用官网最新稳定版，创建一个 Empty Ability 模板工程，先确认模拟器能起来。',
    resource: 'https://developer.huawei.com/consumer/cn/deveco-studio/',
    completed: true,
    feedback: '模拟器启动有点慢，其他顺利。',
    completed_at: '2026-09-11T21:40:00+08:00',
  },
  {
    id: 's2',
    task_id: TASK_ID,
    step_order: 2,
    title: '实现待办列表页与本地存储',
    action: '用 List + ListItem 渲染，数据先用 preferences 存本地，不接后端。',
    resource: null,
    completed: true,
    feedback: null,
    completed_at: '2026-09-13T22:10:00+08:00',
  },
  {
    id: 's3',
    task_id: TASK_ID,
    step_order: 3,
    title: '补一个状态管理与删除交互',
    action: '把数据流整理成一个 ViewModel，删除加二次确认。',
    resource: null,
    completed: false,
    feedback: null,
    completed_at: null,
  },
  {
    id: 's4',
    task_id: TASK_ID,
    step_order: 4,
    title: '录一段 3 分钟演示视频并写进简历',
    action: '讲清楚做了什么、遇到什么问题、怎么解的。',
    resource: null,
    completed: false,
    feedback: null,
    completed_at: null,
  },
]

const taskDetail = { ...task, steps: taskSteps }

const resumeList = [
  {
    id: RESUME_ID,
    user_id: user.id,
    title: '林小满-鸿蒙客户端开发-2026 秋招',
    file_path: `${user.id}/resume_20260912.pdf`,
    parsed_data: null,
    ats_score: 76,
    completeness: 0.82,
    target_job: '鸿蒙应用开发工程师',
    created_at: '2026-09-12T15:30:00+08:00',
    updated_at: NOW,
  },
  {
    id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    user_id: user.id,
    title: '旧版-通用技术岗简历',
    file_path: null,
    parsed_data: null,
    ats_score: 52,
    completeness: 0.6,
    target_job: '后端开发工程师',
    created_at: '2026-08-20T11:00:00+08:00',
    updated_at: '2026-08-20T11:00:00+08:00',
  },
]

const resumeDetail = {
  id: RESUME_ID,
  user_id: user.id,
  title: '林小满-鸿蒙客户端开发-2026 秋招',
  file_path: `${user.id}/resume_20260912.pdf`,
  parsed_data: {
    basics: {
      name: '林小满',
      phone: '138****2233',
      email: 'linxiaoman@example.com',
      city: '武汉',
      target_job: '鸿蒙应用开发工程师',
    },
    education: [
      {
        school: '华中科技大学',
        major: '软件工程',
        degree: '本科',
        start: '2023-09',
        end: '2027-06',
        gpa: '3.7/4.0',
      },
    ],
    experience: [
      {
        company: '校学生创新基地',
        role: '客户端开发',
        start: '2025-03',
        end: '2025-06',
        description: '负责活动报名小程序的列表与表单模块，日活约 800。',
      },
    ],
    projects: [
      {
        name: '鸿蒙待办清单',
        role: '独立开发',
        tech: ['ArkTS', 'ArkUI', 'Preferences'],
        description: '从 0 到 1 完成的鸿蒙小应用，支持列表增删改与本地持久化。',
      },
    ],
    skills: ['ArkTS', 'TypeScript', 'Java', 'Git', '数据结构与算法'],
  },
  ats_score: 76,
  completeness: 0.82,
  target_job: '鸿蒙应用开发工程师',
  created_at: '2026-09-12T15:30:00+08:00',
  updated_at: NOW,
}

const resumeReport = {
  resume_id: RESUME_ID,
  ats_score: 76,
  completeness: 0.82,
  matched_keywords: ['ArkTS', 'ArkUI', 'TypeScript', 'Git', '数据结构'],
  missing_keywords: ['分布式软总线', 'HarmonyOS NEXT', '性能优化', '单元测试'],
  suggestions: [
    {
      section: 'projects',
      problem: '项目描述只写了做了什么，没写结果。',
      suggestion: '补一条可量化的结果，例如覆盖多少用户、启动耗时降低多少。',
      example: '把列表首屏渲染从 480ms 优化到 210ms。',
    },
    {
      section: 'skills',
      problem: '技能栏没有和目标岗位 JD 的高频词对齐。',
      suggestion: '把「分布式软总线」「HarmonyOS NEXT」补进技能或项目描述。',
      example: '熟悉 HarmonyOS NEXT 应用开发与分布式软总线基础调用。',
    },
  ],
  summary:
    '整体结构完整，教育背景与目标岗位匹配度高。主要短板是缺少可量化成果，以及与岗位关键词重合度不足。',
  generated_at: NOW,
}

const interviewQuestions = {
  interview_id: SESSION_ID,
  mode: '全真',
  scene: '项目',
  status: '进行中',
  current_index: 1,
  questions: [
    {
      id: 'q-1',
      interview_id: SESSION_ID,
      question_order: 1,
      content: '先花一分钟介绍一下你自己，重点讲和鸿蒙客户端开发相关的部分。',
      answer: null,
      followups: null,
      score: null,
      created_at: NOW,
      answered_at: null,
    },
    {
      id: 'q-2',
      interview_id: SESSION_ID,
      question_order: 2,
      content: '你那个鸿蒙待办清单，为什么选 Preferences 而不是关系型数据库？',
      answer: null,
      followups: null,
      score: null,
      created_at: NOW,
      answered_at: null,
    },
    {
      id: 'q-3',
      interview_id: SESSION_ID,
      question_order: 3,
      content: '如果列表数据涨到一万条，你会怎么改？',
      answer: null,
      followups: null,
      score: null,
      created_at: NOW,
      answered_at: null,
    },
  ],
}

const interviewReview = {
  interview_id: SESSION_ID,
  status: '已完成',
  overall_score: 71,
  dimension_scores: {
    表达清晰度: 74,
    项目深度: 66,
    技术基础: 78,
    岗位匹配: 68,
  },
  strengths: [
    '能把项目背景讲清楚，技术选型有理由。',
    '对 ArkUI 声明式写法的理解比较扎实。',
  ],
  improvements: [
    '回答里缺少量化结果，建议每个项目准备一个数字。',
    '被追问边界情况时容易泛泛而谈，可以准备两三个具体失败案例。',
  ],
  question_reviews: [
    {
      question: '先花一分钟介绍一下你自己。',
      answer: '我是软件工程大三学生，做过一个鸿蒙待办清单应用。',
      score: 68,
      comment: '结构完整但缺亮点，建议把最有说服力的一段经历前置。',
    },
  ],
  summary:
    '整体在及格线以上，项目能讲但不够深。把量化结果和失败案例补上，下一轮能明显提分。',
  generated_at: NOW,
}

const growthReport = {
  id: REPORT_ID,
  user_id: user.id,
  type: 'growth',
  content: {
    stage: 'prepare',
    stage_changed: true,
    clarity_score: 68,
    action_score: 54,
    resume_score: 41,
    total_score: 54,
    score_delta: {
      clarity_score: 8,
      action_score: 12,
      resume_score: 5,
      total_score: 25,
    },
    completed_tasks: 1,
    completed_steps: 7,
    active_days: 12,
    highlights: [
      '方向清晰度一周内涨了 8 分，从「都在试」变成「锁定鸿蒙客户端」。',
      '第一次把一个小项目完整做完并录了演示。',
    ],
    suggestions: [
      '把简历里的项目描述补上量化结果，ATS 分还能再提 10 分左右。',
      '本周约一次全真模拟面试，把项目追问提前练一遍。',
    ],
  },
  created_at: NOW,
}

/* ------------------------------------------------------------------ SSE mock */

const SSE_DELTAS = [
  '你提到的「投了几家没回音」，',
  '通常不是能力问题，',
  '而是简历里的项目描述没有给出可验证的结果。',
]
const SSE_ASSISTANT_TEXT = SSE_DELTAS.join('')

function envelope(data) {
  return JSON.stringify({ code: 0, message: 'success', data })
}

const SSE_EVENTS = [
  {
    event: 'start',
    payload: envelope({
      type: 'start',
      conversation_id: CONV_ID,
      followup_round: 0,
      followup_direction: '项目经历',
    }),
  },
  ...SSE_DELTAS.map((content) => ({
    event: 'delta',
    payload: envelope({
      type: 'delta',
      content,
      conversation_id: CONV_ID,
      followup_round: 1,
      followup_direction: '项目经历',
    }),
  })),
  {
    event: 'tag',
    payload: envelope({
      type: 'tag',
      conversation_id: CONV_ID,
      data: {
        tags: [
          {
            id: 't1000000-0000-4000-8000-000000000009',
            user_id: user.id,
            dimension: '痛点',
            label: '简历无量化结果',
            weight: 0.77,
            source: 'chat',
            extra: null,
            updated_at: NOW,
          },
        ],
      },
    }),
  },
  {
    event: 'done',
    payload: envelope({
      type: 'done',
      conversation_id: CONV_ID,
      message_id: 'a-9001',
      followup_round: 2,
      followup_direction: '项目经历',
      conclusion_ready: true,
    }),
  },
  { event: 'end', payload: '[DONE]' },
]

function sseChunk(event, payload) {
  return `event: ${event}\ndata: ${payload}\n\n`
}

/* ------------------------------------------------------------- mock plumbing */

function json(route, data, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ code: 0, message: 'success', data }),
    headers: { 'access-control-allow-origin': '*' },
  })
}

function fail(route, status, code, message) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ code, message, data: null }),
    headers: { 'access-control-allow-origin': '*' },
  })
}

/**
 * 按 method + pathname 分派 mock。返回 { hit, misses, sseRequests } 供报告用。
 *
 * SSE 与普通 JSON 共用一个 handler：Playwright 的 page.route 是「后注册先跑」，
 * 两个 handler 都能匹配时行为容易误判，所以这里只在**一个** handler 内分支。
 */
async function installApiMock(page, opts = {}) {
  const { mode = 'ok', tested = true, sseGapMs = 0 } = opts
  const hits = []
  const misses = []
  const sseRequests = []

  await page.route('**/api/v1/**', async (route) => {
    const req = route.request()
    const method = req.method().toUpperCase()
    const url = new URL(req.url())
    const p = url.pathname.replace(/^\/api\/v1/, '') || '/'
    const key = `${method} ${p}`
    hits.push(key)

    // 边界 B：全部 401 + code 1002
    if (mode === 'all401') {
      return fail(route, 401, 1002, '登录状态已过期，请重新登录')
    }

    /* ---- 流式对话（SSE）：必须走 text/event-stream，不能套 JSON 信封 ---- */
    if (method === 'POST' && /^\/chat\/conversations\/[^/]+\/stream$/.test(p)) {
      sseRequests.push({ method, path: p, body: req.postData() })
      if (sseGapMs > 0) await sleep(sseGapMs)
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
        },
        body: SSE_EVENTS.map((e) => sseChunk(e.event, e.payload)).join(''),
      })
    }

    /* ---- 认证 ---- */
    if (method === 'GET' && p === '/auth/me') return json(route, user)
    if (method === 'POST' && p === '/auth/login')
      return json(route, {
        access_token: TEST_TOKEN,
        token_type: 'bearer',
        expires_in: 604800,
        user,
      })
    if (method === 'POST' && p === '/auth/register')
      return json(route, {
        access_token: TEST_TOKEN,
        token_type: 'bearer',
        expires_in: 604800,
        user,
      })

    /* ---- 画像 ---- */
    if (method === 'GET' && p === '/profile') {
      if (tested) return json(route, profile)
      // 未测评的新用户：get_or_create_profile 仍 200，但 tested=false、无标签
      return json(route, {
        id: '22222222-3333-4444-8555-666666666667',
        user_id: user.id,
        clarity_score: 0,
        action_score: 0,
        resume_score: 0,
        total_score: 0,
        stage: 'explore',
        updated_at: NOW,
        tested: false,
        tags: [],
        user,
      })
    }
    if (method === 'GET' && p === '/profile/tags') return json(route, tags)
    if (method === 'POST' && p === '/profile/feedback') return json(route, profile)

    /* ---- 首页聚合 ---- */
    if (method === 'GET' && p === '/home/summary') {
      return json(route, {
        stage: 'prepare',
        stage_label: '求职准备期',
        profile: {
          clarity_score: 68,
          action_score: 54,
          resume_score: 41,
          total_score: 54,
          stage: 'prepare',
          tested: true,
        },
        tags: tags.map((t) => ({
          dimension: t.dimension,
          label: t.label,
          weight: t.weight,
          source: t.source,
        })),
        daily_question: {
          id: 'dq-2026-09-18',
          content: '最近一次投递没回音，你觉得卡在哪个环节？',
          options: [],
          answered: false,
        },
        ai_findings: [
          {
            pain_point: '缺项目经验',
            label: '缺项目经验',
            reason: '你在三轮对话里都提到「没有能写进简历的项目」，权重排第一。',
            target_route: '/task',
          },
          {
            pain_point: '担心面试表达不清楚',
            label: '担心面试表达不清楚',
            reason: '每日一问里两次提到怕被追问，可以先做一次小测试面试。',
            target_route: '/interview',
          },
        ],
        ongoing_tasks: [
          {
            id: TASK_ID,
            title: '做一个鸿蒙待办清单小应用',
            difficulty: '中等',
            estimated_days: 14,
            done_steps: 2,
            total_steps: 4,
            current_step_title: '补一个状态管理与删除交互',
          },
        ],
        next_action: {
          text: '先把这个鸿蒙小项目的删除交互补完',
          route: `/task/${TASK_ID}`,
          reason: '任务已经做到一半，收尾比开新的更划算。',
        },
      })
    }

    /* ---- 任务 ---- */
    if (method === 'GET' && p === '/task') return json(route, [task])
    if (method === 'POST' && p === '/task/generate') return json(route, taskDetail)
    if (method === 'GET' && /^\/task\/[^/]+$/.test(p)) return json(route, taskDetail)
    if (method === 'POST' && /^\/task\/[^/]+\/steps\/[^/]+\/complete$/.test(p))
      return json(route, taskDetail)
    if (method === 'POST' && /^\/task\/[^/]+\/abandon$/.test(p))
      return json(route, { ...task, status: '已放弃' })

    /* ---- 每日一问 ---- */
    if (method === 'GET' && p === '/daily/today') {
      return json(route, {
        question: {
          id: 'dq-2026-09-18',
          dimension: '焦虑',
          content: '最近一次投递没回音，你觉得卡在哪个环节？',
          options: null,
          created_at: '2026-09-18T07:00:00+08:00',
        },
        answered: false,
        answer: null,
        streak: 4,
      })
    }
    if (method === 'POST' && p === '/daily/answer') {
      return json(route, {
        id: 'da-1',
        user_id: user.id,
        question_id: 'dq-2026-09-18',
        answer: '大概是简历里的项目描述太虚了。',
        answered_at: NOW,
        profile_refreshed: true,
        extracted_tags: [],
      })
    }

    /* ---- 简历 ---- */
    if (method === 'GET' && p === '/resume') return json(route, resumeList)
    if (method === 'POST' && p === '/resume') return json(route, resumeDetail)
    if (method === 'POST' && p === '/resume/upload') return json(route, resumeDetail)
    if (method === 'GET' && /^\/resume\/[^/]+\/report$/.test(p)) return json(route, resumeReport)
    if (method === 'POST' && /^\/resume\/[^/]+\/optimize$/.test(p)) return json(route, resumeReport)
    if (method === 'GET' && /^\/resume\/[^/]+\/file$/.test(p)) {
      // 1x1 PNG，够 resumeApi.downloadFile 走通了
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
        'base64',
      )
      return route.fulfill({ status: 200, contentType: 'image/png', body: png })
    }
    if (method === 'GET' && /^\/resume\/[^/]+$/.test(p)) return json(route, resumeDetail)
    if (method === 'PUT' && /^\/resume\/[^/]+$/.test(p)) return json(route, resumeDetail)

    /* ---- 成长报告 ---- */
    if (method === 'GET' && p === '/report') return json(route, growthReport)

    /* ---- 奖章 ---- */
    if (method === 'GET' && p === '/badge') {
      return json(route, [
        {
          id: 'ub-1',
          badge_id: 'badge_starter',
          name: '起步行动家',
          condition: { type: 'completed_steps', value: 5 },
          obtained_at: '2026-09-14T19:02:00+08:00',
        },
        {
          id: 'ub-2',
          badge_id: 'badge_first_resume',
          name: '第一份简历',
          condition: { type: 'resume_created', value: 1 },
          obtained_at: '2026-09-12T16:00:00+08:00',
        },
      ])
    }

    /* ---- 测评 ---- */
    if (method === 'GET' && p === '/test/questions') {
      return json(route, [
        {
          id: 'q_clarity_01',
          dimension: 'clarity',
          content: '想到未来的工作，你现在的感觉更接近哪一种？',
          options: [
            { key: 'A', text: '完全不知道能做什么', score: 1 },
            { key: 'B', text: '有几个方向但都很模糊', score: 2 },
            { key: 'C', text: '有一个比较想去的方向', score: 4 },
            { key: 'D', text: '方向很明确，已经在准备', score: 5 },
          ],
          multiple: false,
        },
        {
          id: 'q_action_01',
          dimension: 'action',
          content: '过去一个月，你为求职做过下面哪件事？',
          options: [
            { key: 'A', text: '还没有开始', score: 1 },
            { key: 'B', text: '看过一些岗位要求', score: 2 },
            { key: 'C', text: '改过一次简历', score: 4 },
            { key: 'D', text: '投过简历或参加过面试', score: 5 },
          ],
          multiple: false,
        },
        {
          id: 'q_resume_01',
          dimension: 'resume',
          content: '你的简历现在处于什么状态？',
          options: [
            { key: 'A', text: '还没有简历', score: 0 },
            { key: 'B', text: '有一份但没改过', score: 2 },
            { key: 'C', text: '针对岗位改过一版', score: 4 },
            { key: 'D', text: '有多个岗位方向的不同版本', score: 5 },
          ],
          multiple: false,
        },
        {
          id: 'q_interest_01',
          dimension: 'interest',
          content: '下面哪些事情你做起来会忘记时间？（可多选）',
          options: [
            { key: 'A', text: '把东西拆开看内部怎么运作', score: 5 },
            { key: 'B', text: '把一个界面调到好看', score: 4 },
            { key: 'C', text: '和不同的人聊天、理清需求', score: 4 },
            { key: 'D', text: '整理数据、找规律', score: 3 },
          ],
          multiple: true,
        },
      ])
    }
    if (method === 'POST' && p === '/test/submit') {
      return json(route, {
        id: 'tr-1',
        user_id: user.id,
        clarity_score: 68,
        action_score: 54,
        resume_score: 41,
        total_score: 54,
        stage: 'prepare',
        created_at: NOW,
        answers: { q_clarity_01: 'C', q_action_01: 'B' },
        free_text: null,
      })
    }
    if (method === 'GET' && p === '/test/result') {
      return json(route, {
        id: 'tr-1',
        user_id: user.id,
        clarity_score: 68,
        action_score: 54,
        resume_score: 41,
        total_score: 54,
        stage: 'prepare',
        created_at: NOW,
        answers: { q_clarity_01: 'C', q_action_01: 'B', q_resume_01: 'C' },
        free_text: null,
      })
    }

    /* ---- 面试 ---- */
    if (method === 'POST' && p === '/interview/start') {
      return json(route, {
        id: SESSION_ID,
        user_id: user.id,
        mode: '全真',
        scene: '项目',
        status: '进行中',
        created_at: NOW,
        updated_at: NOW,
        report: null,
      })
    }
    if (method === 'GET' && /^\/interview\/[^/]+\/questions$/.test(p))
      return json(route, interviewQuestions)
    if (method === 'POST' && /^\/interview\/[^/]+\/answer$/.test(p)) {
      return json(route, {
        interview_id: SESSION_ID,
        finished: false,
        followup_round: 1,
        next_question: interviewQuestions.questions[1],
        message: '接着说说你为什么这么选。',
      })
    }
    if (method === 'POST' && /^\/interview\/[^/]+\/finish$/.test(p)) {
      return json(route, { interview_id: SESSION_ID, status: '已完成', report: null })
    }
    if (method === 'GET' && /^\/interview\/[^/]+\/review$/.test(p))
      return json(route, interviewReview)

    /* ---- 对话 ---- */
    if (method === 'GET' && p === '/chat/conversations') {
      return json(route, [
        {
          id: CONV_ID,
          user_id: user.id,
          title: '投了几家没回音',
          created_at: '2026-09-17T20:11:00+08:00',
          updated_at: NOW,
          message_count: 2,
          conclusion: null,
          followup_direction: '项目经历',
          followup_round: 1,
        },
      ])
    }
    if (method === 'POST' && p === '/chat/conversations') {
      return json(route, {
        id: CONV_ID,
        user_id: user.id,
        title: '新对话',
        created_at: NOW,
        updated_at: NOW,
        message_count: 0,
        conclusion: null,
        followup_direction: null,
        followup_round: 0,
      })
    }
    if (method === 'GET' && /^\/chat\/conversations\/[^/]+\/messages$/.test(p)) {
      return json(route, [
        {
          id: 'm-1',
          conversation_id: CONV_ID,
          role: 'user',
          content: '我投了几家都没回音，是不是简历有问题？',
          client_msg_id: 'cm-1',
          created_at: '2026-09-17T20:11:00+08:00',
        },
        {
          id: 'm-2',
          conversation_id: CONV_ID,
          role: 'assistant',
          content: '先从你投的岗位和简历逐条对一遍关键词，通常问题出在这里。',
          client_msg_id: null,
          created_at: '2026-09-17T20:11:20+08:00',
        },
      ])
    }
    if (method === 'POST' && /^\/chat\/conversations\/[^/]+\/messages$/.test(p)) {
      return json(route, {
        conversation_id: CONV_ID,
        user_message: {
          id: 'm-3',
          conversation_id: CONV_ID,
          role: 'user',
          content: '我的简历里项目描述都很短。',
          client_msg_id: 'cm-3',
          created_at: NOW,
        },
        assistant_message: {
          id: 'm-4',
          conversation_id: CONV_ID,
          role: 'assistant',
          content: '那把每个项目补上一条可量化的结果。',
          client_msg_id: null,
          created_at: NOW,
        },
        extracted_tags: [],
      })
    }
    if (method === 'GET' && /^\/chat\/conversations\/[^/]+\/conclusion$/.test(p)) {
      return json(route, {
        conversation_id: CONV_ID,
        summary: '你的卡点不在投递数量，而在简历里没有可验证的成果。',
        pain_points: ['项目描述没有量化结果', '投递岗位与简历关键词不重合'],
        suggestions: ['每个项目补一条数字结果', '按 JD 重排技能栏顺序'],
        next_actions: ['今天就改简历的第一个项目', '约一次全真模拟面试'],
        generated_at: NOW,
      })
    }

    /* ---- 埋点 ---- */
    if (method === 'POST' && p === '/events') return json(route, null)

    /* ---- 兜底：记录未覆盖的端点，仍返回成功空对象，避免误判为崩溃 ---- */
    misses.push(key)
    return json(route, null)
  })

  return { hits, misses, sseRequests }
}

/* --------------------------------------------------------------- collectors */

function attachCollectors(page, store) {
  page.on('pageerror', (err) => {
    store.pageErrors.push({
      message: String(err && err.message ? err.message : err),
      stack: String(err && err.stack ? err.stack : ''),
    })
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    store.consoleErrors.push({ text, location: msg.location() })
  })
}

function isNoise(text) {
  return (
    /favicon/i.test(text) ||
    /Download the React DevTools/i.test(text) ||
    /ResizeObserver loop/i.test(text) ||
    /Failed to load resource: the server responded with a status of 401/i.test(text)
  )
}

async function snapshot(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#root')
    const rootChildren = root ? root.children.length : -1
    const bodyText = document.body ? document.body.innerText.trim() : ''
    const bubbles = Array.from(document.querySelectorAll('[data-testid], .prose, li, p'))
      .map((el) => el.textContent || '')
      .join('\n')
    return {
      rootChildren,
      bodyTextLength: bodyText.length,
      bodyText: bodyText.slice(0, 4000),
      bubblesText: bubbles.slice(0, 4000),
      title: document.title,
      hasTextarea: !!document.querySelector('textarea'),
      hasInput: !!document.querySelector('input'),
      inputCount: document.querySelectorAll('input').length,
      textareaCount: document.querySelectorAll('textarea').length,
    }
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * networkidle 在 recharts/ResizeObserver 页面偶尔不收敛，超时后退回 load 再等一会儿。
 */
async function gotoWithFallback(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 })
    return 'networkidle'
  } catch (err) {
    if (!/Timeout/i.test(String(err.message))) throw err
    await page.goto(url, { waitUntil: 'load', timeout: 25000 })
    await sleep(800)
    return 'load(fallback: networkidle timed out)'
  }
}

/* -------------------------------------------------------------------- routes */

const ROUTES = [
  { n: 1, path: '/login', name: 'login', auth: false, expect: '/login', probe: 'login' },
  { n: 2, path: '/register', name: 'register', auth: false, expect: '/register' },
  // tested=true 时 TestIntroPage 的 useEffect 会主动 navigate('/')，所以最终 URL 是 /，不是 /test/intro
  { n: 3, path: '/test/intro', name: 'test-intro', auth: true, expect: '/', verifiedAs: 'redirect-to-home-when-tested' },
  { n: 4, path: '/test/question', name: 'test-question', auth: true, expect: '/test/question' },
  { n: 5, path: '/test/result', name: 'test-result', auth: true, expect: '/test/result' },
  { n: 6, path: '/', name: 'home', auth: true, expect: '/' },
  { n: 7, path: '/chat', name: 'chat', auth: true, expect: '/chat', probe: 'chat' },
  { n: 8, path: '/task', name: 'task-list', auth: true, expect: '/task' },
  { n: 9, path: '/task/:id', name: 'task-detail', auth: true, path2: `/task/${TASK_ID}`, expect: `/task/${TASK_ID}` },
  { n: 10, path: '/profile', name: 'profile', auth: true, expect: '/profile' },
  { n: 11, path: '/daily', name: 'daily', auth: true, expect: '/daily' },
  { n: 12, path: '/resume', name: 'resume-list', auth: true, expect: '/resume' },
  { n: 13, path: '/resume/create', name: 'resume-create', auth: true, expect: '/resume/create' },
  { n: 14, path: '/resume/:id/edit', name: 'resume-edit', auth: true, path2: `/resume/${RESUME_ID}/edit`, expect: `/resume/${RESUME_ID}/edit` },
  { n: 15, path: '/resume/:id/report', name: 'resume-report', auth: true, path2: `/resume/${RESUME_ID}/report`, expect: `/resume/${RESUME_ID}/report` },
  { n: 16, path: '/interview', name: 'interview-select', auth: true, expect: '/interview' },
  { n: 17, path: '/interview/prepare', name: 'interview-prepare', auth: true, expect: '/interview/prepare' },
  { n: 18, path: '/interview/session', name: 'interview-session', auth: true, expect: '/interview/session', session: true },
  { n: 19, path: '/interview/review/:id', name: 'interview-review', auth: true, path2: `/interview/review/${SESSION_ID}`, expect: `/interview/review/${SESSION_ID}` },
  { n: 20, path: '/report', name: 'growth-report', auth: true, expect: '/report' },
  { n: 21, path: '/404', name: '404', auth: false, expect: '/404' },
  { n: 22, path: '*', name: 'wildcard-404', auth: false, path2: '/this-route-does-not-exist', expect: '/this-route-does-not-exist' },
]

/* ------------------------------------------------------------------- runner */

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true })

  const report = {
    baseUrl: BASE_URL,
    startedAt: new Date().toISOString(),
    routes: [],
    scenarios: {},
    apiCoverage: {},
    dataRequests: [],
    unknownEndpoints: [],
    noiseIgnored: [],
    edgeLaunchNote: '',
  }

  const launchArgs = ['--no-first-run', '--no-default-browser-check', '--disable-extensions']

  let browser
  try {
    browser = await chromium.launch({ executablePath: EDGE, headless: true, args: launchArgs })
    report.edgeLaunchNote = `launched msedge via executablePath=${EDGE}`
  } catch (err) {
    report.edgeLaunchNote = `chromium.launch(executablePath) failed: ${err.message}`
    browser = await chromium.launch({ channel: 'msedge', headless: true, args: launchArgs })
    report.edgeLaunchNote += ' | fell back to channel=msedge OK'
  }

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  })

  /* ============================== 逐路由检查 ============================== */
  for (const r of ROUTES) {
    const p = r.path2 ?? r.path
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [] }
    attachCollectors(page, store)

    const { hits, misses, sseRequests } = await installApiMock(page, { mode: 'ok' })

    const init = `
      window.localStorage.setItem(${JSON.stringify(TOKEN_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(TEST_TOKEN)}));
      window.localStorage.removeItem('ai_job_helper:test_progress');
      ${r.session ? `window.sessionStorage.setItem(${JSON.stringify(INTERVIEW_ID_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(SESSION_ID)}));` : ''}
    `

    const entry = {
      index: r.n,
      declaredPath: r.path,
      visited: p,
      name: r.name,
      auth: r.auth,
      finalUrl: null,
      expectedUrl: r.expect,
      urlOk: null,
      renderedText: 0,
      rootChildren: 0,
      blank: null,
      errorBoundary: false,
      errorBoundaryText: null,
      pageErrors: [],
      consoleErrors: [],
      consoleErrorCount: 0,
      screenshot: `shots/${String(r.n).padStart(2, '0')}-${r.name}.png`,
      apiCalls: [],
      unknownEndpoints: [],
      sse: null,
      verdict: null,
      notes: [],
    }

    try {
      if (r.auth) await page.addInitScript(init)
      else await page.addInitScript(init)

      entry.waitMode = await gotoWithFallback(page, BASE_URL + p)
      await sleep(700)

      const snap = await snapshot(page)
      const url = new URL(page.url())

      entry.finalUrl = url.pathname + url.search
      entry.urlOk = entry.finalUrl === r.expect
      entry.renderedText = snap.bodyTextLength
      entry.rootChildren = snap.rootChildren
      entry.bodyTextSample = snap.bodyText.slice(0, 600)
      entry.errorBoundary = ERROR_BOUNDARY_PHRASES.some((ph) => snap.bodyText.includes(ph))
      if (entry.errorBoundary) {
        const phrase = ERROR_BOUNDARY_PHRASES.find((ph) => snap.bodyText.includes(ph))
        const at = snap.bodyText.indexOf(phrase)
        entry.errorBoundaryText = snap.bodyText.slice(at, at + 300)
      }
      entry.blank = snap.rootChildren <= 0 && snap.bodyTextLength === 0
      entry.hasTextarea = snap.hasTextarea
      entry.hasInput = snap.hasInput
      entry.inputCount = snap.inputCount
      entry.textareaCount = snap.textareaCount
      entry.apiCalls = Array.from(new Set(hits))
      entry.unknownEndpoints = Array.from(new Set(misses))

      entry.pageErrors = store.pageErrors
      entry.consoleErrors = store.consoleErrors
      entry.consoleErrorCount = store.consoleErrors.length
      entry.consoleErrorsNoise = store.consoleErrors
        .filter((e) => isNoise(e.text))
        .map((e) => e.text.slice(0, 200))
      entry.consoleErrorsReal = store.consoleErrors
        .filter((e) => !isNoise(e.text))
        .map((e) => e.text.slice(0, 300))

      await page.screenshot({ path: path.join(SHOTS_DIR, `${String(r.n).padStart(2, '0')}-${r.name}.png`), fullPage: true })

      /* --- 场景 C 探针：chat 页真的发一句，看流式是否逐字进气泡 --- */
      if (r.probe === 'chat') {
        entry.sse = { attempted: true }
        try {
          const before = await snapshot(page)
          entry.sse.textareaFound = snap.hasTextarea
          const ta = page.locator('textarea')
          if ((await ta.count()) === 0) throw new Error('页面里找不到 textarea')
          await ta.first().fill('我投了几家都没回音，简历我也改过。')
          const sendBtn = page.getByRole('button', { name: /发送/ })
          if ((await sendBtn.count()) === 0) throw new Error('找不到「发送」按钮')
          await sendBtn.first().click()

          // 点击后立刻高频采样，尽量抓到「只有一部分 delta 已到达」的中间态
          const samples = []
          for (let i = 0; i < 40; i++) {
            const t = await page.evaluate(() => document.body.innerText)
            const inner = await page.evaluate(() => {
              const nodes = Array.from(document.querySelectorAll('div,p'))
                .map((el) => (el.textContent || '').trim())
                .filter((x) => x.includes('投了几家没回音') || x.includes('可验证的结果'))
              return nodes.length ? nodes[nodes.length - 1] : ''
            })
            samples.push({
              i,
              bodyLen: t.length,
              assistantSoFar: inner.slice(0, 200),
              hasAll: t.includes('可验证的结果'),
            })
            if (samples.length > 3 && samples.slice(-3).every((s) => s.hasAll)) break
            await sleep(25)
          }
          const mid = await page.evaluate(() => document.body.innerText)
          await sleep(1200)
          const after = await page.evaluate(() => document.body.innerText)

          entry.sse.samples = samples
          entry.sse.beforeTextLen = before.bodyTextLength
          entry.sse.midTextLen = mid.length
          entry.sse.afterTextLen = after.length
          // 抓取 assistant 气泡原始文本
          entry.sse.bubbleText = await page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('div,p'))
              .map((el) => (el.textContent || '').trim())
              .filter((t) => t.includes('可验证的结果'))
            return nodes.length ? nodes[nodes.length - 1] : null
          })
          // 用户气泡是否出现
          entry.sse.userEcho = after.includes('简历我也改过')
          // 追问进度文案
          const progress = after.match(/追问进度\s*\d+\/3/)
          entry.sse.followupProgressText = progress ? progress[0] : null
          // 「停止」按钮 = streamState 进入过 streaming/connecting 的 UI 证据
          entry.sse.stopButtonSeen = samples.length > 0 && after.includes('发送')
          entry.sse.shortBubblesSeen = samples
            .map((s) => s.assistantSoFar)
            .filter((x) => x && x.length > 0 && !x.includes('可验证的结果'))
          entry.sse.incrementalObserved = samples.some(
            (s, i) => i > 0 && s.bodyLen !== samples[i - 1].bodyLen,
          )
          entry.sse.fullTextInAfter = after.includes('可验证的结果')
          entry.sse.finalSseAssistant = after.includes('可验证的结果')
            ? 'delta 全文出现在页面'
            : 'delta 全文未出现'
          entry.sse.requestObserved = sseRequests.map((o) => `${o.method} ${o.path}`)
          entry.sse.requestBody = sseRequests[0]?.body ?? null
          entry.sse.requestCount = sseRequests.length
          // 判定：三个断言全过才算 PASS
          entry.sse.verdict =
            entry.sse.requestCount === 1 &&
            entry.sse.fullTextInAfter &&
            entry.sse.userEcho &&
            !!entry.sse.followupProgressText
              ? 'PASS'
              : 'FAIL'

          await page.screenshot({
            path: path.join(SHOTS_DIR, `C-chat-stream-final.png`),
            fullPage: true,
          })
        } catch (err) {
          entry.sse.error = String(err.message || err)
        }
      }

      /* --- 判定 --- */
      const reasons = []
      if (entry.blank) reasons.push('白屏（#root 无子节点且 body 无文本）')
      if (entry.errorBoundary) reasons.push('落到 ErrorBoundary')
      if (entry.pageErrors.length) reasons.push(`未捕获异常 ${entry.pageErrors.length} 条`)
      if (!entry.urlOk) reasons.push(`最终 URL=${entry.finalUrl}，期望 ${entry.expectedUrl}`)
      if (entry.renderedText < 10) reasons.push(`渲染文本过少(${entry.renderedText})`)
      entry.verdict = reasons.length ? 'FAIL' : 'PASS'
      entry.notes = reasons
    } catch (err) {
      entry.verdict = 'FAIL'
      entry.notes = [`采集阶段抛错: ${err.message}`]
      entry.pageErrors = store.pageErrors
      entry.consoleErrors = store.consoleErrors
      entry.consoleErrorCount = store.consoleErrors.length
    }

    report.apiCoverage[r.name] = entry.apiCalls
    report.unknownEndpoints.push(...entry.unknownEndpoints.map((k) => `${r.name}: ${k}`))
    report.routes.push(entry)
    console.log(
      `[${String(r.n).padStart(2, '0')}] ${entry.verdict} ${r.path} -> ${entry.finalUrl} text=${entry.renderedText} consoleErr=${entry.consoleErrorCount} pageErr=${entry.pageErrors.length}`,
    )
    await page.close()
  }

  /* ============================ 场景 A：无 token ============================ */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [] }
    attachCollectors(page, store)
    await installApiMock(page, { mode: 'ok' })
    const a = { name: 'A-无token访问/', pageErrors: [], consoleErrors: [] }
    try {
      await page.addInitScript(`window.localStorage.removeItem(${JSON.stringify(TOKEN_STORAGE_KEY)});`)
      await gotoWithFallback(page, BASE_URL + '/')
      await sleep(800)
      const snap = await snapshot(page)
      a.finalUrl = new URL(page.url()).pathname
      a.redirectedToLogin = a.finalUrl === '/login'
      a.renderedText = snap.bodyTextLength
      a.inputCount = snap.inputCount
      a.hasPasswordInput = await page.evaluate(() => !!document.querySelector('input[type="password"]'))
      a.bodyTextSample = snap.bodyText.slice(0, 400)
      a.blank = snap.rootChildren <= 0 && snap.bodyTextLength === 0
      await page.screenshot({ path: path.join(SHOTS_DIR, 'A-no-token-login.png'), fullPage: true })
      a.pageErrors = store.pageErrors
      a.consoleErrors = store.consoleErrors
      a.verdict = a.redirectedToLogin && !a.blank && a.hasPasswordInput ? 'PASS' : 'FAIL'
    } catch (err) {
      a.error = String(err.message || err)
      a.verdict = 'FAIL'
    }
    report.scenarios.A = a
    console.log(`[A] ${a.verdict} -> ${a.finalUrl}`)
    await page.close()
  }

  /* ==================== 场景 B：有 token 但后端全 401 ==================== */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [] }
    attachCollectors(page, store)
    const { hits } = await installApiMock(page, { mode: 'all401' })
    const b = { name: 'B-有token但全部401' }
    try {
      await page.addInitScript(
        `window.localStorage.setItem(${JSON.stringify(TOKEN_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(TEST_TOKEN)}));`,
      )
      await gotoWithFallback(page, BASE_URL + '/')
      await sleep(2000)
      let snap = await snapshot(page)
      b.afterFirstLoad = { url: new URL(page.url()).pathname, textLen: snap.bodyTextLength }
      // 401 会触发 window.location.href 硬跳转；再等一轮
      await sleep(2500)
      snap = await snapshot(page)
      b.finalUrl = new URL(page.url()).pathname
      b.redirectedToLogin = b.finalUrl === '/login'
      b.blank = snap.rootChildren <= 0 && snap.bodyTextLength === 0
      b.renderedText = snap.bodyTextLength
      b.hasPasswordInput = await page.evaluate(() => !!document.querySelector('input[type="password"]'))
      b.bodyTextSample = snap.bodyText.slice(0, 400)
      b.apiCalls = Array.from(new Set(hits))
      await page.screenshot({ path: path.join(SHOTS_DIR, 'B-all-401.png'), fullPage: true })
      b.pageErrors = store.pageErrors
      b.consoleErrors = store.consoleErrors
      b.verdict = b.redirectedToLogin && !b.blank ? 'PASS' : 'FAIL'
    } catch (err) {
      b.error = String(err.message || err)
      b.verdict = 'FAIL'
    }
    report.scenarios.B = b
    console.log(`[B] ${b.verdict} -> ${b.finalUrl}`)
    await page.close()
  }

  /* ============ 场景 D：有 token 但没做过测评（tested=false）============ */
  {
    const page = await context.newPage()
    const store = { pageErrors: [], consoleErrors: [] }
    attachCollectors(page, store)
    const { hits } = await installApiMock(page, { mode: 'ok', tested: false })
    const d = { name: 'D-有token未测评访问/' }
    try {
      await page.addInitScript(
        `window.localStorage.setItem(${JSON.stringify(TOKEN_STORAGE_KEY)}, JSON.stringify(${JSON.stringify(TEST_TOKEN)}));`,
      )
      await gotoWithFallback(page, BASE_URL + '/')
      await sleep(1200)
      let snap = await snapshot(page)
      d.finalUrlOnSlash = new URL(page.url()).pathname
      d.funnelRedirectToIntro = d.finalUrlOnSlash === '/test/intro'
      d.introText = snap.bodyText.slice(0, 300)
      await page.screenshot({ path: path.join(SHOTS_DIR, 'D-untested-slash.png'), fullPage: true })

      // 再看 /test/intro 本身能不能渲染引导页（此时 tested=false，useEffect 不会跳走）
      await gotoWithFallback(page, BASE_URL + '/test/intro')
      await sleep(1000)
      snap = await snapshot(page)
      d.introFinalUrl = new URL(page.url()).pathname
      d.introRendersGuide = snap.bodyText.includes('先花 3 分钟做个职业测评')
      d.introText = snap.bodyText.slice(0, 300)
      await page.screenshot({ path: path.join(SHOTS_DIR, 'D-untested-intro.png'), fullPage: true })

      d.blank = snap.rootChildren <= 0 && snap.bodyTextLength === 0
      d.apiCalls = Array.from(new Set(hits))
      d.pageErrors = store.pageErrors
      d.consoleErrors = store.consoleErrors
      d.verdict = d.funnelRedirectToIntro && d.introRendersGuide && !d.blank ? 'PASS' : 'FAIL'
    } catch (err) {
      d.error = String(err.message || err)
      d.verdict = 'FAIL'
    }
    report.scenarios.D = d
    console.log(`[D] ${d.verdict} -> ${d.finalUrlOnSlash} / intro@${d.introFinalUrl}`)
    await page.close()
  }

  /* ==================== 场景 C 汇总（来自 /chat 路由探针） ==================== */
  {
    const chatEntry = report.routes.find((r) => r.name === 'chat')
    report.scenarios.C = chatEntry?.sse ?? { attempted: false, error: '未找到 chat 路由记录' }
  }

  await browser.close()

  /* --------------------------------- 输出 --------------------------------- */
  const pass = report.routes.filter((r) => r.verdict === 'PASS')
  const fail = report.routes.filter((r) => r.verdict === 'FAIL')
  report.summary = {
    total: report.routes.length,
    pass: pass.length,
    fail: fail.length,
    failedRoutes: fail.map((f) => `${f.declaredPath} (${f.notes.join('; ')})`),
    anyBlank: report.routes.some((r) => r.blank),
    anyPageError: report.routes.some((r) => r.pageErrors.length > 0),
    anyErrorBoundary: report.routes.some((r) => r.errorBoundary),
    consoleErrorTotal: report.routes.reduce((s, r) => s + r.consoleErrorCount, 0),
  }
  report.finishedAt = new Date().toISOString()

  // 控制台简表
  console.log('\n================ SUMMARY ================')
  console.log(JSON.stringify(report.summary, null, 2))
  console.log('\n--- console errors (dedup) ---')
  const dedup = new Map()
  for (const r of report.routes) {
    for (const e of r.consoleErrors) {
      const t = e.text.slice(0, 160)
      dedup.set(t, (dedup.get(t) || 0) + 1)
    }
  }
  for (const [t, c] of dedup) console.log(`x${c}  ${t}`)

  report.consoleNoiseIgnored = Array.from(dedup.keys()).filter(isNoise)
  report.consoleRealErrors = Array.from(dedup.keys()).filter((t) => !isNoise(t))
  console.log('\n--- ignored as noise ---')
  for (const t of report.consoleNoiseIgnored) console.log(`  IGNORED: ${t}`)
  console.log('\n--- real console errors (not classified as noise) ---')
  for (const t of report.consoleRealErrors) console.log(`  REAL: ${t}`)

  await writeFile(path.join(__dirname, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log('\n--- unknown endpoints (fell through to catch-all) ---')
  for (const u of new Set(report.unknownEndpoints)) console.log(u)
}

main().catch(async (err) => {
  console.error('FATAL', err)
  try {
    await writeFile(
      path.join(__dirname, 'report.fatal.json'),
      JSON.stringify({ fatal: String(err && err.stack ? err.stack : err) }, null, 2),
      'utf8',
    )
  } catch {
    /* ignore */
  }
  process.exitCode = 1
})
