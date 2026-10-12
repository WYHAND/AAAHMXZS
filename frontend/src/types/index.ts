/**
 * 手写类型 —— **逐字段对齐后端 Pydantic schema**（backend/app/schemas/*.py）。
 *
 * 为什么不引入 openapi-typescript：骨架阶段后端未启动，无法生成；
 * 现在已按后端 schema 人工核对，字段名/可空性与后端一致。
 * 后端字段变更时，改这里 + 对应 api 文件即可。
 *
 * 约定：
 * - 所有 id 后端是 UUID，前端一律按 string 处理。
 * - 列表接口的 data 多数仍是**裸数组**（后端 PageData 定义了但一处未用），
 *   故列表类型统一用 `ListPayload<T> = T[] | PageData<T>`，读取一律走
 *   `utils/list.ts` 的 normalizeList()。
 *   ⚠️ 例外：GET /badge 已改成 BadgeOverview **对象**（见文件末尾），
 *   不要再拿 normalizeList 去套它。
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

/**
 * 单根雷达轴（前端派生，不是后端字段）。
 * ⚠️ 个人中心/首页的六轴画像雷达**不用**它（见 components/ProfileRadar.tsx）；
 * 现在只有面试复盘页拿它装后端 `dimension_scores`。
 */
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

/** 后端 schemas/chat.ConversationResponse */
export interface Conversation {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  conclusion?: Record<string, unknown> | null
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
  /** 回复失败：这条气泡只是一个「重试」入口，没有真正的回复内容 */
  interrupted?: boolean
}

/** 后端 schemas/chat.ChatRequest */
export interface ChatRequest {
  content: string
  client_msg_id?: string | null
}

/** 后端 schemas/chat.ChatResponse（一次性完整回复） */
export interface ChatResponse {
  conversation_id: string
  user_message: ChatMessage
  assistant_message: ChatMessage
  extracted_tags: Record<string, unknown>[]
  /** 该会话是否已有可拉取的结论卡片 */
  conclusion_ready: boolean
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

/**
 * 后端 schemas/task.TaskGenerateResponse —— 只给「生成任务」这一个接口用。
 *
 * reused 描述的是**这次调用的结果**，不是任务本身的属性：
 *   reused === true   服务端命中了已有同题任务、没有新建，上面就是那条**已有**任务
 *   reused === false  本次真的新建了任务
 *   reused 缺失       旧后端（字段还没上线）——调用方必须按「新建」处理
 *
 * 所以它挂在独立的响应类型上，而不是写进 Task / TaskDetail：
 * 详情、打卡、放弃、列表这些接口不会因此多出一个永远为 undefined 的字段。
 * 判定一律看 `reused === true`，不要去匹配 message 里的中文。
 */
export interface TaskGenerateResponse extends TaskDetail {
  reused?: boolean
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

/**
 * 后端 schemas/task.TaskDeleteResponse —— 「删除任务」的返回（硬删除，不可恢复）。
 *
 * completed_steps 是**这次真被删掉的已打卡步骤数**：行动力分数就是按"打过卡的步骤"
 * 累积的，所以删带打卡的任务分数会真的下降。列表页拿不到已打卡步数，
 * 点删除时要先拉一次详情把这个数字问准，再据此说清后果。
 */
export interface TaskDeleteResponse {
  /** 被删掉的任务 id */
  id: string
  /** 任务标题（删除后列表里就没有了，提示语里要用） */
  title: string
  /** 被删掉的步骤总数（含没打卡的） */
  deleted_steps: number
  /** 其中已打卡的步骤数 */
  completed_steps: number
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

/** 后端 schemas/daily_question.DailyHistoryItem（GET /daily/history 的一条） */
export interface DailyHistoryItem {
  id: string
  question_id: string
  /** 题干原文；题目已不可用（脏数据/题库重建）时后端给空串，条目不丢 */
  content: string
  /** 如「兴趣」「能力」；题目已不可用时为 null */
  dimension: string | null
  answer: string
  /** 后端是 naive UTC，收口时补成带 Z 的 ISO（见 api/daily.ts） */
  answered_at: string
}

/** 后端 schemas/daily_question.DailyHistoryResponse */
export interface DailyHistory {
  /** 用户答过的**真实总条数**（items 被服务端截断时也不会变小） */
  total: number
  /**
   * 后端已按 answered_at 倒序（最新在前），服务端硬上限 100 条。
   * 前端**不排序、不截断、不翻页**（后端目前不返回分页游标）。
   */
  items: DailyHistoryItem[]
}

/* ------------------------------- 简历 ------------------------------- */

/* --------- 「我的简历」单份简历契约（GET /resume/template，字段由后端下发） --------- */

/**
 * 模板里的一个字段。
 *
 * `key` 的语义随所在 section 变：
 * - `repeatable: false` 的 section（基本信息 / 求职意向 / 技能 / 自我评价）：
 *   key 相对**这个 section 本身**（如 basic.name、skills.items）；
 * - `repeatable: true` 的 section（教育背景 / 项目经历 / 校园与实践经历）：
 *   key 相对**单条经历**（如 school、star.situation）。
 *
 * `multiple: true` 表示这个字段是字符串数组（如教育经历的 highlights）。
 * `question` 是给用户看的问句 —— 界面上只显示它，**不在前端另写一份文案**。
 */
export interface ResumeField {
  key: string
  label: string
  question?: string | null
  example?: string | null
  required?: boolean
  /** 字符串数组字段（逗号分隔输入 / 一行一项） */
  multiple?: boolean
  /**
   * `multiple` 且 `lines: true`：**一项一行**地编辑（多行输入框，换行分隔）。
   * 技能用这个 —— 润色会把关键词展开成一句能力表述（"Java" ->
   * "熟悉 Java 基础语法、面向对象编程…"），句子本身带顿号逗号，
   * 再用顿号分隔的输入框会把一句话切成好几项。
   */
  lines?: boolean
  [key: string]: unknown
}

export interface ResumeSection {
  key: string
  label: string
  /** true = 可增删的一条条经历 */
  repeatable?: boolean
  fields: ResumeField[]
  [key: string]: unknown
}

/** 后端 schemas/resume.ResumeTemplateResponse（data.sections） */
export interface ResumeTemplateData {
  sections: ResumeSection[]
}

/* -------- parsed_data（提交给 POST /resume/polish 与 PUT /resume/mine 的结构） -------- */

export interface ResumeBasic {
  name: string
  grade: string
  major: string
  school: string
  contact: string
}

export interface ResumeTarget {
  direction: string
  city: string
}

export interface ResumeEducationItem {
  school: string
  major: string
  period: string
  highlights: string[]
}

/** STAR 四段：情境 / 任务 / 行动 / 结果 —— 界面上只允许出现中文小标题 */
export interface ResumeStar {
  situation: string
  task: string
  action: string
  result: string
}

export interface ResumeExperienceItem {
  name: string
  role: string
  period: string
  star: ResumeStar
}

export interface ResumeData {
  basic: ResumeBasic
  target: ResumeTarget
  education: ResumeEducationItem[]
  /** 技能：扁平字符串数组 */
  skills: string[]
  projects: ResumeExperienceItem[]
  campus: ResumeExperienceItem[]
  self_evaluation: string
}

/** 后端 schemas/resume.ResumeResponse（单份简历；ats_score 前端不展示） */
export interface ResumeResponse {
  id: string
  title?: string | null
  target_job?: string | null
  parsed_data?: ResumeData | null
  completeness?: number | null
  /** ⚠️ 界面上不展示它 */
  ats_score?: number | null
  file_path?: string | null
  created_at?: string | null
  updated_at?: string | null
}

/** 后端 schemas/resume.ResumePolishRequest */
export interface ResumePolishPayload {
  parsed_data: ResumeData
  target_job?: string | null
}

/** 后端 schemas/resume.ResumeUpdateMine */
export interface ResumeMineUpdatePayload {
  title?: string | null
  target_job?: string | null
  parsed_data: ResumeData
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

/**
 * 后端 schemas/report.ReportSuggestion（★ 由 List[str] 改成对象数组）
 * pain_point 为 null 时前端不显示「去做」按钮（不能发空痛点请求）。
 */
export interface ReportSuggestion {
  text: string
  pain_point: string | null
}

/**
 * GET /report 与 POST /report/save 的返回体（**扁平结构**，每次实时计算，不读快照）。
 *
 * ⚠️ 这些英文字段名只允许出现在数据层；渲染一律走 constants/score.ts 的中文 label。
 */
export interface GrowthReportData {
  stage: string
  stage_label?: string | null
  stage_changed: boolean
  clarity_score: number
  action_score: number
  resume_score: number
  total_score: number
  /** 与"最近一次保存的里程碑"相比的变化：{ clarity_score, action_score, resume_score, total_score } */
  score_delta: Record<string, number>
  completed_tasks: number
  completed_steps: number
  active_days: number
  highlights: string[]
  suggestions: ReportSuggestion[]
  /** 最近一次保存的时间；从没保存过 → null */
  last_saved_at: string | null
  /** 最近一次保存的报告里的「我的补充」 */
  user_note: string
  /** 是否至少保存过一份（为 false 时不要显示一排 +0） */
  saved: boolean
}

/** POST /report/save 的请求体：只允许提交「我的补充」（分数由行为算出，用户改不了） */
export interface ReportSavePayload {
  /** 可选，最多 500 字 */
  user_note?: string
}

/**
 * 旧版 schemas/report.ReportResponse { id, user_id, type, content, created_at }。
 * 后端改造期间可能还在返回这个形状，api/report.ts 的 normalizeReport 会兼容它。
 */
export interface GrowthReportContent {
  stage: string
  stage_label?: string | null
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
  /** 旧版是纯字符串数组；新版是 { text, pain_point } */
  suggestions: Array<ReportSuggestion | string>
  last_saved_at?: string | null
  user_note?: string
  saved?: boolean
}

/** 旧版 schemas/report.ReportResponse */
export interface GrowthReport {
  id: string
  user_id: string
  /** growth / conclusion / resume */
  type: string
  content?: GrowthReportContent | null
  created_at: string
}

/* ------------------------------- 奖章 ------------------------------- */

/**
 * 后端 schemas/badge —— GET /badge 的 data 已从「裸数组」改成 BadgeOverview 对象。
 *
 * 旧的 UserBadgeResponse（{ id, badge_id, name, condition, obtained_at }）**已废弃并删除**：
 * 保留它只会让后来人照着旧形状写。若后端改动还没落地（响应仍是裸数组），
 * 兜底在 `utils/badge.ts` 的 normalizeBadgeOverview() 里做 —— 类型层不再出现旧形状。
 *
 * 约定：
 * - `items` 顺序由**后端**定（门槛从低到高），前端不排序、不补位。
 * - `key` 是稳定机器标识，只用来挑奖章美术；取不到已知值时走默认纹样（见 BadgeMedallion）。
 * - `obtained_at` 可为 null（未获得）。
 */
export interface BadgeProgress {
  current: number
  target: number
}

/** first_task / five_steps / profile_shape（以后会有新的，不要再做联合类型收口） */
export interface BadgeItem {
  key: string
  name: string
  /** 「完成第一个成长任务」 */
  description: string
  /** 未获得 = 怎么拿到；已获得 = 一句庆祝 / 意义 */
  hint: string
  obtained: boolean
  obtained_at: string | null
  progress: BadgeProgress
}

export interface BadgeOverview {
  total: number
  obtained_count: number
  items: BadgeItem[]
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
  /** 该痛点标签的证据强度（权重），用于信号条的长度；不是打分 */
  weight: number
}

/** 后端 schemas/home.HomeActivityPoint：近 N 天每日完成步数 */
export interface HomeActivityPoint {
  /** 本地日期 YYYY-MM-DD */
  date: string
  /** 当天完成的步骤数 */
  steps: number
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
  /** 已完成任务数（与成长报告同一口径，后端 report_service.collect_growth_counts） */
  completed_tasks: number
  /** 已打卡步骤数（同上） */
  completed_steps: number
  /** 活跃天数（同上） */
  active_days: number
  /** 近 14 天每日完成步数（含今天，升序，缺数据天补 0）；用于活动柱状图 */
  activity: HomeActivityPoint[]
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
