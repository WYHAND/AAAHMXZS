import { create } from 'zustand'

import { interviewApi } from '@/api/interview'
import { useProfileStore } from '@/store/profileStore'
import type {
  InterviewAnswerAction,
  InterviewQuestion,
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
  reset: () => void
}

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
    set({ loading: true })
    try {
      const data = await interviewApi.questions(interviewId)
      const questions = data?.questions ?? []
      const currentIndex = Math.min(
        Math.max(data?.current_index ?? 1, 1),
        Math.max(questions.length, 1),
      )
      set({
        questions,
        currentIndex,
        // 刷新页面时若上一轮追问还没答，继续展示它
        pendingFollowup: followupOf(questions[currentIndex - 1]),
      })
    } catch {
      set({ questions: [], currentIndex: 1, pendingFollowup: null })
    } finally {
      set({ loading: false })
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
    set({ loading: true })
    try {
      const review = await interviewApi.review(id)
      set({ review: review ?? null })
    } catch {
      set({ review: null })
    } finally {
      set({ loading: false })
    }
  },

  reset() {
    set({
      session: null,
      questions: [],
      currentIndex: 1,
      pendingFollowup: null,
      review: null,
    })
    storage.session.remove(STORAGE_KEY.interviewId)
  },
}))
