/* 自动从 regression.mjs 抄出的 API mock（原文件第 24-409 行）—— 只读审计用，勿手改：
   契约若变，请同步 regression.mjs 后重新生成本文件。 */

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
  { id: 't3', user_id: user.id, dimension: '兴趣', label: '对前端开发感兴趣', weight: 0.64, source: 'chat', extra: null, updated_at: NOW },
]

/**
 * 「我的画像」卡片的 fixture（勘误 9.24）。
 *
 * 刻意比上面那份 `tags` 更全，并且**故意留着痛点/焦虑/认知三类**：
 * 它们正好用来证明"展示层过滤"真的生效（卡片里不该出现它们）。
 * `extra.seen_days` 是"反复出现过"的排序信号（跨天去重，见 profile_service._merge_extra）——
 * 没有它，页面会退化成按权重排，看到的就是一个不真实的顺序。
 *
 * ⚠️ 单独一份、不改上面共用的 `tags`：那份同时喂首页雷达与信号条，
 * 动它会把首页的 QA 截图一起改掉。
 */
const profileTags = [
  { id: 'pt1', user_id: user.id, dimension: '兴趣', label: '技术/产品', weight: 0.78, source: 'chat', extra: { seen_days: ['2026-09-02', '2026-09-11', '2026-09-18', '2026-09-25'] }, updated_at: NOW },
  { id: 'pt2', user_id: user.id, dimension: '技能', label: 'Java', weight: 0.81, source: 'chat', extra: { seen_days: ['2026-09-03', '2026-09-12', '2026-09-24'] }, updated_at: NOW },
  { id: 'pt3', user_id: user.id, dimension: '能力', label: '表达', weight: 0.7, source: 'task', extra: { seen_days: ['2026-09-08', '2026-09-20'] }, updated_at: NOW },
  { id: 'pt4', user_id: user.id, dimension: '兴趣', label: '健身', weight: 0.9, source: 'chat', extra: { seen_days: ['2026-09-05', '2026-09-15'] }, updated_at: NOW },
  { id: 'pt5', user_id: user.id, dimension: '技能', label: 'Python', weight: 0.66, source: 'chat', extra: { seen_days: ['2026-09-14'] }, updated_at: NOW },
  { id: 'pt6', user_id: user.id, dimension: '技能', label: 'Vue', weight: 0.6, source: 'task', extra: { seen_days: ['2026-09-22'] }, updated_at: NOW },
  { id: 'pt7', user_id: user.id, dimension: '能力', label: '复盘', weight: 0.58, source: 'daily', extra: { seen_days: ['2026-09-19'] }, updated_at: NOW },
  { id: 'pt8', user_id: user.id, dimension: '能力', label: '沟通组织', weight: 0.52, source: 'test', extra: { seen_days: ['2026-09-10'] }, updated_at: NOW },
  { id: 'pt13', user_id: user.id, dimension: '兴趣', label: '看短句', weight: 0.48, source: 'chat', extra: { seen_days: ['2026-09-04', '2026-09-13'] }, updated_at: NOW },
  { id: 'pt14', user_id: user.id, dimension: '兴趣', label: '产品', weight: 0.5, source: 'test', extra: { seen_days: ['2026-09-07'] }, updated_at: NOW },
  { id: 'pt15', user_id: user.id, dimension: '技能', label: '写作', weight: 0.54, source: 'chat', extra: { seen_days: ['2026-09-09', '2026-09-21'] }, updated_at: NOW },
  { id: 'pt16', user_id: user.id, dimension: '能力', label: '行动力', weight: 0.64, source: 'task', extra: { seen_days: ['2026-09-06', '2026-09-16'] }, updated_at: NOW },
  { id: 'pt17', user_id: user.id, dimension: '技能', label: 'C++', weight: 0.56, source: 'chat', extra: { seen_days: ['2026-09-02', '2026-09-12'] }, updated_at: NOW },
  { id: 'pt18', user_id: user.id, dimension: '能力', label: '持续反思', weight: 0.46, source: 'daily', extra: { seen_days: ['2026-09-17'] }, updated_at: NOW },
  // 以下三类**应当整类不出现在卡片上**（痛点/焦虑/认知 = 判断类标签）
  { id: 'pt9', user_id: user.id, dimension: '痛点', label: '缺项目经验', weight: 0.86, source: 'chat', extra: null, updated_at: NOW },
  { id: 'pt10', user_id: user.id, dimension: '痛点', label: '拖延', weight: 0.62, source: 'chat', extra: null, updated_at: NOW },
  { id: 'pt11', user_id: user.id, dimension: '焦虑', label: '中', weight: 0.5, source: 'test', extra: null, updated_at: NOW },
  { id: 'pt12', user_id: user.id, dimension: '认知', label: '模糊', weight: 0.55, source: 'chat', extra: null, updated_at: NOW },
  // 这一条是**判断类措辞落在可见维度**里的真实样本（实测库里就有）：
  // 维度是"能力"，但它是测试表映射写进来的判断，**必须也不出现**（第二道过滤）。
  { id: 'pt19', user_id: user.id, dimension: '能力', label: '行动力待提升', weight: 0.5, source: 'test', extra: null, updated_at: NOW },
]

const PROFILE_SUMMARY = '你是个喜欢自己动手折腾的人：会写代码，也一直在琢磨技术怎么变成产品。'

const profileTested = {
  id: 'p1', user_id: user.id, clarity_score: 68, action_score: 54, resume_score: 41,
  total_score: 54, stage: 'prepare', updated_at: NOW, tested: true,
  summary: PROFILE_SUMMARY, tags: profileTags, user,
}
const profileUntested = {
  id: 'p2', user_id: user.id, clarity_score: 0, action_score: 0, resume_score: 0,
  total_score: 0, stage: 'explore', updated_at: NOW, tested: false,
  summary: '还在认识你 —— 多聊两句，这里会慢慢具体起来。', tags: [], user,
}

const task = {
  id: TASK_ID, user_id: user.id, title: '做一个待办清单 Web 应用',
  description: '从 0 到 1 写一个能能真正跑起来的 Vue 小应用。', pain_point: '缺项目经验',
  status: '进行中', value_note: '简历上能写成一个完整项目。', difficulty: '中等',
  estimated_days: 14, created_at: '2026-09-10T20:05:00+08:00', updated_at: NOW, progress: 0.4,
}
const taskSteps = [
  { id: 's1', task_id: TASK_ID, step_order: 1, title: '装好 Node.js 与 Vite 并跑通 Hello World', action: '用官网稳定版建模板工程。', resource: null, completed: true, feedback: '顺利。', completed_at: '2026-09-11T21:40:00+08:00' },
  { id: 's2', task_id: TASK_ID, step_order: 2, title: '实现待办列表页与本地存储', action: '用列表组件渲染，localStorage 存本地。', resource: null, completed: false, feedback: null, completed_at: null },
]
const taskDetail = { ...task, steps: taskSteps }

/* ------------------------------ 简历（新契约） ------------------------------ */

/** 与后端 resume_template._field 同构：question 是界面上唯一的文案出处 */
const rf = (key, label, question, example, required = false, multiple = false, lines = false) =>
  ({ key, label, question, example, required, multiple, lines })

/** 项目经历 / 校园与实践经历共用字段（后端 _experience_fields） */
const experienceFields = () => [
  rf('name', '名称', '这段经历叫什么？（项目名 / 活动名）', '校园二手交易小程序'),
  rf('role', '你的角色', '你在这段经历里是什么角色？', '前端开发'),
  rf('period', '起止时间', '这段时间大概是什么时候？（没记住可以不填）', '2024.09 - 2024.12'),
  rf('star.situation', '情境', '当时是什么背景、要解决什么问题？', '老师布置了课程作业，要做一个小程序；同学们卖二手书很麻烦'),
  rf('star.task', '任务', '你要做成什么？', '做出能发布和搜索二手书的页面'),
  rf('star.action', '行动', '你具体做了什么？', '我负责前端页面，用 Vue 写的'),
  rf('star.result', '结果', '最后达成什么？有数字就写上。', '最后上线了，有一百多个同学用过'),
]

/**
 * GET /resume/template 的真实出参 —— 逐字抄自 backend/app/services/resume_template.py。
 *
 * 为什么必须补这一条：旧版 mock 只有一条 `GET /resume/{x}` 通配，`/resume/template`
 * 与 `/resume/mine` **都**被它当成"简历明细"返回。模板里于是没有 `sections`，
 * 页面走 `loadError.template` 落失败卡「这次没拿到简历模板。」；而路由判定只看
 * 白屏 / URL / 文本长度，**失败卡照样 PASS** —— 这正是假绿的来源。
 *
 * 技能栏必须是 `multiple: true` + `lines: true`：前端 FieldList 按 `field.lines`
 * 才渲染 textarea（MyResumePage 里 `field.lines ? <Textarea rows={4}/> : ...`）。
 */
const resumeTemplate = {
  sections: [
    {
      key: 'basic', label: '基本信息', repeatable: false, fields: [
        rf('name', '姓名', '你叫什么名字？', '张三', true),
        rf('gender', '性别', '你是男生还是女生？（选填）', '男'),
        rf('grade', '年级', '你现在大几？（选填）', '大三'),
        rf('major', '专业', '你学什么专业？', '软件工程', true),
        rf('school', '学校', '你在哪所学校？', 'XX 大学', true),
        rf('contact', '联系方式（电话或邮箱）', '怎么联系你？（电话或邮箱，写一个就行）', '138xxxx1234 或 zhangsan@example.com', true),
      ],
    },
    {
      key: 'target', label: '求职意向', repeatable: false, fields: [
        rf('direction', '想投的方向/岗位', '你想投哪个方向或岗位？', '前端开发实习生', true),
        rf('city', '城市', '你倾向去哪个城市？（选填）', '杭州'),
      ],
    },
    {
      key: 'education', label: '教育背景', repeatable: true, fields: [
        rf('school', '学校', '这段教育经历是哪所学校？', 'XX 大学'),
        rf('major', '专业', '是什么专业？', '软件工程'),
        rf('period', '起止时间', '什么时候到什么时候？', '2022.09 - 2026.06'),
        rf('highlights', '亮点', '有什么值得一提的？（课程、成绩、奖项，一条一句）', '专业排名前 20%', false, true),
      ],
    },
    {
      key: 'skills', label: '技能', repeatable: false, fields: [
        rf('items', '技能', '你会用什么工具或技术？（一个一行，写关键词就行）', 'Java\nVue\nExcel', false, true, true),
      ],
    },
    { key: 'projects', label: '项目经历', repeatable: true, fields: experienceFields() },
    { key: 'campus', label: '校园与实践经历', repeatable: true, fields: experienceFields() },
    {
      key: 'self_evaluation', label: '自我评价', repeatable: false, fields: [
        rf('text', '自我评价', '用几句话说说你自己的特点。', '做事比较较真，答应的事会做完；不太会主动争取，正在改。'),
      ],
    },
  ],
}

/** parsed_data 的契约结构（backend types ResumeData：basic/target/education/skills/projects/campus/self_evaluation） */
const resumeParsedData = {
  basic: { name: '林小满', gender: '女', grade: '大三', major: '软件工程', school: '华中科技大学', contact: 'lin@example.com' },
  target: { direction: '前端开发工程师', city: '武汉' },
  education: [{ school: '华中科技大学', major: '软件工程', period: '2023.09 - 2027.06', highlights: ['专业排名前 20%'] }],
  skills: ['Vue', 'TypeScript'],
  projects: [
    {
      name: '待办清单 Web 应用', role: '独立开发', period: '2025.03 - 2025.06',
      star: {
        situation: '想做一个能写进简历的完整项目。',
        task: '做出一份能能真正跑起来的Web 应用。',
        action: '用 Vue + Vite 写列表与本地持久化。',
        result: '上线后日活约 800。',
      },
    },
  ],
  campus: [],
  self_evaluation: '做事比较较真，答应的事会做完。',
}

/**
 * GET|PUT /resume/mine 的"有简历"形状（契约：id/title/target_job/parsed_data/completeness/updated_at）。
 * 没有简历时后端返回 **data = null**（HTTP 200 + code 0，不是 404），见 api/resume.ts。
 */
const resumeMineSaved = {
  id: RESUME_ID,
  title: '林小满-前端开发-2026 秋招',
  target_job: '前端开发工程师',
  parsed_data: resumeParsedData,
  completeness: 0.82,
  updated_at: NOW,
}

/* ---------------------------- 每日一问历史 ---------------------------- */

/** GET /daily/history（schemas/daily_question.DailyHistoryResponse）：answered_at 倒序 */
const DAILY_HISTORY_FIRST_ANSWER = '改过一次简历，还投了三家。'
const dailyHistory = {
  total: 3,
  items: [
    { id: 'dh-1', question_id: 'dq-old-1', content: '过去一个月，你为求职做过下面哪件事？', dimension: '行动', answer: DAILY_HISTORY_FIRST_ANSWER, answered_at: '2026-09-17T21:12:00+08:00' },
    { id: 'dh-2', question_id: 'dq-old-2', content: '你觉得自己最想让别人记住的一点是什么？', dimension: '能力', answer: '做事比较较真，答应的事会做完。', answered_at: '2026-09-16T20:40:00+08:00' },
    { id: 'dh-3', question_id: 'dq-old-3', content: '最近一次投递没回音，你觉得卡在哪个环节？', dimension: '焦虑', answer: '大概是简历里的项目描述太虚了。', answered_at: '2026-09-15T22:05:00+08:00' },
  ],
}

/** N2 用的题目：首屏只给 1 道（贴近后端「答一题给下一题」的增量行为） */
const IV_FIRST_QUESTION = { id: 'q-1', interview_id: SESSION_ID, question_order: 1, content: '先花一分钟介绍一下你自己，重点讲前端开发相关的部分。', answer: null, followups: [], score: null, created_at: NOW, answered_at: null, kind: 'main', current_followup: null, followup_round: 0 }
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
const REVIEW_ANSWER = '我是软件工程大三学生，做过一个待办清单 Web 应用应用，负责全部客户端开发。'
const REVIEW_COMMENT = '结构完整但缺亮点，建议把最有说服力的一段经历前置。'
const REVIEW_BETTER = '先说结论：两年前端经验，做过一个 800 日活的小应用，再展开细节。'
const interviewReview = {
  interview_id: SESSION_ID, status: '已完成', overall_score: 71,
  dimension_scores: { 表达清晰度: 74, 项目深度: 66, 技术基础: 78, 岗位匹配: 68 },
  strengths: ['能把项目背景讲清楚，技术选型有理由。', '对 Vue 声明式写法理解扎实。'],
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

/**
 * GET /badge 的新契约（frontend/src/api/badge.ts + utils/badge.ts::normalizeBadgeOverview）：
 * `data` 是 **BadgeOverview 对象** { total, obtained_count, items[] }，不是旧裸数组。
 * 三枚奖章与顺序、文案抄自 backend/app/services/badge_service.py 的 BADGE_RULES。
 * 空态 = `items: []` + total 仍是 3（后端 total 恒等于规则条数，"没拿到"不等于"没有奖章"）。
 */
const BADGE_ITEMS = [
  {
    key: 'first_task', name: '起步行动家', description: '完成第一个成长任务',
    hint: '你已经迈出第一步——动手做，永远比想清楚更值钱',
    obtained: true, obtained_at: '2026-09-14T19:02:00+08:00', progress: { current: 1, target: 1 },
  },
  {
    key: 'five_steps', name: '坚持打卡者', description: '累计打卡 5 个任务步骤',
    hint: '稳定坚持比一时冲劲更难得，你已经打卡 5 次了',
    obtained: true, obtained_at: '2026-09-16T21:10:00+08:00', progress: { current: 5, target: 5 },
  },
  {
    key: 'profile_shape', name: '方向初现', description: 'AI 从对话里攒够 6 条你的画像标签',
    hint: '多和 AI 聊几轮，让它从你的话里攒出 6 条画像标签',
    obtained: false, obtained_at: null, progress: { current: 4, target: 6 },
  },
]
const BADGE_OVERVIEW = { total: 3, obtained_count: 2, items: BADGE_ITEMS }
const BADGE_OVERVIEW_EMPTY = { total: 3, obtained_count: 0, items: [] }

/** ProfilePage 在 items 为空时渲染的空态句（旧文案「还没有奖章。…」已被删除） */
const BADGE_EMPTY_TEXT = '奖章还在铸造，过一会儿再来看看。'

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
  const { mode = 'ok', tested = true, badge = 'data', ivAnswerSeq = IV_ANSWER_SEQ, resumeMine = 'none' } = opts
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
    if (method === 'GET' && p === '/profile/tags') return J(profileTags)
    if (method === 'POST' && p === '/profile/feedback') return J(profileTested)

    if (method === 'GET' && p === '/home/summary') {
      return J({
        stage: 'prepare', stage_label: '求职准备期',
        profile: { clarity_score: 68, action_score: 54, resume_score: 41, total_score: 54, stage: 'prepare', tested: true },
        tags: tags.map((t) => ({ dimension: t.dimension, label: t.label, weight: t.weight, source: t.source })),
        daily_question: { id: 'dq1', content: '最近一次投递没回音，你觉得卡在哪个环节？', options: [], answered: false },
        ai_findings: [{ pain_point: '缺项目经验', label: '缺项目经验', reason: '三轮对话里都提到没有能写进简历的项目。', target_route: '/task' }],
        ongoing_tasks: [{ id: TASK_ID, title: task.title, difficulty: '中等', estimated_days: 14, done_steps: 1, total_steps: 2, current_step_title: '实现待办列表页与本地存储' }],
        /* 2026-10 首页改版：后端 /home/summary 新增三个统计字段
           （口径与 /report 共用 report_service.collect_growth_counts） */
        completed_tasks: 1, completed_steps: 7, active_days: 12,
        next_action: { text: '先把这个小项目的删除交互补完', route: `/task/${TASK_ID}`, reason: '任务已经做到一半。' },
      })
    }

    if (method === 'GET' && p === '/task') return J([task])
    if (method === 'POST' && p === '/task/generate') return J(taskDetail)
    if (method === 'GET' && /^\/task\/[^/]+$/.test(p)) return J(taskDetail)
    if (method === 'POST' && /^\/task\/[^/]+\/steps\/[^/]+\/complete$/.test(p)) return J(taskDetail)
    if (method === 'POST' && /^\/task\/[^/]+\/abandon$/.test(p)) return J({ ...task, status: '已放弃' })

    if (method === 'GET' && p === '/daily/today') return J({ question: { id: 'dq1', dimension: '焦虑', content: '最近一次投递没回音，你觉得卡在哪个环节？', options: null, created_at: NOW }, answered: false, answer: null, streak: 4 })
    /* 之前完全没有这条 mock：/daily 的请求落到 catch-all 拿到 data=null，
       页面把历史区降级成空态「还没有答过的题」，而路由判定照样 PASS。 */
    if (method === 'GET' && p === '/daily/history') return J(dailyHistory)
    if (method === 'POST' && p === '/daily/answer') return J({ id: 'da1', user_id: user.id, question_id: 'dq1', answer: '大概是简历里的项目描述太虚了。', answered_at: NOW, profile_refreshed: true, extracted_tags: [] })

    /*
     * 简历四条端点（老 ATS 链路已整体删除，只剩这四条）：
     *   GET  /resume/template -> { sections: [...] }（界面"问什么"的唯一出处）
     *   GET  /resume/mine     -> 没有简历时 **data = null**（HTTP 200 + code 0，不是 404）
     *   PUT  /resume/mine     -> 保存后的那一份
     *   POST /resume/polish   -> 润色结果（本轮的自动断言不点它，但点到时不能给 null）
     * 这里刻意**不再用** `/resume/{x}` 通配：那正是"模板请求被当成简历明细"的假绿来源。
     */
    if (method === 'GET' && p === '/resume/template') return J(resumeTemplate)
    if (method === 'GET' && p === '/resume/mine') return J(resumeMine === 'saved' ? resumeMineSaved : null)
    if (method === 'PUT' && p === '/resume/mine') return J(resumeMineSaved)
    if (method === 'POST' && p === '/resume/polish') return J(resumeMineSaved)

    if (method === 'GET' && p === '/report') return J(growthReport)

    /* N4：奖章两态（新契约是 BadgeOverview 对象，空态是 items 为空而不是"没有奖章"） */
    if (method === 'GET' && p === '/badge') return J(badge === 'empty' ? BADGE_OVERVIEW_EMPTY : BADGE_OVERVIEW)

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

export { installApi };
