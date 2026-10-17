import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownRight, SkipForward } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Reveal } from '@/components/Motion'
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
import { cn } from '@/lib/utils'
import { useInterviewStore } from '@/store/interviewStore'
import { STORAGE_KEY, storage } from '@/utils/storage'

/**
 * 输入框的**可见**上限（500 字）。
 *
 * 后端 InterviewAnswerRequest.answer 的上限是 5000（= INTERVIEW_ANSWER_MAX），
 * 但把 `0/5000` 印在输入框旁边是假信息：一场口头回答本来没人写满 5000 字，
 * 那个分母只让人觉得自己"答得太少"。所以输入框按 500 字封顶，
 * 计数只在快写满时才出现（见 JSX）；提交时仍按后端上限截断（防 422）。
 */
const ANSWER_MAX = 500
/** 计数在场阈值：写到 80% 才显示剩余字数，平时不打扰 */
const ANSWER_COUNT_FROM = Math.floor(ANSWER_MAX * 0.8)

/**
 * 面试进行中（设计说明书 2.1 /interview/session，3.2 一题一屏）
 * 全屏沉浸（BlankLayout），无侧栏。
 *
 * 布局（2026-10 收口）：BlankLayout 对 `/interview/session` 自动放开宽度，
 * 页面自己用 `mx-auto max-w-3xl` 决定阅读宽度。自上而下一屏只有一个主角：
 * 一行上下文+进度 → 题目主卡（唯一的浅色大块）→ 底部唯一实心主 CTA。
 *
 * 上下文行（2026-10-19）：顶部那行先说清"这是哪一场、到第几题"——
 * 场景取自 store 里已经有的 `session.scene`（`/interview/start` 的返回值），
 * **不为此新增请求**；刷新页面后 store 里没有 session，就只留题号，不显示半截信息。
 * 底部动作分三层：「跳过这题」（弱）→「结束面试」（危险，text-destructive 文字按钮）
 * → 主 CTA（唯一实心）。未输入时主 CTA 是浅底副墨的"还不能提交"态，
 * 不用 `opacity-50` 的灰条：灰条既看不出禁用，也把黑色权重提前用掉了。
 *
 * 高度（规范 7.1 / 7.3，2026-10-12 前端迭代）：本页在 BlankLayout（wide）里，
 * 外壳自己带 `py-10`(40+40) + 40px 页脚，合计 **120px**，比共享 token
 * 「--spacing-shell-total」(108px) 多出 12px —— 只扣 108px 会让整页多出 12px 滚动。
 * 在**页面内**按实际可用高度收紧：再扣一个 `--spacing-gutter`(20px) 留 8px 余量，
 * 两个都是现成 token，不改布局也不引入魔法数。
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
    session,
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
      <Reveal fade className="mx-auto max-w-md">
        <EmptyState
          title="还没有进行中的面试"
          description="先去选岗位和场景，再开始。"
          action={
            <Button variant="warm" size="lg" className="motion-press" onClick={() => navigate('/interview')}>
              去创建面试
            </Button>
          }
        />
      </Reveal>
    )
  }

  // 加载中：用容器收一下宽度（BlankLayout 对面试页是全宽的）
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <AIThinking text="正在准备题目…" lines={3} />
      </div>
    )
  }

  const current = questions[currentIndex - 1]

  if (!current) {
    return (
      <Reveal fade className="mx-auto max-w-md">
        <EmptyState
          title="这场面试已经答完了"
          description="所有题目都答完了，去看复盘。"
          action={
            <Button
              variant="warm"
              size="lg"
              className="motion-press"
              onClick={() => void finishAndReview(sessionId)}
            >
              生成并查看复盘
            </Button>
          }
        />
      </Reveal>
    )
  }

  // 正在等一句追问时展示追问句，否则展示主问题原文
  const askingFollowup = Boolean(pendingFollowup)
  const displayText = pendingFollowup?.text || current.content
  const total = questions.length
  /*
   * 场景 = 这一场是什么面（项目 / HR / 技术）。值只从 store 的 session 里取，
   * 取不到（刷新后 store 是空的）就返回空串 —— 顶部只显示题号，不显示"面 ·"这种半截话。
   */
  const scene = session?.scene?.trim() ?? ''
  const sceneLabel = scene ? (scene.endsWith('面') ? scene : `${scene}面`) : ''
  /** 一次提交/收尾在跑（两个动作互斥地占用同一段时间，底部所有按钮一起禁用） */
  const busy = submitting || finishing
  /** 输入框里有字 = 可以提交（禁用与否、CTA 长相都看这一个布尔） */
  const ready = Boolean(draft.trim())
  /*
   * 进度：已答完的题占多少（第 1 题时是 0）。
   * 0% 的进度条在浅底上等于"什么都没有"，所以只要有题就至少给一小段起点，
   * 让"这场面试有长度"这件事在第一屏就看得见。
   */
  const answered = Math.max(((currentIndex - 1) / Math.max(total, 1)) * 100, 4)

  return (
    <div className="mx-auto flex h-[calc(100svh-var(--spacing-shell-total)-var(--spacing-gutter))] min-h-0 w-full max-w-3xl flex-col gap-6">
      {/*
        顶部上下文：左边「项目面 · 第 1 / 1 题」——先说是哪一场、再到第几题；
        追问进度退到这一行的右侧（它是暂时的状态，不该挤进那句主语里）。
      */}
      <Reveal className="flex shrink-0 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-baseline gap-1.5 text-body-sm">
            {sceneLabel ? (
              <>
                <span className="font-semibold text-primary">{sceneLabel}</span>
                <span className="text-caption-foreground" aria-hidden>
                  ·
                </span>
              </>
            ) : null}
            <span className="text-on-surface-variant">
              第 {currentIndex} / {total} 题
            </span>
          </p>
          {askingFollowup ? (
            <span className="shrink-0 text-caption text-caption-foreground">
              追问 {pendingFollowup?.round ?? 1}/2
            </span>
          ) : null}
        </div>
        {/* 进度条：容器 surface-container + 指示条琥珀（设计系统 §四）。
            key 跟着题号走 → 每次换题用 grow-x 从左长出来，值变化"看得见"。 */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container">
          <div
            key={`prog-${currentIndex}-${askingFollowup ? 'f' : 'm'}`}
            className="grow-x h-full rounded-full bg-secondary"
            style={{ width: `${answered}%` }}
          />
        </div>
      </Reveal>

      {/*
        题目区：吃掉剩余高度，题目主卡在其中垂直居中；追问过长时本区内部滚动
        （min-h-0 必须写，否则 flex 子项不会收缩，滚动失效）。
        参考 /test/question 的实测几何：一屏固定布局 + 卡片居中 + 操作区钉底。
      */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center">
          {/* 题目主卡：整屏唯一的主角，题目用 text-headline-xl 当本页的 h1
              （本页没有页头，问句就是这一屏的标题）。进场用大块节拍 rise-in-lg。 */}
          <Reveal lg delay={130} className="w-full">
            <Panel className="w-full gap-5">
              {askingFollowup ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-caption-foreground">主问题</span>
                    <p className="text-body-md text-on-surface-variant">{current.content}</p>
                  </div>
                  {/*
                    追问：同一题的再问，靠「ai-inset」（3px 琥珀竖条）+ 浅底与主问题区分。
                    浅底走统一实现 <Panel inset>（卡内浅底只有一种外观）。
                  */}
                  <Panel inset className="ai-inset flex-row items-start gap-2">
                    <CornerDownRight className="mt-1.5 size-4 shrink-0 text-secondary" aria-hidden />
                    <p className="text-headline-xl text-primary">{displayText}</p>
                  </Panel>
                </div>
              ) : (
                <h1 className="text-headline-xl text-primary">{displayText}</h1>
              )}

              <div className="flex flex-col gap-1.5">
                <Textarea
                  rows={6}
                  maxLength={ANSWER_MAX}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={askingFollowup ? '针对这个追问再补两句' : '按你自己的话说，不用背答案'}
                />
                {/* 计数只在快写满时才出现：平时旁边不挂"0/500"这种没人需要看的数字 */}
                {draft.length >= ANSWER_COUNT_FROM ? (
                  <span className="self-end text-caption text-on-surface-variant">
                    还能写 {ANSWER_MAX - draft.length} 字
                  </span>
                ) : null}
              </div>

              {/* 等 AI 回应时不留空白：说清它在做什么（规范 §五 加载态） */}
              {busy ? (
                <AIThinking
                  text={
                    finishing
                      ? '正在整理这场面试，马上出复盘…'
                      : '正在听你的回答，想想下一句该问什么…'
                  }
                  lines={2}
                />
              ) : null}
            </Panel>
          </Reveal>
        </div>
      </div>

      {/*
        底部三层动作：
          ①「跳过这题」= 弱动作（ghost，中性墨色）；
          ②「结束面试」= **危险动作**，用 text-destructive 文字按钮（无底色、无图标块），
             和①同处一行但颜色就把层级分开了；
          ③ 主 CTA 独占一行，是整屏唯一实心块（未输入时降级成浅底副墨的"还不能提交"）。
      */}
      <Reveal delay={250} className="flex shrink-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void submit(true)}
            disabled={busy}
            className="motion-press gap-1.5"
          >
            <SkipForward className="size-3.5" />
            跳过这题
          </Button>
          {/*
            「结束面试」= 收尾动作：必须**真的调 finish 生成复盘**，不能只是跳走。
            以前这里写的是 navigate('/interview')，于是面试永远停在"进行中"、
            复盘永远生成不出来（用户点进去只看到"这份复盘还没生成"）。
            现在多一层二次确认（会中断当前这场），确认后走的还是同一个 finishAndReview。
          */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="link"
                size="sm"
                className="motion-press px-1 text-destructive hover:text-destructive/80"
                disabled={busy}
              >
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
        <Button
          variant={ready ? 'warm' : 'secondary'}
          size="lg"
          className={cn(
            'motion-press w-full disabled:opacity-100',
            // 没输入：浅底 + 副墨字（可辨认的"暂时不能点"），而不是 50% 透明的灰条
            !ready && 'disabled:bg-surface-container disabled:text-on-surface-variant',
          )}
          onClick={() => void submit(false)}
          disabled={busy || !ready}
        >
          {submitting
            ? '提交中…'
            : !ready
              ? '写下回答后开始'
              : askingFollowup
                ? '回答追问'
                : '提交并继续'}
        </Button>
      </Reveal>
    </div>
  )
}
