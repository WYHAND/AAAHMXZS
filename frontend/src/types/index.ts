/**
 * 手写类型 —— **逐字段对齐后端 Pydantic schema**（backend/app/schemas/*.py）。
 *
 * 为什么不引入 openapi-typescript：骨架阶段后端未启动，无法生成；
 * 现在已按后端 schema 人工核对，字段名/可空性与后端一致。
 * 后端字段变更时，改这里 + 对应 api 文件即可。
 *
 * 约定：
 * - 所有 id 后端是 UUID，前端一律按 string 处理。
 * - 列表接口的 data 是**裸数组**（后端 PageData 定义了但一处未用），
 *   故列表类型统一用 `ListPayload<T> = T[] | PageData<T>`，读取一律走
 *   `utils/list.ts` 的 normalizeList()。
 * - 阶段/状态/难度等枚举在后端是**中文**字符串，前端按 string 兜底 + 常量映射。
 */

/* ------------------------------- 通用包装 ------------------------------- */

/** 统一响应信封（后端 core/api_response.ApiResponse） */
export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

/** 后端定义了 PageData，但所有列表接口实际返回裸数组 —— 故用联合类型 + normalizeList */
export interface PageData<T> {
  total: number
  page: number
  page_size: number
  items: T[]
}

export type ListPayload<T> = T[] | PageData<T>

/* ------------------------------- 认证 / 用户 ------------------------------ */

/** 后端 schemas/user.UserResponse */
export interface User {
  id: string
  username: string
  school?: string | null
  major?: string | null
  /** 大一/大二/大三/大四/研究生 */
  grade?: string | null
  created_at: string
}

/** 后端 schemas/user.UserCreate：注册入参 */
export interface RegisterPayload {
  username: string
  password: string
  school?: string
  major?: string
  grade?: string
}

/** 后端 schemas/user.UserLoginRequest */
export interface LoginPayload {
  username: string
  password: string
}

/** 后端 schemas/user.TokenResponse：注册与登录**都**返回它（含 user） */
export interface TokenResponse {
  access_token: string
  token_type: string
  /** 有效期秒数 */
  expires_in: number
  user: User
}

/* ------------------------------- 画像 ------------------------------- */

/** 后端 schemas/profile.ProfileTagResponse */
export interface ProfileTag {
  id: string
  user_id: string
  /** 兴趣/能力/技能/痛点/焦虑/认知 */
  dimension: string
  /** 标签文案（后端字段名是 label，不是 name） */
  label: string
  /** 权重 0-1 */
  weight: number
  /** test/chat/resume/interview/daily/task */
  source: string
  extra?: Record<string, unknown> | null
  updated_at: string
}

/**
 * 后端 schemas/profile.ProfileResponse
 * ⚠️ 没有 next_action —— 设计说明书 5.4 提的字段后端未实现，
 * 首页 CTA 文案回落到 constants/stage.ts 的阶段文案。
 */
export interface Profile {
  id: string
  user_id: string
  clarity_score: number
  action_score: number
  resume_score: number
  total_score: number
  /** 探索期 / 准备期 / 冲刺期（中文，后端 utils/stage.py） */
  stage: string
  updated_at: string
  /** 是否已完成基础测试表；漏斗判据必须用它 */
  tested: boolean
  tags: ProfileTag[]
  user?: User | null
}

/** 后端 schemas/profile.ProfileFeedbackRequest */
export interface ProfileFeedbackPayload {
  tag_id?: string | null
  approved?: boolean
  comment?: string | null
}

/** 画像雷达（前端派生，不是后端字段） */
export interface ProfileRadarItem {
  dimension: string
  score: number
}

/* ------------------------------- 测试 ------------------------------- */

/** 后端 schemas/test.TestOption */
export interface TestOption {
  /** A/B/C/D */
  key: string
  text: string
  /** 该选项分值 0-5 */
  score: number
}

/** 后端 schemas/test.TestQuestion */
export interface TestQuestion {
  /** 稳定标识，如 q_clarity_01（字符串，不是数字） */
  id: string
  /** clarity/action/resume/interest */
  dimension: string
  content: string
  options: TestOption[]
  multiple: boolean
}

/** 后端 schemas/test.TestSubmitRequest：answers 是 题目id -> 选项key 的字典 */
export interface TestSubmitRequest {
  answers: Record<string, string>
  free_text?: string | null
}

/** 后端 schemas/test.TestResultResponse（同时也是初始画像） */
export interface TestResult {
  id: string
  user_id: string
  clarity_score: number
  action_score: number
  resume_score: number
  total_score: number
  stage: string
  created_at: string
  /** 答题明细 */
  answers?: Record<string, unknown> | null
  free_text?: string | null
}

/* ------------------------------- 对话 ------------------------------- */

export type StreamState =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'done'
  | 'error'
  | 'template_fallback'

/** 后端 schemas/chat.ConversationResponse */
export interface Conversation {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  conclusion?: Record<string, unknown> | null
  /** 7.7 追问计数器：当前挖掘维度 */
  followup_direction?: string | null
  /** 同方向已追问轮数，1 起 */
  followup_round: number
}

/** 后端 schemas/chat.MessageResponse */
export interface ChatMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 仅用户消息有值：前端幂等 id */
  client_msg_id?: string | null
  created_at: string
  /* ---- 以下为前端本地状态，后端不返回 ---- */
  /** 流式中断标记（不清空已收到内容） */
  interrupted?: boolean
}

/** 后端 schemas/chat.ChatRequest */
export interface ChatRequest {
  content: string
  client_msg_id?: string | null
}

/** 后端 schemas/chat.ChatResponse（非流式完整回复） */
export interface ChatResponse {
  conversation_id: string
  user_message: ChatMessage
  assistant_message: ChatMessage
  extracted_tags: Record<string, unknown>[]
}

/** 后端 schemas/chat.ChatConclusionCard（11.11） */
export interface ChatConclusionCard {
  conversation_id: string
  summary: string
  pain_points: string[]
  suggestions: string[]
  next_actions: string[]
  generated_at?: string | null
}

/**
 * 后端 schemas/chat.SSEEvent —— SSE 事件 data 的负载。
 * 外层恒为 {code,message,data}，data.type 与 `event:` 行一致。
 */
export interface SSEPayload {
  type?: 'start' | 'delta' | 'tag' | 'done' | 'error' | 'pending'
  /** 增量文本，仅 delta 有值 */
  content?: string
  conversation_id?: string
  /** 本轮 assistant 消息 id，仅 done 有值 */
  message_id?: string
  /** 追问轮次：start/delta 是本轮开始前的值，done 是本轮更新后的值；null = 隐藏进度环 */
  followup_round?: number | null
  /** 当前挖掘维度；与上一轮不同表示已换维度 */
  followup_direction?: string | null
  /** 仅 done：是否有结论卡片可拉取 */
  conclusion_ready?: boolean | null
  /** 扩展数据；tag 事件的新标签在 data.data.tags */
  data?: { tags?: ProfileTag[] } & Record<string, unknown>
  /* ---- pending（幂等命中）---- */
  user_message_id?: string
  replay_message_id?: string
  pending?: boolean
}

/* ------------------------------- 任务 ------------------------------- */

/** 后端 schemas/task.TaskResponse */
export interface Task {
  id: string
  user_id: string
  title: string
  description?: string | null
  /** 关联痛点 */
  pain_point?: string | null
  /** 进行中 / 已完成 / 已放弃（中文） */
  status: string
  value_note?: string | null
  difficulty?: string | null
  estimated_days?: number | null
  created_at: string
  updated_at: string
  /** 完成进度 0-1（后端直接给比例，不是 done/total 计数） */
  progress: number
}

/** 后端 schemas/task.TaskStepResponse */
export interface TaskStep {
  id: string
  task_id: string
  /** 序号从 1 开始 */
  step_order: number
  title: string
  /** 行动指引 */
  action?: string | null
  /** 资源链接（单条字符串，不是数组） */
  resource?: string | null
  completed: boolean
  feedback?: string | null
  completed_at?: string | null
}

/** 后端 schemas/task.TaskDetailResponse */
export interface TaskDetail extends Task {
  steps: TaskStep[]
}

/** 后端 schemas/task.TaskGenerateRequest */
export interface TaskGeneratePayload {
  /** 为空则由服务端从画像标签里挑 */
  pain_point?: string | null
}

/** 后端 schemas/task.TaskStepCompleteRequest：只有 feedback 一个字段 */
export interface TaskStepCompletePayload {
  feedback?: string | null
}

/* ------------------------------- 每日一问 ------------------------------- */

/** 后端 schemas/daily_question.DailyQuestionResponse */
export interface DailyQuestion {
  id: string
  dimension: string
  content: string
  options?: Record<string, unknown> | null
  created_at: string
}

/** 后端 schemas/daily_question.TodayQuestionResponse */
export interface TodayQuestion {
  question: DailyQuestion
  answered: boolean
  answer?: string | null
  /** 连续打卡天数 */
  streak: number
}

/** 后端 schemas/daily_question.DailyAnswerRequest：answer 上限 200 字 */
export interface DailyAnswerPayload {
  question_id: string
  answer: string
}

/** 后端 schemas/daily_question.DailyAnswerResponse */
export interface DailyAnswerResponse {
  id: string
  user_id: string
  question_id: string
  answer: string
  answered_at: string
  profile_refreshed: boolean
  extracted_tags: Record<string, unknown>[]
}

/* ------------------------------- 简历 ------------------------------- */

/** 后端 schemas/resume.ResumeResponse */
export interface Resume {
  id: string
  user_id: string
  title: string
  /** 本地磁盘相对路径（13.1），静态预览走 /uploads/{file_path} */
  file_path?: string | null
  /** 结构化内容：basics/education/experience/projects/skills */
  parsed_data?: Record<string, unknown> | null
  ats_score?: number | null
  completeness?: number | null
  target_job?: string | null
  created_at: string
  updated_at: string
}

/** 后端 schemas/resume.ResumeCreate */
export interface ResumeCreatePayload {
  title?: string
  target_job?: string | null
  parsed_data?: Record<string, unknown> | null
}

/** 后端 schemas/resume.ResumeUpdate */
export interface ResumeUpdatePayload {
  title?: string | null
  target_job?: string | null
  parsed_data?: Record<string, unknown> | null
}

/** 后端 schemas/resume.ResumeOptimizeRequest */
export interface ResumeOptimizePayload {
  target_job?: string | null
  focus?: string | null
}

/** 后端 schemas/resume 里 suggestions 的元素结构 */
export interface ResumeSuggestion {
  section?: string
  problem?: string
  suggestion?: string
  example?: string
  [key: string]: unknown
}

/** 后端 schemas/resume.ResumeOptimizeResponse（optimize 与 report 共用） */
export interface ResumeReport {
  resume_id: string
  /** ATS 评分 0-100 */
  ats_score: number
  completeness: number
  matched_keywords: string[]
  missing_keywords: string[]
  suggestions: ResumeSuggestion[]
  summary: string
  generated_at?: string | null
}

/* ------------------------------- 面试 ------------------------------- */

/** 后端 schemas/interview.InterviewStartRequest */
export interface InterviewStartPayload {
  /** 小测试 / 全真 */
  mode?: string
  /** HR / 项目 / 技术 */
  scene?: string
  resume_id?: string | null
  target_job?: string | null
}

/** 后端 schemas/interview.InterviewResponse */
export interface InterviewSession {
  id: string
  user_id: string
  mode: string
  scene: string
  status: string
  created_at: string
  updated_at: string
  report?: Record<string, unknown> | null
}

/** 后端 schemas/interview：追问问答记录元素 [{"round":1,"q":"追问句","a":"学生的回答"}] */
export interface InterviewFollowup {
  round: number
  q: string
  a?: string | null
}

/**
 * 后端 schemas/interview.InterviewQuestionResponse
 * ⚠️ 追问**不新建题目行**：这始终是数据库里那一行主问题，
 * 追问状态平铺在 kind / current_followup / followup_round。
 */
export interface InterviewQuestion {
  id: string
  interview_id: string
  /** 序号从 1 开始 */
  question_order: number
  /** 主问题原文（追问句在 current_followup，不会覆盖这里） */
  content: string
  /** 对**主问题**的回答（不会被追问回答覆盖） */
  answer?: string | null
  /** 追问问答记录（后端已从 Dict 修正为 List） */
  followups: InterviewFollowup[]
  score?: number | null
  created_at: string
  answered_at?: string | null
  /** main / followup：这行当前处于什么状态 */
  kind: string
  /** 当前**待回答**的追问句；没有则为 null */
  current_followup?: string | null
  /** 这一题已追问过的轮数（0 起，上限 2） */
  followup_round: number
}

/** 后端 schemas/interview.InterviewQuestionsResponse：**一次返回全部题目** */
export interface InterviewQuestionsResponse {
  interview_id: string
  mode: string
  scene: string
  status: string
  questions: InterviewQuestion[]
  /** 当前应回答第几题（从 1 开始） */
  current_index: number
}

/** 后端 schemas/interview.InterviewAnswerRequest：answer 非空，上限 5000 */
export interface InterviewAnswerPayload {
  question_id: string
  answer: string
}

/** 后端 schemas/interview.InterviewAnswerResponse 的 action 判别字段 */
export type InterviewAnswerAction = 'followup' | 'next_question' | 'finished'

/**
 * 后端 schemas/interview.InterviewAnswerResponse
 *
 * **唯一判别依据是 action**（不要靠猜、也不要靠 next_question 是否变化）：
 *   followup      → 这题要再问一句：**不追加新题、不前进 index**，
 *                   在 question_id 这一题上就地续问，显示 display_content
 *   next_question → 换一道新题：顺序追加一题，显示 display_content
 *   finished      → 题目问完了：调 POST /interview/{id}/finish 生成复盘
 * （next_question === null 只在 finished 出现。）
 */
export interface InterviewAnswerResponse {
  interview_id: string
  action: InterviewAnswerAction
  /** 等价于 action === 'followup' */
  is_followup: boolean
  /** 等价于 action === 'finished' */
  finished: boolean
  /** 本次回答归属的题（追问时与上一题相同 id）；finished 时为 null */
  question_id?: string | null
  /** 追问时指向主问题 id（当前实现里等于 question_id） */
  parent_question_id?: string | null
  /** 要显示的文本：追问句 或 新题原文；finished 时为 null */
  display_content?: string | null
  /** 本次要回答的对象已追问的轮数（追问时 1..2）；新题为 0 */
  followup_round: number
  next_question?: InterviewQuestion | null
  message: string
}

/** 后端 schemas/interview.InterviewFinishResponse */
export interface InterviewFinishResponse {
  interview_id: string
  status: string
  report?: Record<string, unknown> | null
}

/**
 * 后端 ai/schemas.InterviewQuestionReview（复盘里的逐题点评元素）。
 * 后端字段是 `answer_summary`（不是 `answer`）；这里额外兼容 `answer`，
 * 因为 `question_reviews` 在 schema 里是宽松的 Dict，兜底路径可能给出不同键名。
 */
export interface InterviewQuestionReview {
  question: string
  /** 你的回答摘要 */
  answer_summary?: string | null
  /** 兼容字段：部分实现/兜底会写 answer */
  answer?: string | null
  /** 0-100 */
  score?: number | null
  comment?: string | null
  /** 更好的答法（可选） */
  better_answer?: string | null
}

/** 后端 schemas/interview.InterviewReviewResponse */
export interface InterviewReview {
  interview_id: string
  status: string
  /** 综合得分 0-100 */
  overall_score: number
  /** 分维度得分 {维度: 分数} */
  dimension_scores: Record<string, number>
  strengths: string[]
  improvements: string[]
  /** 逐题点评（按后端 schema 渲染，不要 JSON 字符串化） */
  question_reviews: InterviewQuestionReview[]
  summary: string
  generated_at?: string | null
}

/* ------------------------------- 成长报告 ------------------------------- */

/** 后端 schemas/report.GrowthReportContent（放在 ReportResponse.content 里） */
export interface GrowthReportContent {
  stage: string
  stage_changed: boolean
  clarity_score: number
  action_score: number
  resume_score: number
  total_score: number
  /** 与上一份报告相比的变化 */
  score_delta: Record<string, number>
  completed_tasks: number
  completed_steps: number
  active_days: number
  highlights: string[]
  suggestions: string[]
}

/** 后端 schemas/report.ReportResponse */
export interface GrowthReport {
  id: string
  user_id: string
  /** growth / conclusion / resume */
  type: string
  content?: GrowthReportContent | null
  created_at: string
}

/* ------------------------------- 奖章 ------------------------------- */

/** 后端 schemas/badge.UserBadgeResponse */
export interface UserBadge {
  id: string
  badge_id: string
  name: string
  condition?: Record<string, unknown> | null
  obtained_at: string
}

/* ------------------------------- 首页聚合 ------------------------------- */

/** 后端 schemas/home.HomeProfileSummary */
export interface HomeProfileSummary {
  clarity_score: number
  action_score: number
  resume_score: number
  total_score: number
  /** 阶段 slug：explore / prepare / sprint */
  stage: string
  /** 是否已完成基础测试表 */
  tested: boolean
}

/** 后端 schemas/home.HomeTag */
export interface HomeTag {
  dimension: string
  label: string
  weight: number
  source: string
}

/** 后端 schemas/home.HomeDailyQuestion；题库为空时整个对象为 null */
export interface HomeDailyQuestion {
  id: string
  content: string
  options: Record<string, unknown>[]
  answered: boolean
}

/** 后端 schemas/home.HomeAiFinding（AI 主动发现，最多 3 条） */
export interface HomeAiFinding {
  /** 痛点标签原文，如「缺项目经验」 */
  pain_point: string
  /** 展示用标签（当前与 pain_point 同值） */
  label: string
  /** 为什么这么判断 */
  reason: string
  /** 点这条建议应该去哪：/chat /task /resume /interview */
  target_route: string
}

/** 后端 schemas/home.HomeOngoingTask（最多 2 条） */
export interface HomeOngoingTask {
  id: string
  title: string
  difficulty?: string | null
  estimated_days?: number | null
  done_steps: number
  total_steps: number
  /** 第一条未完成步骤的标题 */
  current_step_title?: string | null
}

/**
 * 后端 schemas/home.HomeNextAction
 * ⚠️ 产品「AI 主动性」的落点：由后端按规则/将来由 AI 决定，前端不判断优先级。
 */
export interface HomeNextAction {
  text: string
  route: string
  reason: string
}

/** 后端 schemas/home.HomeSummaryResponse（GET /home/summary 的 data） */
export interface HomeSummary {
  /** 阶段 slug：explore / prepare / sprint */
  stage: string
  /** 阶段中文名（附加字段，可直接展示） */
  stage_label: string
  profile: HomeProfileSummary
  /** 画像标签（按权重降序） */
  tags: HomeTag[]
  daily_question: HomeDailyQuestion | null
  ai_findings: HomeAiFinding[]
  ongoing_tasks: HomeOngoingTask[]
  next_action: HomeNextAction
}

/* ------------------------------- 埋点 ------------------------------- */

/** 9 工程约定：事件名固定 */
export type TrackEventName =
  | 'test_skip'
  | 'task_abandon'
  | 'advice_ignore'
  | 'daily_answer'
  | 'chat_round'

/** 后端 schemas/event.EventItem */
export interface EventItem {
  event: string
  payload?: Record<string, unknown>
  /** 客户端时间（ISO8601） */
  client_ts?: string | null
}

/** 后端 schemas/event.EventSubmitRequest（单条与批量两种形状都接受） */
export interface EventSubmitRequest {
  event?: string
  payload?: Record<string, unknown>
  client_ts?: string | null
  events?: EventItem[]
}
