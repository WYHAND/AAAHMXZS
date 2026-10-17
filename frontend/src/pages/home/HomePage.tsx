import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'motion/react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Lock,
  MessageSquare,
  NotebookPen,
  Sparkles,
  Timer,
} from 'lucide-react'
import { toast } from 'sonner'

import { ActivityStrip } from '@/components/ActivityStrip'
import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Panel } from '@/components/Panel'
import { ProfileRadar } from '@/components/ProfileRadar'
import { SignalBar } from '@/components/SignalBar'
import { Stat } from '@/components/StatGroup'
import { StatRing } from '@/components/StatRing'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { dailyApi } from '@/api/daily'
import { homeApi } from '@/api/home'
import { toTaskDetail } from '@/constants/routes'
import { hasEvidence } from '@/utils/profileEvidence'
import type { Stage } from '@/constants/stage'
import { useStage } from '@/hooks/useStage'
import { useChatStore } from '@/store/chatStore'
import { useProfileStore } from '@/store/profileStore'
import type {
  HomeActivityPoint,
  HomeAiFinding,
  HomeOngoingTask,
  HomeSummary,
  HomeTag,
} from '@/types'
import { cn } from '@/lib/utils'

/**
 * 首页（2026-10 第二轮：编辑式版式 + 焦点舞台）
 *
 * 自上而下，一屏只有一个主角：
 * 1. 问候：超大标题逐字浮现，下面一行阶段说明，不套卡片；
 * 2. 焦点舞台：整页唯一的深色大幅面 —— 今日焦点、编号步骤路径、主按钮；
 *    指针移过时有一团柔光弹簧跟随，当前步骤有脉冲环（2026-10-11 按用户要求删掉了
 *    「AI 随行手记」那一栏：后端仍下发 next_action.reason，只是不再在这张卡上展示）；
 * 3. 今日一问：直接铺在画布上，不做卡片；展开输入区时整段布局平滑让位；
 * 4. 两列等高（lg 以上 7/5）：左 AI 发现做成时间线；右 成长节律 + 其它任务合在一张面板里。
 *
 * 动效（motion）：标题逐字上浮；步骤按序弹出并沿线填充；时间线自上而下绘制；
 * 数字计数；输入区展开。MotionConfig 的 reducedMotion="user" 托管位移与循环动效，
 * 减少动态效果时指针光斑也不再跟随。
 *
 * 数据全部来自后端：GET /home/summary；今日一问作答走 POST /daily/answer。
 * 没有的字段（时间戳、题号、维度）一律不显示，不编造。
 */

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]

type FocusAction = { text: string; route: string; reason: string }

export default function HomePage() {
  const navigate = useNavigate()
  const { stage, label: stageLabel, fallbackCta } = useStage()
  const version = useProfileStore((s) => s.version)
  const setNextAction = useProfileStore((s) => s.setNextAction)
  const bumpVersion = useProfileStore((s) => s.bumpVersion)

  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  /** 「让 AI 先开口」请求在途：空态共用一个状态，防止连点建出多个空会话 */
  const [opening, setOpening] = useState(false)
  /** 同步重入闸：state 要等下一次渲染才生效，同一拍内的第二次点击靠它拦住 */
  const openingRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await homeApi.summary()
      setSummary(data ?? null)
      setFailed(!data)
      // 后端下发的下一步建议缓存到 store，供顶栏与其它页面复用
      setNextAction(data?.next_action ?? null)
    } catch {
      setSummary(null)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [setNextAction])

  // version 变化（打卡 / 对话结束 / 每日一问）后重新拉取；已有内容时原地更新，不闪骨架
  useEffect(() => {
    void load()
  }, [load, version])

  /** 空态统一的主动入口：先让 AI 开口，再带用户进对话页 */
  const handleLetAiSpeak = useCallback(async () => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    try {
      const conversationId = await useChatStore.getState().newConversation()
      if (conversationId) navigate('/chat')
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }, [navigate])

  // CTA：后端 next_action 优先，拿不到时回落到阶段固定文案
  const action: FocusAction = summary?.next_action
    ? {
        text: summary.next_action.text,
        route: summary.next_action.route,
        reason: summary.next_action.reason,
      }
    : { text: fallbackCta.text, route: fallbackCta.route, reason: '' }

  const tags = summary?.tags ?? []
  const tasks = summary?.ongoing_tasks ?? []
  const daily = summary?.daily_question ?? null
  const findings = summary?.ai_findings ?? []
  const displayLabel = summary?.stage_label ?? stageLabel
  const tested = summary?.profile.tested ?? false

  /** 焦点任务：建议指向哪个任务，它就是焦点（步数、当前停在都取它的真字段） */
  const focusedTask = tasks.find((task) => action.route === toTaskDetail(task.id)) ?? null
  /** 其它任务：排除焦点已经占用的那一个，避免同一件事出现两次 */
  const otherTasks = tasks.filter((task) => task.id !== focusedTask?.id)

  /**
   * 主按钮的短文案：后端下发的 action.text 是整句话（已经当大标题用了），
   * 按钮上只放一个诚实的动词，按目标路由决定。
   */
  const ctaLabel = (() => {
    const route = action.route
    if (route.startsWith('/task')) return '继续任务'
    if (route.startsWith('/chat')) return '去聊聊'
    if (route.startsWith('/resume')) return '去完善简历'
    if (route.startsWith('/interview')) return '去模拟面试'
    if (route.startsWith('/daily')) return '随手写一句'
    return '开始'
  })()

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex w-full flex-col gap-10">
        {/* ------------------------------- 问候 ------------------------------- */}
        <header className="flex flex-col gap-4">
          <Reveal className="text-caption tracking-wide text-caption-foreground">{formatToday()}</Reveal>
          <SplitTitle
            text="今天，做一件小事就够了"
            className="text-display-xl text-primary"
          />
          <Reveal delay={0.45} className="max-w-xl text-body-lg text-on-surface-variant">
            当前阶段：{displayLabel}。我会跟着你的心理舒适度与日常节奏调整建议
          </Reveal>
        </header>

        {loading && !summary ? <HomeSkeleton stage={stage} /> : null}

        {failed && !loading ? (
          <EmptyState
            title="工作台没加载出来"
            description="首页聚合接口没返回数据，稍后重试。"
            action={
              <Button variant="outline" onClick={() => void load()}>
                重新加载
              </Button>
            }
          />
        ) : null}

        {summary ? (
          <>
            <Reveal delay={0.3}>
              <FocusStage action={action} ctaLabel={ctaLabel} focusedTask={focusedTask} />
            </Reveal>

            <Reveal delay={0.42}>
              <DailyBand
                questionId={daily?.id ?? null}
                question={daily?.content ?? null}
                answered={Boolean(daily?.answered)}
                onAnswered={() => {
                  bumpVersion()
                  void load()
                }}
              />
            </Reveal>

            <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
              <Reveal delay={0.52} className="flex min-w-0 flex-col lg:col-span-7">
                <FindingsPanel
                  findings={findings.slice(0, 2)}
                  tags={tags}
                  tested={tested}
                  opening={opening}
                  onLetAiSpeak={() => void handleLetAiSpeak()}
                />
              </Reveal>

              <Reveal delay={0.6} className="flex min-w-0 flex-col lg:col-span-5">
                <ProgressPanel
                  completedTasks={summary.completed_tasks}
                  completedSteps={summary.completed_steps}
                  activeDays={summary.active_days}
                  activity={summary.activity ?? []}
                  tasks={tasks}
                  otherTasks={otherTasks}
                  onLetAiSpeak={() => void handleLetAiSpeak()}
                />
              </Reveal>
            </div>
          </>
        ) : null}
      </div>
    </MotionConfig>
  )
}

/** 入场包装：淡入 + 轻微上浮，delay 控制逐块出现的节奏 */
function Reveal({
  delay = 0,
  className,
  children,
}: {
  delay?: number
  className?: string
  children: ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/** 问候标题：逐字从遮罩里升起 */
function SplitTitle({ text, className }: { text: string; className?: string }) {
  return (
    <h1 className={className} aria-label={text}>
      {Array.from(text).map((char, index) => (
        <span key={index} aria-hidden className="inline-block overflow-hidden align-top">
          <motion.span
            className="inline-block"
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 + index * 0.04, ease: EASE }}
          >
            {char}
          </motion.span>
        </span>
      ))}
    </h1>
  )
}

/**
 * 焦点舞台：整页唯一的深色大幅面。
 * 指针移过时，一团柔光用弹簧跟随；离开时淡出，留下左上角的环境光在缓慢漂移。
 * （2026-10-11 用户要求删掉了卡内的「AI 随行手记」块——`action.reason` 仍然保留在
 *   类型与数据里，只是不再渲染；这样后端字段没被动，随时可以再放回来。）
 */
function FocusStage({
  action,
  ctaLabel,
  focusedTask,
}: {
  action: FocusAction
  ctaLabel: string
  focusedTask: HomeOngoingTask | null
}) {
  const reduce = useReducedMotion()
  const [hovering, setHovering] = useState(false)
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const spotX = useSpring(pointerX, { stiffness: 180, damping: 24, mass: 0.5 })
  const spotY = useSpring(pointerY, { stiffness: 180, damping: 24, mass: 0.5 })

  const trackPointer = (event: ReactPointerEvent<HTMLElement>, jump: boolean) => {
    if (reduce) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    pointerX.set(x)
    pointerY.set(y)
    if (jump) {
      spotX.jump(x)
      spotY.jump(y)
    }
  }

  return (
    <section
      onPointerEnter={(event) => {
        trackPointer(event, true)
        setHovering(true)
      }}
      onPointerMove={(event) => trackPointer(event, false)}
      onPointerLeave={() => setHovering(false)}
      className="relative overflow-hidden rounded-2xl bg-primary p-8 text-on-primary shadow-pop md:p-10"
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-secondary-fixed/25 blur-3xl"
        animate={{ x: [0, -28, 0], y: [0, 22, 0] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-primary/[0.09] blur-3xl"
        style={{ left: spotX, top: spotY }}
        animate={{ opacity: hovering && !reduce ? 1 : 0 }}
        transition={{ duration: 0.5 }}
      />

      <div className="relative z-10 flex flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-caption font-semibold tracking-wide text-on-primary/80">
            <span className="size-1.5 rounded-full bg-secondary-fixed" aria-hidden />
            今日焦点
          </span>
          <span className="inline-flex items-center gap-1 text-caption text-on-primary/60">
            <Timer className="size-3.5" aria-hidden />
            {focusedTask?.estimated_days ? `预计 ${focusedTask.estimated_days} 天` : '按你现在的节奏来'}
          </span>
        </div>

        <h2 className="max-w-3xl text-display text-on-primary">{action.text}</h2>

        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          {focusedTask && focusedTask.total_steps > 0 ? (
            <StepPath
              total={focusedTask.total_steps}
              done={focusedTask.done_steps}
              currentTitle={focusedTask.current_step_title}
            />
          ) : (
            <span />
          )}

          <div className="flex shrink-0 flex-col gap-2 md:items-end">
            <Button
              asChild
              variant="warm"
              size="lg"
              className="group bg-on-primary text-primary transition-transform hover:bg-surface-container active:scale-[0.98]"
            >
              <Link to={action.route}>
                {ctaLabel}
                <ArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </Button>
            <span className="text-caption text-on-primary/60">支持随时暂存，无打卡压力</span>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * 编号步骤路径：done 之前的步骤是浅桃勾，第 done+1 步是白色当前步（带脉冲环），之后是暗的待办。
 * 连线按已完成的进度填充到当前步。
 */
function StepPath({
  total,
  done,
  currentTitle,
}: {
  total: number
  done: number
  currentTitle: string | null | undefined
}) {
  const currentIndex = Math.min(done, total - 1)
  const fill = total > 1 ? currentIndex / (total - 1) : 0

  return (
    <div
      className="flex w-full min-w-0 max-w-lg flex-col gap-3.5"
      role="progressbar"
      aria-label="任务步骤进度"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <div className="relative flex items-center justify-between">
        <span aria-hidden className="absolute inset-x-3.5 top-1/2 h-px -translate-y-1/2 bg-on-primary/15" />
        <motion.span
          aria-hidden
          className="absolute inset-x-3.5 top-1/2 h-px -translate-y-1/2 origin-left bg-secondary-fixed"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: fill }}
          transition={{ duration: 0.9, delay: 0.5, ease: EASE }}
        />

        {Array.from({ length: total }, (_, index) => {
          const status = index < done ? 'done' : index === done ? 'current' : 'todo'
          return (
            <span key={index} className="relative flex size-7 items-center justify-center">
              {status === 'current' ? (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-on-primary/40"
                  animate={{ scale: [1, 1.9], opacity: [0.7, 0] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                />
              ) : null}
              <motion.span
                className={cn(
                  'relative flex size-7 items-center justify-center rounded-full text-caption font-semibold tabular-nums',
                  status === 'done' && 'bg-secondary-fixed text-on-secondary-fixed',
                  status === 'current' && 'bg-on-primary text-primary',
                  status === 'todo' && 'bg-primary text-on-primary/55 ring-1 ring-inset ring-on-primary/25',
                )}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.25 + index * 0.08 }}
              >
                {status === 'done' ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : index + 1}
              </motion.span>
            </span>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-3 text-caption text-on-primary/70">
        <span className="min-w-0 truncate">
          {currentTitle ? `当前停在：${currentTitle}` : '这一件事已经全部做完'}
        </span>
        <span className="shrink-0 tabular-nums">
          {done === 0 ? '还没开始' : `已完成 ${done}/${total} 步`}
        </span>
      </div>
    </div>
  )
}

/**
 * 今日一问（就地作答，不套卡片）。
 * 展开输入区时整段用 layout 动画平滑让位；提交走 POST /daily/answer（上限 200 字）。
 */
function DailyBand({
  questionId,
  question,
  answered,
  onAnswered,
}: {
  questionId: string | null
  question: string | null
  answered: boolean
  onAnswered: () => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /** 本次会话里刚提交过（服务端 answered 刷新回来之前先给即时反馈） */
  const [answeredHere, setAnsweredHere] = useState(false)
  const done = answered || answeredHere

  const canSubmit = Boolean(questionId) && text.trim().length > 0 && !submitting

  const submit = async () => {
    if (!questionId || !text.trim() || submitting) return
    setSubmitting(true)
    try {
      const updated = await dailyApi.answer({
        question_id: questionId,
        answer: text.trim().slice(0, 200),
      })
      setAnsweredHere(true)
      setOpen(false)
      setText('')
      onAnswered()
      toast.success(
        updated?.profile_refreshed ? '记下了，这条已经进你的画像' : '记下了，攒够 7 题我会更新画像',
      )
    } catch {
      toast.error('没记上，回答还留在输入框里')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.section layout className="flex flex-col gap-5 border-t border-outline-variant/40 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-caption tracking-wide text-on-surface-variant">今日一问 · 每天一题</span>
        <span className="flex items-center gap-1.5 text-caption text-on-surface-variant">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          你的回答只进你的私有画像，不做对错评判
        </span>
      </div>

      {question ? (
        <h2 className="max-w-3xl text-headline-lg font-semibold tracking-tight text-primary">「{question}」</h2>
      ) : (
        <p className="text-body-md text-on-surface-variant">今天的问题还在生成，先去和我说说最近在忙什么也行。</p>
      )}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="composer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="flex max-w-3xl flex-col gap-3 pb-1">
              <Textarea
                rows={2}
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={200}
                placeholder="写一句真实的念头，一句话也可以…"
                className="resize-none rounded-xl border-0 bg-surface-container-low px-4 py-3 text-body-md focus-visible:ring-0"
              />
              <div className="flex items-center justify-between">
                <span className="text-caption tabular-nums text-caption-foreground">{text.length}/200</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                  className={cn('font-semibold text-primary', canSubmit && 'ring-1 ring-primary/30')}
                >
                  {submitting ? '记录中…' : '记录到心迹'}
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((prev) => !prev)}
          className="h-9 gap-2 rounded-lg px-4 text-label-md font-medium"
        >
          {done && !open ? <DoneMark /> : <NotebookPen className="size-3.5" aria-hidden />}
          {open ? '收起' : done ? '今日已答' : '随手写一句'}
        </Button>
      </div>
    </motion.section>
  )
}

/** 已答的小勾：描边从无到有绘制 */
function DoneMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <motion.path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
      />
    </svg>
  )
}

/** 左列：AI 发现 —— 上方画像雷达（看形状）+ 下方发现信号条（看强度），文字退成一行注释 */
function FindingsPanel({
  findings,
  tags,
  tested,
  opening,
  onLetAiSpeak,
}: {
  findings: HomeAiFinding[]
  tags: HomeTag[]
  tested: boolean
  opening: boolean
  onLetAiSpeak: () => void
}) {
  // 信号条的归一化基准：取这批发现里最大的证据强度（至少 1，避免除零）
  const maxWeight = Math.max(1, ...findings.map((finding) => Number(finding.weight) || 0))
  // 六轴里至少有一块聊到过才画雷达；否则不留容器（避免一个空框占位）
  const hasWeights = hasEvidence(tags)

  return (
    <Panel className="flex-1 gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="size-[18px]" aria-hidden />
          <span className="text-headline-sm">AI 发现与画像动态</span>
        </div>
        <Link
          to="/profile"
          className="flex shrink-0 items-center gap-0.5 text-caption text-on-surface-variant transition-colors hover:text-primary"
        >
          探索轨迹全览
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      {hasWeights ? (
        <div className="rounded-lg bg-signal-soft p-3">
          <ProfileRadar tags={tags} compact tone="signal" />
        </div>
      ) : null}

      {findings.length ? (
        <div className="flex flex-col gap-4">
          {findings.map((finding, index) => {
            const source = tags.find(
              (tag) => tag.label === finding.pain_point || tag.label === finding.label,
            )?.source
            const sourceLabel = source ? TAG_SOURCE_LABEL[source] : null
            return (
              <motion.div
                key={finding.pain_point}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.45 + index * 0.1, ease: EASE }}
                className="flex flex-col gap-1"
              >
                <SignalBar
                  label={finding.label}
                  value={finding.weight}
                  max={maxWeight}
                  tone="signal"
                  meta={sourceLabel ?? undefined}
                />
                {finding.reason ? (
                  <p className="line-clamp-1 text-caption text-on-surface-variant">
                    {stripNoticePrefix(finding.reason)}
                  </p>
                ) : null}
              </motion.div>
            )
          })}
        </div>
      ) : (
        <EmptyState
          title="我还没看到你的卡点"
          description="让我先问你一句，你的回答会变成这里的第一条发现。"
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={opening} onClick={onLetAiSpeak}>
                {opening ? '正在让 AI 开口…' : '让 AI 先开口'}
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/chat">和 AI 聊聊</Link>
              </Button>
            </div>
          }
        />
      )}

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-lg bg-signal-soft px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5 text-on-surface-variant">
            <MessageSquare className="size-[18px] shrink-0 text-signal" aria-hidden />
            <span className="text-body-sm text-on-surface">想对上面的分析提出修正或聊聊困惑吗？</span>
          </div>
          <Button asChild variant="ghost" size="sm" className="shrink-0 text-primary">
            <Link to="/chat">
              聊一句
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
        {!tested ? (
          <p className="text-caption text-on-surface-variant">还没做过基础测评，做完之后这里的发现会更准。</p>
        ) : null}
      </div>
    </Panel>
  )
}

/** 右列：成长节律 + 其它任务，合在一张面板里，中间一根细线分开 */
function ProgressPanel({
  completedTasks,
  completedSteps,
  activeDays,
  activity,
  tasks,
  otherTasks,
  onLetAiSpeak,
}: {
  completedTasks: number
  completedSteps: number
  activeDays: number
  activity: HomeActivityPoint[]
  tasks: HomeOngoingTask[]
  otherTasks: HomeOngoingTask[]
  onLetAiSpeak: () => void
}) {
  return (
    <Panel className="flex-1 gap-6 p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-headline-sm text-primary">成长节律</span>
          <span className="text-caption text-on-surface-variant">按微步前进中</span>
        </div>

        {/* 这块浅底保持中性：它是"图表底"，2026-10-11 实拍时试过 settled-soft（极淡绿），
            结果整块发绿、同色系的蓝柱子反而糊在底里 —— 图表底不参与状态色。
            注意：`{cond ? (` 的**真分支位置不能放 JSX 注释**（会被当成对象字面量），所以这条写在外面。 */}
        {activity.length ? (
          <div className="flex flex-col gap-3 rounded-lg bg-surface-container-low p-3.5">
            <div className="flex items-baseline justify-between">
              <span className="text-caption text-on-surface-variant">近 14 天微步</span>
              {/* 这里不再放"今天 N 步"：琥珀柱 + 琥珀刻度（10/11）已经把"今天"说清楚了，
                  再来一行数字就是零信息标签（同一条纪律：宁可删掉，让图形自己说话）。 */}
            </div>
            <ActivityStrip data={activity} days={14} />
          </div>
        ) : null}

        <div className="grid grid-cols-3">
          {/* 三格的用色分工：探索数保持主墨（它是"量"），后两格是"已经累积到手的东西"，
              统一走克制绿；琥珀留给「今天」（活动柱），所以这一排不出现琥珀。 */}
          <Stat size="display" value={<CountUp value={completedTasks} />} label="完成小探索" />
          <Stat
            size="display"
            value={<CountUp value={completedSteps} />}
            label="累计微步"
            tone="settled"
            divided
          />
          <Stat
            size="display"
            value={<CountUp value={activeDays} />}
            unit="天"
            label="活跃天数"
            tone="settled"
          />
        </div>
      </div>

      <div className="h-px bg-outline-variant/40" aria-hidden />

      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-headline-sm text-primary">其它任务</span>
            {otherTasks.length ? (
              /* 绿底绿字第一版实拍发虚（浅绿底 + 绿字，"1"几乎看不出来）：底回到中性浅灰，
                 绿只落在数字上——状态色要么是底要么是字，不要同时是两者。 */
              <span className="rounded-full bg-surface-container px-2 py-0.5 text-caption font-medium tabular-nums text-settled">
                {otherTasks.length}
              </span>
            ) : null}
          </div>
          <Link to="/task" className="text-caption text-on-surface-variant transition-colors hover:text-primary">
            全部任务
          </Link>
        </div>

        {tasks.length === 0 ? (
          <EmptyState
            title="现在没有进行中的任务"
            description="任务要有对话结论才能生成，我先问你第一个问题。"
            action={
              <Button variant="outline" size="sm" onClick={onLetAiSpeak}>
                让 AI 先开口
              </Button>
            }
          />
        ) : otherTasks.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-settled-soft px-4 py-3 text-body-sm text-on-surface-variant">
            <Sparkles className="size-4 shrink-0 text-settled" aria-hidden />
            目前只有这一件在做，专注它就好。
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {otherTasks.slice(0, 2).map((task, index) => (
              <TaskRow key={task.id} task={task} index={index} />
            ))}
          </div>
        )}
      </div>

      <p className="mt-auto flex items-center justify-center gap-1.5 text-caption text-on-surface-variant">
        {/* 这句是"允许停下"的许可，用克制绿而不是灰：它是状态，不是说明文字 */}
        <Sparkles className="size-3.5 text-settled" aria-hidden />
        不用急着做完，今天的探索随时可以在满意时停下
      </p>
    </Panel>
  )
}

/** 数字从 0 计数到目标值（减少动态效果时直接显示终值） */
function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion()
  const count = useMotionValue(0)
  const rounded = useTransform(count, (latest) => Math.round(latest))

  useEffect(() => {
    const controls = animate(count, value, { duration: reduce ? 0 : 1, ease: EASE })
    return () => controls.stop()
  }, [count, value, reduce])

  return <motion.span className="tabular-nums">{rounded}</motion.span>
}

/** 「其它任务」的一行：左边环形进度（图形），右边文字压到最少 */
function TaskRow({ task, index }: { task: HomeOngoingTask; index: number }) {
  const percent = task.total_steps ? Math.round((task.done_steps / task.total_steps) * 100) : 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.7 + index * 0.08, ease: EASE }}
    >
      <Link
        to={toTaskDetail(task.id)}
        className="group -mx-3 flex items-center gap-4 rounded-lg px-3 py-3 transition-colors hover:bg-surface-container-low"
      >
        <StatRing
          done={task.done_steps}
          total={task.total_steps}
          label={`${percent}%`}
          size={60}
          stroke={6}
          /* 状态色：一步都没走的任务给克制红（一屏最多一处，这里靠 0/4 天然互斥），
             已经在走的给语义蓝；不等于"好/坏"，只是让"停着的那个"先被看见。 */
          tone={task.done_steps > 0 ? 'signal' : 'wait'}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <span className="block truncate text-body-md font-semibold text-primary">{task.title}</span>
          {task.current_step_title ? (
            <p className="truncate text-caption text-on-surface-variant">当前：{task.current_step_title}</p>
          ) : null}
          <div className="flex items-center gap-3 text-caption text-on-surface-variant">
            {task.estimated_days ? (
              <span className="flex items-center gap-1">
                <Timer className="size-3.5" aria-hidden />
                预计 {task.estimated_days} 天
              </span>
            ) : null}
            <span className="flex items-center gap-0.5 font-medium text-primary">
              {task.done_steps > 0 ? '继续' : '开始'}
              <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  )
}

/** 加载态：沿用 AIThinking 的阶段文案，骨架按真实版式排布，避免加载完成时整页跳动 */
function HomeSkeleton({ stage }: { stage: Stage }) {
  return (
    <div className="flex flex-col gap-10">
      <AIThinking stage={stage} lines={2} />
      <Skeleton className="h-72 rounded-2xl" />
      <Skeleton className="h-40 rounded-xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Skeleton className="h-80 rounded-xl lg:col-span-7" />
        <Skeleton className="h-80 rounded-xl lg:col-span-5" />
      </div>
    </div>
  )
}

/** 后端 reason 常以「AI 在对话里注意到：」开头，卡片上已有来源标签，这里去掉免得每条都重复 */
function stripNoticePrefix(text: string): string {
  return text.replace(/^AI 在对话里注意到[：:]\s*/, '')
}

function formatToday(): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(
    new Date(),
  )
}

/** 画像标签来源 → 给用户看的中文（取值见 backend schemas/home.py 的 source 说明） */
const TAG_SOURCE_LABEL: Record<string, string> = {
  chat: '来自对话',
  test: '来自基础测评',
  resume: '来自简历',
  interview: '来自模拟面试',
  daily: '来自每日一问',
  task: '来自成长任务',
}
