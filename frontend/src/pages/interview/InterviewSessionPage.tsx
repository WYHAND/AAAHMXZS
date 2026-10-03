import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownRight, SkipForward, Square } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { INTERVIEW_ANSWER_MAX } from '@/constants/form'
import { toInterviewReview } from '@/constants/routes'
import { useInterviewStore } from '@/store/interviewStore'
import { STORAGE_KEY, storage } from '@/utils/storage'

/**
 * 面试进行中（设计说明书 2.1 /interview/session，3.2 一题一屏）
 * 全屏沉浸（BlankLayout），无侧栏。
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
        title="还没有进行中的面试"
        description="先去选岗位和场景，再开始。"
        action={
          <Button variant="warm" onClick={() => navigate('/interview')}>
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
        title="这场面试已经答完了"
        description="所有题目都答完了，去看复盘。"
        action={
          <Button variant="warm" onClick={() => void finishAndReview(sessionId)}>
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

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            第 {currentIndex} / {total} 题
            {askingFollowup ? ` · 追问 ${pendingFollowup?.round ?? 1}/2` : ''}
          </span>
          <span className="font-numeric">
            {total ? Math.round(((currentIndex - 1) / total) * 100) : 0}%
          </span>
        </div>
        <Progress value={total ? ((currentIndex - 1) / total) * 100 : 0} className="h-1.5" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          {askingFollowup ? (
            <>
              <p className="text-xs text-muted-foreground">主问题</p>
              <p className="text-sm text-muted-foreground">{current.content}</p>
              {/* 追问：同一题的再问，用暖色竖条与主问题区分 */}
              <div className="ai-inset flex items-start gap-2 rounded-lg bg-accent/50 px-4 py-3">
                <CornerDownRight className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
                <p className="text-lg font-semibold leading-relaxed text-accent-foreground">
                  {displayText}
                </p>
              </div>
            </>
          ) : (
            <h1 className="text-lg font-semibold leading-relaxed text-foreground">
              {displayText}
            </h1>
          )}

          <Textarea
            rows={6}
            maxLength={INTERVIEW_ANSWER_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={askingFollowup ? '针对这个追问再补两句' : '按你自己的话说，不用背答案'}
          />
          <span className="font-numeric self-end text-xs text-muted-foreground">
            {draft.length}/{INTERVIEW_ANSWER_MAX}
          </span>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          {/*
            「结束面试」= 收尾动作：必须**真的调 finish 生成复盘**，不能只是跳走。
            以前这里写的是 navigate('/interview')，于是面试永远停在"进行中"、
            复盘永远生成不出来（用户点进去只看到"这份复盘还没生成"）。
          */}
          <Button
            variant="ghost"
            onClick={() => void finishAndReview(sessionId)}
            disabled={submitting || finishing}
            className="gap-1.5"
          >
            <Square className="size-4" />
            {finishing ? '正在生成复盘…' : '结束面试'}
          </Button>
          <Button
            variant="outline"
            onClick={() => void submit(true)}
            disabled={submitting || finishing}
            className="gap-1.5"
          >
            <SkipForward className="size-4" />
            跳过这题
          </Button>
        </div>
        {/* 本屏唯一实心主按钮 */}
        <Button
          variant="warm"
          onClick={() => void submit(false)}
          disabled={submitting || finishing || !draft.trim()}
        >
          {submitting ? '提交中…' : askingFollowup ? '回答追问' : '提交并继续'}
        </Button>
      </div>
    </div>
  )
}
