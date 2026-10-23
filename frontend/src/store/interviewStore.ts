import { create } from 'zustand'

import { ApiError, get } from '@/api/client'
import { interviewApi } from '@/api/interview'
import { useProfileStore } from '@/store/profileStore'
import type {
  InterviewAnswerAction,
  InterviewQuestion,
  InterviewQuestionsResponse,
  InterviewReview,
  InterviewSession,
  InterviewStartPayload,
} from '@/types'
import { STORAGE_KEY, storage } from '@/utils/storage'

/**
 * interviewStore（设计说明书 4.1）
 *
 * 后端形状（schemas/interview.py）：
 *   POST /interview/start           -> InterviewResponse（含 id）
 *   GET  /interview/{id}/questions  -> 一次返回全部题目 + current_index
 *   POST /interview/{id}/answer     -> { action, question_id, display_content, followup_round, next_question }
 *   POST /interview/{id}/finish     -> 生成复盘
 *   GET  /interview/{id}/review     -> InterviewReviewResponse
 *
 * ⚠️ 追问契约（后端 README §4.12）：**追问 = 同一道题的再问，不新建题目行**。
 * `answer` 的唯一判别依据是 `action`：
 *   followup      → 就地续问：**不追加新题、不前进 index**，
 *                   把 display_content 作为同一题的追问句展示
 *   next_question → 追加新题并前进 index
 *   finished      → 结束（next_question === null 只在此时出现）
 * 早期实现把 next_question 一律接到队尾并前进，对 followup 是错的。
 */

/** 当前正在回答的追问（与 questions[currentIndex-1] 是同一题） */
export interface PendingFollowup {
  questionId: string
  text: string
  round: number
}

/**
 * 「继续上次面试」入口需要的最小信息。
 *
 * 刻意**只读、不进 store 状态**：它是面试选择页上的一次性探活结果，和正在进行的
 * 那场面试（session / questions）无关，塞进 store 反而会和会话页的加载互相干扰。
 */
export interface ResumableInterview {
  id: string
  /** 当前应回答第几题（1 起，取自后端 current_index） */
  currentIndex: number
  /** 这一场一共几题 */
  total: number
}

interface InterviewState {
  session: InterviewSession | null
  questions: InterviewQuestion[]
  /** 当前第几题（1 起，来自后端 current_index） */
  currentIndex: number
  /** 当前待回答的追问；没有则为 null */
  pendingFollowup: PendingFollowup | null
  review: InterviewReview | null
  loading: boolean

  start: (payload: InterviewStartPayload) => Promise<string | null>
  loadQuestions: (interviewId: string) => Promise<void>
  /** 提交回答；返回后端的 action，页面据此决定是否去生成复盘 */
  answer: (
    interviewId: string,
    questionId: string,
    answer: string,
  ) => Promise<InterviewAnswerAction | 'error'>
  finish: (interviewId: string) => Promise<boolean>
  fetchReview: (id: string) => Promise<void>
  /**
   * 探活 sessionStorage 里残留的面试 id：仍然是「进行中」才返回信息，
   * 否则（没存 / 已结束 / 已失效）返回 null，并把失效 id 清掉。
   */
  probeResumable: () => Promise<ResumableInterview | null>
  reset: () => void
}

/**
 * 换号世代：`reset()` 每跑一次 +1（登出 / 登录 / 注册都会走到）。
 * 它挡的是"迟到的响应"：上一个账号在途的 loadQuestions/fetchReview 回来时
 * 会把**别人的面试题目/复盘**写进新账号的内存。发请求前记下世代、落地前比一次即可。
 */
let fetchGeneration = 0

/** 后端 extra.current_followup 平铺出来的待答追问 */
function followupOf(question: InterviewQuestion | undefined): PendingFollowup | null {
  if (!question?.current_followup) return null
  return {
    questionId: question.id,
    text: question.current_followup,
    round: question.followup_round || 1,
  }
}

/** 用后端返回的完整题目对象就地替换（追问不新增行，所以是同 id 替换） */
function replaceQuestion(
  questions: InterviewQuestion[],
  incoming: InterviewQuestion,
): InterviewQuestion[] {
  const exists = questions.some((q) => q.id === incoming.id)
  if (!exists) return [...questions, incoming]
  return questions.map((q) => (q.id === incoming.id ? incoming : q))
}

export const useInterviewStore = create<InterviewState>((set) => ({
  session: null,
  questions: [],
  currentIndex: 1,
  pendingFollowup: null,
  review: null,
  loading: false,

  async start(payload) {
    set({ loading: true })
    try {
      const session = await interviewApi.start(payload)
      if (!session?.id) return null
      set({ session, questions: [], currentIndex: 1, pendingFollowup: null, review: null })
      storage.session.set(STORAGE_KEY.interviewId, session.id)
      return session.id
    } catch {
      return null
    } finally {
      set({ loading: false })
    }
  },

  async loadQuestions(interviewId) {
    const generation = fetchGeneration
    set({ loading: true })
    try {
      const data = await interviewApi.questions(interviewId)
      // 期间换过号 → 这批题目属于上一个账号，丢弃（见 fetchGeneration）
      if (generation !== fetchGeneration) return
      const questions = data?.questions ?? []
      const currentIndex = Math.min(
        Math.max(data?.current_index ?? 1, 1),
        Math.max(questions.length, 1),
      )
      set((state) => ({
        questions,
        currentIndex,
        // 刷新页面时若上一轮追问还没答，继续展示它
        pendingFollowup: followupOf(questions[currentIndex - 1]),
        /*
         * 刷新 / 直接从地址栏进本页时，store 里是**没有场次**的（只有 start() 会写 session），
         * 但 /interview/{id}/questions 的响应本身就带着 mode / scene / status。
         * 用它们补一个最小场次，否则进行中的页头只剩「第 1 / 1 题」，
         * 看不出这是哪一场、什么场景（2026-10-18 实测）。
         */
        session:
          state.session && state.session.id === data.interview_id
            ? state.session
            : {
                id: data.interview_id,
                user_id: '',
                mode: data.mode,
                scene: data.scene,
                status: data.status,
                created_at: '',
                updated_at: '',
                report: null,
              },
      }))
    } catch {
      if (generation !== fetchGeneration) return
      set({ questions: [], currentIndex: 1, pendingFollowup: null })
    } finally {
      if (generation === fetchGeneration) set({ loading: false })
    }
  },

  async answer(interviewId, questionId, answer) {
    try {
      const res = await interviewApi.answer(interviewId, {
        question_id: questionId,
        answer,
      })

      // 唯一判别依据是 action
      switch (res.action) {
        case 'followup':
          // 就地续问：不追加新题、不前进 index
          set((state) => ({
            questions: res.next_question
              ? replaceQuestion(state.questions, res.next_question)
              : state.questions,
            pendingFollowup: {
              questionId: res.question_id ?? questionId,
              text: res.display_content ?? res.next_question?.current_followup ?? '',
              round: res.followup_round,
            },
          }))
          return 'followup'

        case 'next_question': {
          const next = res.next_question
          set((state) => {
            if (!next) {
              // 理论上不该发生（next_question 只在 finished 时为 null），
              // 保守处理：不动列表，让页面继续渲染当前题
              return { pendingFollowup: null }
            }
            const questions = replaceQuestion(state.questions, next)
            const position = questions.findIndex((q) => q.id === next.id)
            return {
              questions,
              currentIndex: position >= 0 ? position + 1 : state.currentIndex + 1,
              pendingFollowup: null,
            }
          })
          return 'next_question'
        }

        case 'finished':
          set({ pendingFollowup: null })
          return 'finished'

        default:
          // 后端将来加了新 action：不要静默吞掉，让页面走错误分支
          return 'error'
      }
    } catch {
      return 'error'
    }
  },

  async finish(interviewId) {
    try {
      await interviewApi.finish(interviewId)
      storage.session.remove(STORAGE_KEY.interviewId)
      // 4.2：面试结束会回流画像
      useProfileStore.getState().bumpVersion()
      return true
    } catch {
      return false
    }
  },

  async fetchReview(id) {
    const generation = fetchGeneration
    set({ loading: true })
    try {
      const review = await interviewApi.review(id)
      if (generation !== fetchGeneration) return
      set({ review: review ?? null })
    } catch {
      if (generation !== fetchGeneration) return
      set({ review: null })
    } finally {
      if (generation === fetchGeneration) set({ loading: false })
    }
  },

  /**
   * 「继续上次面试」的探活（2026-10-18）。
   *
   * 为什么需要它：interviewId 存在 **sessionStorage** —— 刷新页面还在（会话页会从
   * /questions 重建场次），但**关标签页 / 新开标签页 / 桌面端重启**后就没了。
   * 服务端那场面试还是「进行中」，用户却没有任何入口回去，面试就成了孤儿。
   *
   * 判定只认后端：id 存在 **且** `status === '进行中'`（后端是中文枚举，
   * 见 services/interview_service.py）才允许显示入口；点击后跳 /interview/session，
   * 由会话页自己再拉一次题，这里不碰 session / questions。
   *
   * 失败一律**静默**：请求带 `silent: true`（否则一个过期 id 会在用户刚进页面时
   * 弹一句「内容不存在」），并且把失效 id 从 sessionStorage 里清掉 —— 不留坏状态。
   * 所以这里也**不复用** interviewApi.questions：那条路径没法带 silent。
   */
  async probeResumable() {
    const interviewId = storage.session.get<string | null>(STORAGE_KEY.interviewId, null)
    // 没存过 id：什么都不做（绝大多数人首次进本页就是这条）
    if (!interviewId) return null
    try {
      const data = await get<InterviewQuestionsResponse>(`/interview/${interviewId}/questions`, {
        silent: true,
      })
      if (data?.status !== '进行中') {
        // 已经答完 / 已结束：入口不该再出现，顺手清掉这个 id
        storage.session.remove(STORAGE_KEY.interviewId)
        return null
      }
      const questions = data.questions ?? []
      const total = questions.length
      return {
        id: data.interview_id,
        // 与 loadQuestions 同一套夹取：current_index 越界时退回一个安全值
        currentIndex: Math.min(Math.max(data.current_index ?? 1, 1), Math.max(total, 1)),
        total,
      }
    } catch (err) {
      /*
       * 只有"这个 id 确实没用了"才清掉：404 / 业务码 2001（id 无效、已删、或不属于本账号）。
       *
       * 其它失败（网络抖动、超时、代理瞬时 502）**必须保留 id** ——
       * 否则用户网络抖一下，入口就永久消失，等于又变回我们要修的那个"面试变孤儿"。
       * 保留的代价很小：这一次只是少显示一块，下次进页面会重新探活。
       */
      const code = err instanceof ApiError ? err.code : undefined
      if (code === 2001 || code === 404) {
        storage.session.remove(STORAGE_KEY.interviewId)
      }
      return null
    }
  },

  /**
   * 换号时必须调（见 store/reset.ts）。
   * 清掉：进行中的面试 session（含它的 id —— 最重要的一个，页面上所有请求都拿它当参数）、
   * 已拉到的题目 questions、当前题号 currentIndex、待回答的追问 pendingFollowup、
   * 复盘 review、loading 标志；并且把 sessionStorage 里的 interview_id 一并删掉
   * （InterviewSessionPage 刷新后会从那里恢复场次，不删就会去拉上一个账号的面试）。
   */
  reset() {
    // 世代 +1：上一个账号在途的 loadQuestions/fetchReview 回来时会被丢掉
    fetchGeneration += 1
    set({
      session: null,
      questions: [],
      currentIndex: 1,
      pendingFollowup: null,
      review: null,
      loading: false,
    })
    storage.session.remove(STORAGE_KEY.interviewId)
  },
}))
