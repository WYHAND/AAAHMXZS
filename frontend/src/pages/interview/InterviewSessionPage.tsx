import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownRight, SkipForward, Square } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'
import { Panel } from '@/components/Panel'
import { INTERVIEW_ANSWER_MAX } from '@/constants/form'
import { toInterviewReview } from '@/constants/routes'
import { useInterviewStore } from '@/store/interviewStore'
import { STORAGE_KEY, storage } from '@/utils/storage'

/**
 * 面试进行中（设计说明书 2.1 /interview/session，3.2 一题一屏）
 * 全屏沉浸（BlankLayout），无侧栏。
 *
 * 布局（2026-10）：BlankLayout 对 `/interview/session` 自动放开宽度
 * （见 layouts/BlankLayout.tsx），页面自己用 `mx-auto max-w-3xl` 决定阅读宽度。
 * 顶部是一条沉浸式信息条（第 x/y 题 + 追问轮次 + 进度条 + 弱化的「结束面试」），
 * 不再套 PageShell —— 面试进行中要保留"整屏一题"的沉浸感。
 *
 * 契约要点（后端 schemas/interview.py + README §4.12）：
 *   追问 = **同一道题的再问，不新建题目行**。
 *   `POST /interview/{id}/answer` 的 `action` 是唯一判别依据，页面用 switch 分派：
 *     followup      → 就地续问：把 display_content 作为**同一题**的追问展示，
 *                     不追加新题、不前进 index
 *     next_question → 追加新题、index 前进（显示 display_content）
 *     finished      → 结束，去 POST /interview/{id}/finish 生成复盘
 *   追问轮数由后端的 followup_round 决定（上限 2），前端不自己数。
 */
export default function InterviewSessionPage() {
  const navigate = useNavigate()
  const sessionId = storage.session.get<string | null>(STORAGE_KEY.interviewId, null)

  const {
    questions,
    currentIndex,
    pendingFollowup,
    loading,
    loadQuestions,
    answer: submitAnswer,
    finish,
  } = useInterviewStore()

  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /** 「结束面试」正在生成复盘（要调 AI，可能十几秒，按钮上必须给出反馈） */
  const [finishing, setFinishing] = useState(false)

  const load = useCallback(async () => {
    if (!sessionId) return
    await loadQuestions(sessionId)
  }, [loadQuestions, sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const finishAndReview = useCallback(
    async (interviewId: string) => {
      setFinishing(true)
      const ok = await finish(interviewId)
      setFinishing(false)
      if (!ok) {
        toast.error('生成复盘失败，可以稍后在复盘页点「生成复盘」重试')
      }
      storage.session.remove(STORAGE_KEY.interviewId)
      navigate(toInterviewReview(interviewId), { replace: true })
    },
    [finish, navigate],
  )

  const submit = async (skip = false) => {
    if (!sessionId) return
    const current = questions[currentIndex - 1]
    if (!current) return
    if (!skip && !draft.trim()) return

    setSubmitting(true)
    // 后端 answer 有 min_length=1：跳过时给一个占位说明
    const text = skip ? '（跳过这题）' : draft.trim().slice(0, INTERVIEW_ANSWER_MAX)
    const action = await submitAnswer(sessionId, current.id, text)
    setSubmitting(false)

    switch (action) {
      case 'followup':
        // 就地续问：题目不变、index 不变，只把追问句换成气泡展示
        setDraft('')
        return
      case 'next_question':
        setDraft('')
        return
      case 'finished':
        setDraft('')
        await finishAndReview(sessionId)
        return
      default:
        toast.error('提交失败，答案还在输入框里')
    }
  }

  if (!sessionId) {
    return (
      <EmptyState
        className="mx-auto max-w-md"
        title="还没有进行中的面试"
        description="先去选岗位和场景，再开始。"
        action={
          <Button variant="warm" size="lg" onClick={() => navigate('/interview')}>
            去创建面试
          </Button>
        }
      />
    )
  }

  if (loading) return <AIThinking text="正在准备题目…" lines={3} />

  const current = questions[currentIndex - 1]

  if (!current) {
    return (
      <EmptyState
        className="mx-auto max-w-md"
        title="这场面试已经答完了"
        description="所有题目都答完了，去看复盘。"
        action={
          <Button variant="warm" size="lg" onClick={() => void finishAndReview(sessionId)}>
            生成并查看复盘
          </Button>
        }
      />
    )
  }

  // 正在等一句追问时展示追问句，否则展示主问题原文
  const askingFollowup = Boolean(pendingFollowup)
  const displayText = pendingFollowup?.text || current.content
  const total = questions.length
  /*
   * 进度：已答完的题占多少（第 1 题时是 0）。
   * 0% 的进度条在浅底上等于"什么都没有"，所以只要有题就至少给一小段起点，
   * 让"这场面试有长度"这件事在第一屏就看得见。
   */
  const answered = Math.max(((currentIndex - 1) / Math.max(total, 1)) * 100, 4)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* 沉浸式信息条：左边"现在到哪了"，右边唯一一个弱化出口 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-body-sm text-on-surface-variant">
            第 {currentIndex} / {total} 题
            {askingFollowup ? ` · 追问 ${pendingFollowup?.round ?? 1}/2` : ''}
          </p>
          {/*
            「结束面试」= 收尾动作：必须**真的调 finish 生成复盘**，不能只是跳走。
            以前这里写的是 navigate('/interview')，于是面试永远停在"进行中"、
            复盘永远生成不出来（用户点进去只看到"这份复盘还没生成"）。
            现在多一层二次确认（会中断当前这场），确认后走的还是同一个 finishAndReview。
          */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-on-surface-variant"
                disabled={submitting || finishing}
              >
                <Square className="size-3.5" />
                {finishing ? '正在生成复盘…' : '结束面试'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>现在结束这场面试？</AlertDialogTitle>
                <AlertDialogDescription>
                  没答完的题会按你已经答的内容算。结束后我立刻生成复盘，这场面试不能再继续。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={finishing}>再答一会儿</AlertDialogCancel>
                <AlertDialogAction
                  variant="warm"
                  disabled={finishing}
                  onClick={() => void finishAndReview(sessionId)}
                >
                  结束并生成复盘
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {/* 进度条：容器 surface-container + 指示条琥珀（设计系统 §四） */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
          <div
            className="h-full rounded-full bg-secondary transition-all duration-700"
            style={{ width: `${answered}%` }}
          />
        </div>
      </div>

      <Panel className="gap-4">
        {askingFollowup ? (
          <>
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <span className="text-caption text-caption-foreground">主问题</span>
              <p className="text-body-md text-on-surface-variant">{current.content}</p>
            </div>
            {/*
              追问：同一题的再问，靠 `ai-inset`（3px 琥珀竖条）+ 浅底与主问题区分。
              底色**不能**用 bg-accent（浅桃）—— 大面积浅桃会整页都在喊你。
            */}
            <div className="ai-inset flex items-start gap-2 rounded-lg bg-surface-container-low px-4 py-3">
              <CornerDownRight className="mt-1 size-4 shrink-0 text-secondary" aria-hidden />
              <p className="text-[20px] font-semibold leading-relaxed text-on-surface">
                {displayText}
              </p>
            </div>
          </>
        ) : (
          <h1 className="text-[20px] font-semibold leading-relaxed text-primary">{displayText}</h1>
        )}

        <div className="flex flex-col gap-1.5">
          <Textarea
            rows={6}
            maxLength={INTERVIEW_ANSWER_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={askingFollowup ? '针对这个追问再补两句' : '按你自己的话说，不用背答案'}
          />
          <span className="self-end text-caption text-caption-foreground">
            {draft.length}/{INTERVIEW_ANSWER_MAX}
          </span>
        </div>
      </Panel>

      {/* 底部：主按钮独占一行（本屏唯一实心），「跳过这题」退到它左上角 */}
      <div className="flex flex-col gap-3">
        <div className="flex justify-start">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void submit(true)}
            disabled={submitting || finishing}
            className="gap-1.5"
          >
            <SkipForward className="size-3.5" />
            跳过这题
          </Button>
        </div>
        <Button
          variant="warm"
          size="lg"
          className="w-full"
          onClick={() => void submit(false)}
          disabled={submitting || finishing || !draft.trim()}
        >
          {submitting ? '提交中…' : askingFollowup ? '回答追问' : '提交并继续'}
        </Button>
      </div>
    </div>
  )
}
