/** 路由常量（设计说明书 2.1 路由表） */

export const ROUTES = {
  login: '/login',
  register: '/register',

  testIntro: '/test/intro',
  testQuestion: '/test/question',
  testResult: '/test/result',

  home: '/',
  chat: '/chat',
  task: '/task',
  taskDetail: '/task/:id',
  profile: '/profile',
  daily: '/daily',

  resume: '/resume',
  resumeCreate: '/resume/create',
  resumeEdit: '/resume/:id/edit',
  resumeReport: '/resume/:id/report',

  interview: '/interview',
  interviewPrepare: '/interview/prepare',
  interviewSession: '/interview/session',
  interviewReview: '/interview/review/:id',

  report: '/report',
  notFound: '/404',
} as const

/** 构建带参数的路径 */
export const toTaskDetail = (id: string | number) => `/task/${id}`
export const toResumeEdit = (id: string | number) => `/resume/${id}/edit`
export const toResumeReport = (id: string | number) => `/resume/${id}/report`
export const toInterviewReview = (id: string | number) => `/interview/review/${id}`

/**
 * 显式重测入口（Fix D3）：TestIntroPage 只在带 `?retest=1` 时不自动弹回首页。
 * 个人中心的「重新测评」用它。
 */
export const toTestIntroRetest = () => '/test/intro?retest=1'
/** 继续上次未提交的答题（TestQuestionPage 会从 sessionStorage 恢复） */
export const toTestResume = () => '/test/question?resume=1'
