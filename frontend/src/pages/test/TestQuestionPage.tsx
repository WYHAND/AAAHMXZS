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
            <Button variant="outline" onClick={() => void load()}>
              重新加载
            </Button>
            <Button variant="warm" onClick={() => navigate('/', { replace: true })}>
              先去首页
            </Button>
          </div>
        }
      />
    )
  }

  const percent = total ? Math.round(((index + 1) / total) * 100) : 0

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            第 {index + 1} / {total} 题 · 已作答 {answeredCount}
          </span>
          <span className="font-numeric">{percent}%</span>
        </div>
        <Progress value={percent} className="h-1.5" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <h1 className="text-lg font-semibold text-foreground">{current.content}</h1>
          {current.multiple ? (
            <p className="text-xs text-muted-foreground">这题可选多项（骨架阶段按单选提交）</p>
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
                    'flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                    selected
                      ? 'border-primary bg-primary-soft text-foreground'
                      : 'border-border bg-card hover:bg-secondary',
                  )}
                >
                  <span className="font-numeric text-xs text-muted-foreground">
                    {option.key}
                  </span>
                  <span>{option.text}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          上一题
        </Button>
        <div className="flex flex-col items-end gap-1">
          <Button variant="ghost" onClick={skip} disabled={submitting}>
            {index + 1 === total ? '跳过并提交' : '跳过这题'}
          </Button>
          <span className="text-xs text-muted-foreground">
            答不上来没关系，跳过也不会扣分
          </span>
        </div>
      </div>
    </div>
  )
}
