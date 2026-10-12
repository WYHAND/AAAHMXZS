import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { testApi } from '@/api/test'
import { useProfileStore } from '@/store/profileStore'
import type { TestQuestion } from '@/types'
import { normalizeList } from '@/utils/list'
import { STORAGE_KEY, storage } from '@/utils/storage'
import { track } from '@/utils/track'
import { cn } from '@/lib/utils'

interface SavedProgress {
  index: number
  /** 题目 id -> 选项 key（后端 TestSubmitRequest.answers 的形状） */
  answers: Record<string, string>
  /** 跳过的题目 id */
  skipped: string[]
}

/**
 * 测试答题（设计说明书 2.1 /test/question，3.2 ④）
 *
 * - 一次一屏，选中后 300ms 自动进入下一题，可回退修改
 * - 本地保存答题进度（sessionStorage），刷新不丢；?resume=1 时提示已恢复
 * - 跳题行为上报 test_skip 事件（无感采集信号）
 *
 * 后端形状：GET /test/questions 返回裸数组，题目 id 是字符串（如 q_clarity_01），
 * **没有** index/total 字段 —— 进度由前端自己算；
 * POST /test/submit 的 body 是 { answers: {题目id: 选项key}, free_text? }。
 */
export default function TestQuestionPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // ⚠️ useSearchParams() 返回的引用不保证稳定，不能直接进依赖：
  // 否则 load 会被反复重建、useEffect 重复拉取全部题目（render-check bug #5）。
  // 这里只把它拆成原始 boolean 再进依赖。
  const shouldResume = searchParams.get('resume') === '1'
  const bumpVersion = useProfileStore((s) => s.bumpVersion)
  const setProfile = useProfileStore((s) => s.setProfile)

  const [questions, setQuestions] = useState<TestQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [skipped, setSkipped] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const timerRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const list = normalizeList(await testApi.questions())
      setQuestions(list)
      const saved = storage.session.get<SavedProgress | null>(STORAGE_KEY.testProgress, null)
      if (saved && shouldResume && list.length) {
        setIndex(Math.min(saved.index, list.length - 1))
        setAnswers(saved.answers ?? {})
        setSkipped(saved.skipped ?? [])
        toast.info('已恢复上次的答题进度')
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [shouldResume])

  useEffect(() => {
    void load()
  }, [load])

  // 进度落 sessionStorage
  useEffect(() => {
    if (!questions.length) return
    storage.session.set(STORAGE_KEY.testProgress, { index, answers, skipped })
  }, [index, answers, skipped, questions.length])

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const current = questions[index]
  const total = questions.length
  const answeredCount = useMemo(
    () => Object.keys(answers).length + skipped.length,
    [answers, skipped],
  )

  const submit = useCallback(async () => {
    setSubmitting(true)
    try {
      // 后端 answers 是字典；跳过的题直接不传
      const result = await testApi.submit({ answers })
      storage.session.remove(STORAGE_KEY.testProgress)
      // 让守卫立刻认为「已做测评」，避免被弹回 /test/intro
      if (result) {
        setProfile({
          stage: result.stage,
          clarity_score: result.clarity_score,
          action_score: result.action_score,
          resume_score: result.resume_score,
          total_score: result.total_score,
          updated_at: result.created_at,
        })
      } else {
        bumpVersion()
      }
      navigate('/test/result', { replace: true })
    } catch {
      toast.error('提交失败了，答案还留在本地，稍后再试')
    } finally {
      setSubmitting(false)
    }
  }, [answers, bumpVersion, navigate, setProfile])

  const goNext = useCallback(() => {
    if (index + 1 < total) {
      setIndex((i) => i + 1)
      return
    }
    void submit()
  }, [index, submit, total])

  const choose = useCallback(
    (optionKey: string) => {
      if (!current) return
      setAnswers((prev) => ({ ...prev, [current.id]: optionKey }))
      setSkipped((prev) => prev.filter((id) => id !== current.id))
      // 3.2 ④：选中后 300ms 自动进入下一题
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => goNext(), 300)
    },
    [current, goNext],
  )

  const skip = useCallback(() => {
    if (!current) return
    track('test_skip', { question_id: current.id, index })
    setAnswers((prev) => {
      const next = { ...prev }
      delete next[current.id]
      return next
    })
    setSkipped((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]))
    goNext()
  }, [current, goNext, index])

  if (loading) return <AIThinking text="正在读取题目…" lines={4} />

  if (failed || !current) {
    return (
      <EmptyState
        title="题目暂时拉不下来"
        description="题库接口没返回内容。稍后重试，或先直接进入工作台。"
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()}>
              重新加载
            </Button>
            {/* 空态的**唯一**主 CTA（warm + lg + 12px 圆角 / 15px·600） */}
            <Button
              variant="warm"
              size="lg"
              className="rounded-xl text-[15px] font-semibold"
              onClick={() => navigate('/', { replace: true })}
            >
              先去首页
            </Button>
          </div>
        }
      />
    )
  }

  const percent = total ? Math.round(((index + 1) / total) * 100) : 0

  return (
    // 高度来源（2026-10 收口，**全部实测过**，别再退回魔法数）：
    //   ⚠️ 本页在 router/index.tsx 里是 RequireAuth 下的**裸路由，不在 AppLayout 里**
    //      （实测 DOM 祖先链只有 body → 一层无类名的 div）：拿不到 main 的
    //      pt-shell / px-margin / pb-margin，所以顶距与高度要自己补。
    //   ⚠️ 补顶距必须用 **padding（pt-shell）不能用 margin**：margin 不会被外层合并，
    //      会把整页往下推、html.scrollHeight 超过视口（实测 976 > 900），而 padding 走 border-box
    //      （html/body 都是 border-box，Tailwind preflight 给过），高度里已经扣掉它，不会撑出滚动。
    //   高度就用共享 token `--spacing-shell-total`(= 顶部 76 + 底部留白 32 = 108px)：
    //      1440×900 下 = 792px，`pt-shell` 把进度行推到 y=76（与其它页标题起始线一致），
    //      容器底边 792，底部操作区（69px 高）落在 y=723~792，整页不滚动（docScrollH=900）。
    //      ⚠️ 实测按钮 y = 上一题 750 / 跳过 740；父智能体给的基线目标是 734 / 724，差 16px。
    //      逐层量过（tools/render-check/a1-action-row.mjs）：容器内容区 716 − 操作区 69 = 操作区顶 723，
    //      按钮在 69px 高的操作区里垂直居中 = 750/740。要对齐 734 需把高度再减 16px
    //      （页面会多出 16px 底部空白）。以"换题不跳 + 整页不滚动 + 顶距与其它页对齐"为准，不为此改结构。
    //      ⚠️ 别写成多段 calc（`100svh-var(--spacing-shell)-var(--spacing-margin)-44px`）：
    //      实测本项目的 Tailwind 编译会丢段——那条在浏览器里只减了第一段，
    //      `...-2rem-44px` 那条更是整条类名都没生成（computed height=0）。单变量的 calc 才稳。
    //   ⚠️ 这里**不能**用 h-full（height:100%）：外层是 min-h-svh，
    //      min-height 不构成"确定高度"，百分比会退化成 auto —— 实测过，按钮照样跳 54px。
    //      只要容器高度确定：「题目区 flex-1」吃掉剩余空间、「操作区 shrink-0」钉在底部，
    //      选项 3 个还是 4 个都不影响按钮位置（工具：tools/render-check/a1-question-geometry.mjs）。
    //   ⚠️ 容器**不要**加 `px-margin`：内容列会从 672px 缩到 608px，
    //      底部那行 caption「答不上来没关系，跳过也不会扣分」就只剩一行放不下的宽度 → 折成两行，
    //      操作区被撑高、整排按钮跟着下移（实测过 750/740）。
    //      max-w-2xl(672px) 在桌面端本来就不会贴边，横向不用再加留白。
    <div className="mx-auto flex h-[calc(100svh-var(--spacing-shell-total))] min-h-0 w-full max-w-2xl flex-col gap-5 pt-shell">
      {/* 顶部进度：固定高度 */}
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between text-body-sm text-on-surface-variant">
          <span>
            第 {index + 1} / {total} 题 · 已作答 {answeredCount}
          </span>
          <span className="tabular-nums">{percent}%</span>
        </div>
        <Progress value={percent} className="h-1.5" />
      </div>

      {/* 题目区：吃掉剩余高度，卡片在其中垂直居中；选项过多时本区域内部滚动
          （min-h-0 必须写，否则 flex 子项不会收缩，滚动失效） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center">
          <Card className="w-full">
            <CardContent className="flex flex-col gap-4 pt-6">
              <h1 className="text-[20px] leading-relaxed font-semibold text-primary">
                {current.content}
              </h1>
              {current.multiple ? (
                <p className="text-body-sm text-on-surface-variant">
                  这题可选多项（骨架阶段按单选提交）
                </p>
              ) : null}

              <div className="flex flex-col gap-2">
                {current.options.map((option) => {
                  const selected = answers[current.id] === option.key
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => choose(option.key)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-body-md transition-colors',
                        selected
                          ? 'border-primary bg-primary-soft text-primary ring-1 ring-primary/35'
                          : 'border-border bg-card text-on-surface hover:bg-surface-container',
                      )}
                    >
                      <span className="w-4 shrink-0 text-label-md text-caption-foreground">
                        {option.key}
                      </span>
                      <span>{option.text}</span>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 底部操作区：固定在底部，任何题目都在同一位置（几何由 a1-question-geometry.mjs 量过） */}
      <div className="flex shrink-0 items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          上一题
        </Button>
        <div className="flex flex-col items-end gap-1">
          <Button variant="ghost" size="sm" onClick={skip} disabled={submitting}>
            {index + 1 === total ? '跳过并提交' : '跳过这题'}
          </Button>
          {/*
            ⚠️ 这行必须留在 `text-caption`（12/16），**不能**升成 text-body-sm(13/20)：
            底部操作区的高度由这行撑起来（3 个选项时它就是最高的一列），
            行高 20 会让操作区 +4px、整排按钮下移 16px（实测「上一题」y 从 734 → 750）。
            颜色同理不能用 text-caption-foreground(#94a3b8)：在画布底上对比度只有 2.44，
            体检脚本 probe 会判「低对比」。
          */}
          <span className="text-caption text-on-surface-variant">
            答不上来没关系，跳过也不会扣分
          </span>
        </div>
      </div>
    </div>
  )
}
