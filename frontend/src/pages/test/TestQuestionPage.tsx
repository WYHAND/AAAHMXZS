import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Reveal, staggerDelay } from '@/components/Motion'
import { Panel } from '@/components/Panel'
import { Button } from '@/components/ui/button'
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
 * 版式（2026-10 前端迭代-02）：一屏一个主角 —— 题目主卡是唯一大块，题目标题走
 * text-headline-xl（本页没有 PageHeader，题目就是页头）；顶部一行进度用"还剩 N 题"这种
 * 人话，不再写"已作答 N"报表腔；选项是卡片式可点整块（圆形字母点 + 选中环）。
 * 动效只用 index.css 的统一语汇：Reveal 进场 + 选项 staggerDelay 淡入 + motion-lift/
 * motion-press 反馈，不写 keyframes、不改变盒子占位。
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
    /*
     * 显式点「下一题」与「选中后 300ms 自动跳题」的定时器可能同时到达：
     * 先清掉还没触发的定时器，否则按钮点击会在自动跳题之上再跳一题（连点跳两题）。
     * 定时器自己触发时调到这里，clearTimeout 一个已执行的 id 是空操作，无副作用。
     */
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
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

  /*
   * 等待态与错误态也要自己补外壳留白：本页是裸路由，外层没有 AppLayout 的 main，
   * 少了 pt-shell / px-margin 时等待条会贴在窗口左上角，和正式版式不是同一套留白。
   */
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-margin pt-shell">
        <AIThinking text="正在读取题目…" lines={4} />
      </div>
    )
  }

  if (failed || !current) {
    return (
      <div className="mx-auto w-full max-w-2xl px-margin pt-shell">
        <EmptyState
          title="题目暂时拉不下来"
          description="题库接口没返回内容。稍后重试，或先直接进入工作台。"
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void load()}>
                重新加载
              </Button>
              {/* 空态的唯一实心主 CTA（尺寸与圆角由 warm + lg 自带，页面不再手写） */}
              <Button variant="warm" size="lg" onClick={() => navigate('/', { replace: true })}>
                先去首页
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  const percent = total ? Math.round(((index + 1) / total) * 100) : 0
  /** 还差几题（按位置算，不用"已作答"这种报表词），最后一题单独给一句人话 */
  const remaining = Math.max(0, total - index - 1)

  return (
    // 高度来源（2026-10 收口，实测过，别再退回魔法数）：
    //   本页在 router/index.tsx 里是 RequireAuth 下的裸路由，不在 AppLayout 里 ——
    //   拿不到 main 的 pt-shell / px-margin / pb-margin，外壳留白要自己补：
    //   - 顶距用 pt-shell（padding 不是 margin：margin 不合并会把整页下推、撑出滚动）；
    //   - 高度用共享 token --spacing-shell-total(=顶部 76 + 底部留白 32 = 108px)，写成单变量 calc。
    //     规范 7.3 实测：多段 calc（再减 --spacing-margin、44px）会被 Tailwind 丢段，
    //     h-svh / h-screen 整条类名不生成，只有单变量那条稳（1440×900 下 = 792px）。
    //   - 容器高度确定后：题目区 flex-1 吃掉剩余空间、底部操作区 shrink-0 钉在底部，
    //     选项 3 个还是 4 个都不影响按钮位置（工具 tools/render-check/a1-question-geometry.mjs 量过）。
    //   - 不能用 h-full：外层是 min-h-svh，min-height 不构成确定高度，百分比会退化成 auto。
    //   - 动效只加不改几何：Reveal / motion-lift / motion-press 都是位移/透明度，不改变盒子占位，
    //     所以上面那套"一屏固定高度 + 按钮钉底"的几何不受影响。
    //   - 2026-10-22 字号抬高后的 390×844 账（可用 736 = 844 − 108）：
    //     进度区 36 + 间隙 16 + 操作区 93（按钮行 44 + 8 + 提示 22 + 上边距 16 + 描边 1）
    //     + 间隙 16 = 161，题干卡还剩 575 —— 四个选项即使每个两行（约 476）也放得下；
    //     真超长题干/更多选项时由中间那层 overflow-y-auto 自己滚，按钮不会被推出屏幕。
    <div className="mx-auto flex h-[calc(100svh-var(--spacing-shell-total))] min-h-0 w-full max-w-2xl flex-col gap-4 px-margin pt-shell">
      {/* 顶部进度：一行文字（第几题 / 共几题）+ 细进度条，固定高度 */}
      <Reveal className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-3 text-body-sm text-on-surface-variant">
          <span>
            第 {index + 1} 题 · 共 {total} 题
          </span>
          <span>{remaining > 0 ? `还剩 ${remaining} 题` : '这是最后一题'}</span>
        </div>
        <Progress
          value={percent}
          className="h-1.5 bg-surface-container [&>div]:bg-secondary"
          aria-label="答题进度"
        />
      </Reveal>

      {/* 题目主卡：吃掉剩余高度并垂直居中；选项过多时本区域内部滚动
          （min-h-0 必须写，否则 flex 子项不会收缩，滚动失效） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center">
          <Reveal lg className="w-full">
            <Panel className="w-full gap-4">
              <h1 className="text-headline-xl text-primary">{current.content}</h1>
              {current.multiple ? (
                <p className="text-body-sm text-on-surface-variant">
                  这题可选多项（骨架阶段按单选提交）
                </p>
              ) : null}

              {/* 选项区：未选中白底；选中浅墨底 + 描边环 + 实心字母点
                  （不能只靠浅底表达选中，规范 2.1）。
                 用色纪律（2026-10-22）：选中态**不用赭金**——赭金本屏只给顶部那条进度，
                 选项再实心一次就会和底部主按钮抢主角。
                  可点整块给 motion-lift（悬浮轻抬）+ motion-press（按下轻缩）。 */}
              <ul className="flex flex-col gap-2.5">
                {current.options.map((option, i) => {
                  const selected = answers[current.id] === option.key
                  return (
                    <Reveal as="li" key={option.key} fade delay={220 + staggerDelay(i)} className="flex">
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => choose(option.key)}
                        className={cn(
                          // transition-all 会盖掉 motion-* 的过渡，删掉；motion-lift 已含 transform/前景/底色过渡
                          'motion-lift motion-press flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-body-md',
                          selected
                            ? 'border-transparent bg-primary-soft text-primary ring-1 ring-primary/30'
                            : 'border-border bg-card text-on-surface hover:bg-surface-container',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-full text-body-sm font-semibold',
                            selected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-surface-container text-on-surface-variant',
                          )}
                        >
                          {option.key}
                        </span>
                        <span>{option.text}</span>
                      </button>
                    </Reveal>
                  )
                })}
              </ul>
            </Panel>
          </Reveal>
        </div>
      </div>

      {/* 底部操作区：固定在底部，任何题目都在同一位置（换题不跳由 a1-question-geometry.mjs 量过） */}
      <Reveal className="flex shrink-0 flex-col gap-2 border-t pt-4">
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            className="motion-press"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            上一题
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="motion-press" onClick={skip} disabled={submitting}>
              {index + 1 === total ? '跳过并提交' : '跳过这题'}
            </Button>
            {/* 同屏唯一的实心主按钮：最后一题变成「提交」 */}
            <Button variant="warm" size="lg" className="motion-press" onClick={goNext} disabled={submitting}>
              {index + 1 === total ? '提交' : '下一题'}
            </Button>
          </div>
        </div>
        {/* 提示行是"用户要不要跳过"的依据，属于信息，最低 text-body-sm（不能再用 caption） */}
        <p className="text-right text-body-sm text-on-surface-variant">
          答不上来没关系，跳过也不会扣分
        </p>
      </Reveal>
    </div>
  )
}
