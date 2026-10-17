import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronDown, Flame, HelpCircle, History, Send, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Panel } from '@/components/Panel'
import { Reveal, staggerDelay } from '@/components/Motion'
import { Stat, StatGroup } from '@/components/StatGroup'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { dailyApi } from '@/api/daily'
import { SCORE_LABEL } from '@/constants/score'
import { useProfileStore } from '@/store/profileStore'
import type { DailyHistory, DailyHistoryItem, TodayQuestion } from '@/types'
import { parseServerTime } from '@/utils/format'
import { track } from '@/utils/track'
import { cn } from '@/lib/utils'

/** 后端 DailyAnswerRequest.answer 上限 200 字（参考稿写的 300 是它自己的设定，以本项目为准） */
const ANSWER_MAX = 200

/** 题目已不可用（脏数据）时后端给空串 —— 条目照常显示，只是题干给一句人话 */
const MISSING_CONTENT = '这道题的题干已经找不到了'
/** 极端脏数据：连回答都是空的（后端正常至少 1 字） */
const MISSING_ANSWER = '这条回答当时没存下文字。'

/** 答案长过这个字数就先折起来，点「查看展开」再看全文（纯前端展开，不改数据） */
const ANSWER_CLAMP_AT = 72

/**
 * 历史默认只铺最近这几条，其余收在「看全部」后面。
 * 展开是**同一页就地展开**，不是跳去另一个页面（折叠不等于藏数据）。
 */
const HISTORY_PREVIEW = 2

/**
 * 题库 dimension 现在有中文（兴趣 / 能力 / 技能 / 痛点 / 焦虑 / 认知），
 * 但早期种子数据用的是四个分数维度的英文 slug。界面**不允许**漏英文字段名：
 * 认识的 slug 映射成中文（复用 constants/score 的单一数据源），
 * 不认识的英文一律不显示，本来就是中文的原样透传。
 */
const DIMENSION_LABEL: Record<string, string> = {
  clarity: SCORE_LABEL.clarity_score,
  action: SCORE_LABEL.action_score,
  resume: SCORE_LABEL.resume_score,
  interest: '兴趣',
}

function dimensionLabel(value?: string | null): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  if (!/^[a-z_]+$/i.test(raw)) return raw
  return DIMENSION_LABEL[raw.toLowerCase()] ?? null
}

/**
 * 历史条目上的日期：今天 / 昨天 / 前天 + 具体月日（参考稿的「昨天 · 10月23日」）。
 * 时间戳在 api/daily.ts 已经补成带 Z 的 ISO，这里只管展示。
 */
function historyDate(iso: string): string {
  const date = parseServerTime(iso)
  if (!date) return '—'
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((dayStart(new Date()) - dayStart(date)) / 86_400_000)
  const monthDay = `${date.getMonth() + 1} 月 ${date.getDate()} 日`
  const withYear =
    date.getFullYear() === new Date().getFullYear()
      ? monthDay
      : `${date.getFullYear()} 年 ${monthDay}`
  if (diffDays === 0) return `今天 · ${withYear}`
  if (diffDays === 1) return `昨天 · ${withYear}`
  if (diffDays === 2) return `前天 · ${withYear}`
  return withYear
}

/**
 * 今日题目的选项 → 「轻松点提示」上的几颗 chip。
 *
 * 后端 daily_questions.options 存的是 {options: [{key,text,weight}, …]}（JSONB 原样，
 * 见 schemas/daily_question.py），home 那边才归一化成数组，这里自己收口：
 * 认 dict 包装、认裸数组、认纯字符串，认不出来就**不显示这一行**（绝不编提示语）。
 */
function optionTexts(raw: TodayQuestion['question']['options']): string[] {
  const bag = raw as unknown
  const list: unknown[] = Array.isArray(bag)
    ? bag
    : Array.isArray((bag as { options?: unknown })?.options)
      ? ((bag as { options: unknown[] }).options)
      : []
  return list
    .map((item) => {
      if (typeof item === 'string') return item
      const text = (item as { text?: unknown })?.text
      return typeof text === 'string' ? text : null
    })
    .filter((text): text is string => Boolean(text && text.trim()))
    .slice(0, 4)
}

/**
 * 每日一问（设计说明书 2.1 /daily、3.2 ① 模块①）
 *
 * 后端形状：GET /daily/today    -> { question: {id, dimension, content, options}, answered, answer, streak }
 *            POST /daily/answer -> body { question_id, answer }（**不是**路径参数）
 *            GET /daily/history -> { total, items: [{ id, question_id, content, dimension, answer, answered_at }] }
 * 回答成功后触发画像失效（4.2）。
 *
 * 历史是**只读列表**：顺序完全沿用后端（倒序），前端不排序、不翻页；
 * 拿不到历史只影响历史区（降级成空态），不影响上面那道今日问题。
 *
 * 版式（前端迭代 02，对齐首页 / 设计系统-页面规范.md）：
 * - 一屏一个主角：今天这一道是唯一带实心 CTA 的大卡，卡内左右两栏 ——
 *   左边是**那句人话**（题干 + 状态 + 连着写了几天），右边是唯一的行为区
 *   （提示 chip / 输入区 / 提交）。这样 1040px 的卡不再是一整行空白。
 * - 其余内容两列 7/5 支撑（左历史、右节奏），**不做**等高卡片一路堆下去。
 * - 两个状态分清：**未答**只给输入区与提交按钮；**已答**只回显自己写下的那句
 *   加**一句**人话反馈（同义的话只说一次），不再出现输入框与提交按钮。
 * - 字号按语义阶（页头由 PageShell / PageHeader 出；题目沿用首页今日一问的
 *   headline-lg、区块标题 headline-sm、正文 body-md、说明 body-sm、装饰 caption）。
 * - 历史默认只铺最近几条，其余用 ghost 的「看全部」**就地展开**（同样的条目，只是不再折起来）；
 *   卡底那一行同时收着「想接着聊聊」的真链接（不再孤悬在整页最底部居中）。
 *
 * 动效（统一动效语汇，只增不改）：
 * - 主角卡 `<Reveal lg>`（640ms）先上浮；两列支撑与历史行**错开起点**跟上
 *   （250 / 360 + staggerDelay(i) / 430ms），同一刻最多三处在动；
 *   历史行用 `<Reveal as="li">`，错峰只在开头几项上体现（staggerDelay 封顶）。
 * - 可点的 chip 加 `motion-lift` + `motion-press`，按钮加 `motion-press`。
 * - 这一页没有会变的数值条，所以不用 `grow-x`（不为动效而造一个）。
 *
 * 与参考稿**有意不同**（都是本项目没有的东西，不编）：
 * - 没有「换个题」按钮（后端没有换题接口，不做假入口）；那个位置放真实的
 *   「今天还没答 / 今天答过了」状态；
 * - 计数器写 200（后端上限就是 200 字），不写参考稿的 300；
 * - 历史卡底部不写「AI 当时提示：…」（历史条目里没有这个字段）；
 * - 主按钮文案用「记下这一句」而不是「发给 AI 聊聊」—— 这个动作是**存进画像**，
 *   不会立刻开一段对话；想聊在那张历史卡底部有一行真链接。
 */
export default function DailyPage() {
  const bumpVersion = useProfileStore((s) => s.bumpVersion)
  const [today, setToday] = useState<TodayQuestion | null>(null)
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  /** 历史单独一份状态：两个请求互不拖累 */
  const [history, setHistory] = useState<DailyHistory | null>(null)
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  /** 历史区是否已展开全部（默认只看最近几条） */
  const [historyOpen, setHistoryOpen] = useState(false)
  const answerRef = useRef<HTMLTextAreaElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await dailyApi.today()
      setToday(data ?? null)
      setAnswer(data?.answer ?? '')
    } catch {
      setToday(null)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * 历史拿不到（后端还没上线 / 网络失败 / 形状不对）→ 降级成空态。
   * 这里刻意不弹 toast：历史是页面的次要区块，报错不该盖住今天的问题。
   */
  const loadHistory = useCallback(async () => {
    setHistoryStatus('loading')
    try {
      setHistory(await dailyApi.history())
      setHistoryStatus('ready')
    } catch {
      setHistory(null)
      setHistoryStatus('failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const submit = async () => {
    if (!today?.question || !answer.trim()) return
    setSubmitting(true)
    try {
      const updated = await dailyApi.answer({
        question_id: today.question.id,
        answer: answer.trim().slice(0, ANSWER_MAX),
      })
      setToday({ ...today, answered: true, answer: updated?.answer ?? answer })
      track('daily_answer', { question_id: today.question.id })
      // 4.2：回答属于画像写操作
      bumpVersion()
      // 刚答的这条也要出现在历史里
      void loadHistory()
      toast.success(
        updated?.profile_refreshed ? '记下了，这条已经进你的画像' : '记下了，攒够 7 题我会更新画像',
      )
    } catch {
      toast.error('提交失败，回答还留在输入框里')
    } finally {
      setSubmitting(false)
    }
  }

  /** 空态里的「去答今天这一道」：把光标送回上面的输入框（已答时输入区不渲染，不会走到这） */
  const focusAnswer = () => {
    const el = answerRef.current
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus()
  }

  const items = history?.items ?? []
  /** 展开后顺序不变，只是把折起来的那几条一并铺出来 */
  const visibleItems = historyOpen ? items : items.slice(0, HISTORY_PREVIEW)
  const hiddenCount = items.length - visibleItems.length

  /**
   * 「你更常想什么」——把**已经载入的**历史按 dimension 归一下。
   *
   * 两个必须守住的口径：
   * 1. 数据只有载入的这一批（后端上限 100 条）。条数不足 `history.total` 时，
   *    卡片上必须写明"看的是最近 N 条"，不能拿局部冒充全部。
   * 2. 柱长按**最多的一维**归一（最高的那根满格），它读的是**分布形状**，不是打分 ——
   *    与首页 SignalBar 同一套口径。认不出的英文 slug（老数据）不进统计，也不显示。
   */
  const dimensionRows = (() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const label = dimensionLabel(item.dimension)
      if (!label) continue
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
  })()
  const dimensionScoped = (history?.total ?? 0) > items.length
  const truncated = Boolean(history && history.total > items.length)
  const options = today?.question ? optionTexts(today.question.options) : []

  return (
    <PageShell
      title="每日一问"
      badge={
        <Badge variant="secondary" className="rounded-full font-normal">
          轻量记录
        </Badge>
      }
      description="一天一句话，不用写小作文。"
      breadcrumb="每日一问"
    >
      {loading ? (
        <AIThinking text="正在取今天的问题…" lines={2} />
      ) : today?.question ? (
        /* ① 今天这一道：整页唯一的实心 CTA 就在这张卡里，左问题 / 右作答 */
        <Reveal lg>
          <Panel data-print="card" className="ai-inset gap-6 lg:flex-row lg:gap-8">
            {/* 左栏：那句人话本身（题干 / 状态 / 连着写了几天）。
                题干贴顶、连续记录贴底，让左右两栏的下沿齐平，卡片里不留半块空白 */}
            <div className="flex min-w-0 flex-col gap-4 lg:w-[42%] lg:shrink-0">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 text-caption font-semibold tracking-wide text-caption-foreground">
                    <span className="size-1.5 rounded-full bg-ai-accent" aria-hidden />
                    今日一问
                  </span>
                  <Badge variant="outline" className="rounded-full font-normal">
                    {today.answered ? '今天答过了' : '今天还没答'}
                  </Badge>
                </div>

                <p className="text-headline-lg text-primary">「{today.question.content}」</p>

                {/* 已答态**不再补一句**：右栏已经说了"它会一直留在这里"，
                    同义的话只说一句，左侧把位置让给题干本身（也不会留下空行） */}
                {today.answered ? null : (
                  <p className="text-body-sm text-on-surface-variant">
                    答不上来也没关系，写半句都行；它只进你自己的画像。
                  </p>
                )}
              </div>

              {today.streak > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-body-sm text-on-surface-variant lg:mt-auto">
                  <Flame className="size-3.5 text-warning" aria-hidden />
                  已经连着写了 {today.streak} 天
                </span>
              ) : null}
            </div>

            {/* 右栏：唯一的行动区。未答 = 输入 + 提交；已答 = 回显 + 一句人话 */}
            <div className="flex min-w-0 flex-1 flex-col gap-5 lg:justify-between">
              {today.answered ? (
                <div className="flex flex-col gap-3">
                  <Panel inset>
                    <p className="text-body-md break-words whitespace-pre-wrap text-on-surface">
                      {today.answer ?? answer}
                    </p>
                  </Panel>
                  <p className="text-body-md text-on-surface-variant">
                    说出来了，这本身就是一次梳理。它会一直留在这里。
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {/* 轻松点提示：题目自带的选项（真数据），点一下把这句话填进输入框，可再改 */}
                  {options.length ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-body-sm text-on-surface-variant">轻松点提示：</span>
                      {options.map((text) => (
                        <button
                          key={text}
                          type="button"
                          onClick={() => {
                            setAnswer(text)
                            answerRef.current?.focus()
                          }}
                          className="motion-lift motion-press rounded-full border border-border bg-card px-3 py-1 text-body-sm text-on-surface-variant hover:border-primary/40 hover:bg-primary-soft hover:text-on-surface"
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {/* 输入区：浅底块里放一张白底的 textarea（聚焦不换尺寸：只换 ring）。
                      计数跟着输入框走、贴在它右下角；主按钮单独一行，两者不再挤在一起 */}
                  <Panel inset>
                    <Textarea
                      ref={answerRef}
                      rows={3}
                      maxLength={ANSWER_MAX}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="想到什么就写什么，一句话也可以。不带修饰，只是当下的真实感受…"
                      className="min-h-[88px] resize-none border-0 bg-card text-body-md shadow-none focus-visible:bg-card focus-visible:ring-1 focus-visible:ring-primary/40"
                    />
                    {/* 计数器退到最淡：别用大黑字盯着用户 */}
                    <span className="self-end tabular-nums text-caption text-on-surface-variant">
                      {answer.length}/{ANSWER_MAX}
                    </span>
                  </Panel>

                  <div className="flex justify-end">
                    <Button
                      variant="warm"
                      size="lg"
                      onClick={() => void submit()}
                      disabled={submitting || !answer.trim()}
                      className="motion-press gap-1.5"
                    >
                      <Send className="size-4" />
                      {submitting ? '记下中…' : '记下这一句'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Panel>
        </Reveal>
      ) : (
        <EmptyState
          icon={<HelpCircle className="size-5" />}
          title="今天的问题还没准备好"
          description="每日一问接口暂时没返回内容，稍后再来看看。"
          action={
            <Button variant="warm" size="lg" className="motion-press" onClick={() => void load()}>
              重新加载
            </Button>
          }
        />
      )}

      {/* ② 两列 7/5 支撑：左历史（读的地方要宽），右节奏（一眼扫过的数字）。
          进场与主角卡错开起点（250 / 430ms），免得一屏同时四五处都在动 */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <Reveal fade delay={250} className="flex min-w-0 flex-col lg:col-span-7">
          <Panel data-print="card" className="gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex flex-wrap items-center gap-2 text-headline-sm text-primary">
                <History className="size-4 text-on-surface-variant" aria-hidden />
                你答过的题
                <span className="rounded-full bg-surface-container px-2 py-0.5 text-caption font-normal text-on-surface-variant">
                  回望与复盘
                </span>
              </h2>
              {items.length ? (
                <span className="text-body-sm text-on-surface-variant">共 {history?.total} 条</span>
              ) : null}
            </div>

            {historyStatus === 'loading' ? (
              <AIThinking text="正在翻你答过的题…" lines={2} />
            ) : historyStatus === 'failed' ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-body-md text-on-surface-variant">
                  你以前答过的题暂时没取到，不影响今天这一道。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="motion-press"
                  onClick={() => void loadHistory()}
                >
                  再试一次
                </Button>
              </div>
            ) : items.length === 0 ? (
              /* 空态说真话：还没有历史，就是第一道还没写 */
              <EmptyState
                icon={<History className="size-5" />}
                title="这会是你的第一道每日一问"
                description="把今天这一句写下来，它就留在这里；过一阵回头看，能看出自己在变。"
                action={
                  today?.question && !today.answered ? (
                    <Button variant="outline" size="sm" className="motion-press" onClick={focusAnswer}>
                      去答今天这一道
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="motion-press"
                      onClick={() => {
                        void load()
                        void loadHistory()
                      }}
                    >
                      重新加载
                    </Button>
                  )
                }
              />
            ) : (
              <>
                <ul className="flex flex-col">
                  {visibleItems.map((item, index) => (
                    <HistoryRow
                      key={(item.id || item.question_id || 'history') + '-' + index}
                      item={item}
                      index={index}
                    />
                  ))}
                </ul>

                {/* 展开与收起都落在同一页：展开后条目一条不少，只是不再折起来。
                    卡底只留这一行：左边是展开/收起（有折起来的才出现），右边是去聊天的
                    真链接 —— 它原来孤悬在整页最底部居中，现在收进这张卡里当卡内一行 */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-outline-variant/40 pt-3">
                  {hiddenCount > 0 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="motion-press -ml-3 gap-1.5 text-on-surface-variant"
                      onClick={() => setHistoryOpen(true)}
                    >
                      看全部 {items.length} 条
                      <ChevronDown className="size-3.5" aria-hidden />
                    </Button>
                  ) : historyOpen ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="motion-press -ml-3 gap-1.5 text-on-surface-variant"
                      onClick={() => setHistoryOpen(false)}
                    >
                      收起
                      <ChevronDown className="size-3.5 rotate-180" aria-hidden />
                    </Button>
                  ) : null}
                  <Link
                    to="/chat"
                    className="group ml-auto inline-flex items-center gap-1.5 text-body-sm text-on-surface-variant transition-colors hover:text-primary"
                  >
                    想接着聊聊？和 AI 说一句
                    <ArrowRight
                      className="size-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </div>

                {truncated ? (
                  <p className="text-body-sm text-on-surface-variant">
                    你一共答过 {history?.total} 题，这里只列出最近 {items.length} 题。
                  </p>
                ) : null}
              </>
            )}
          </Panel>
        </Reveal>

        <Reveal delay={430} className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <Panel data-print="card" className="gap-5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-headline-sm text-primary">你的记录节奏</span>
              <span className="text-caption text-on-surface-variant">不用天天写</span>
            </div>

            {historyStatus === 'ready' && history && history.total > 0 ? (
              /* 数字只在真拿到总数时出现：失败/加载中给一句人话，不拿 0 冒充 */
              <StatGroup columns={2}>
                <Stat value={today?.streak ?? 0} unit="天" label="连着写下来的" tone="settled" />
                <Stat value={history.total} unit="条" label="留在这里的话" tone="settled" divided />
              </StatGroup>
            ) : (
              <p className="text-body-md text-on-surface-variant">
                {historyStatus === 'loading'
                  ? '正在数你写过的话…'
                  : historyStatus === 'failed'
                    ? '以前写下的那些暂时没取到。'
                    : '还没有别的回答；今天这一道写完，它就会留在这里。'}
              </p>
            )}

            <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-ai-accent" aria-hidden />
              不是为了打卡：哪天不想写，跳过也算数。
            </p>
          </Panel>

          {/*
            第二张卡：把上面那些回答按「落在哪个维度」归一下。
            为什么要有它：右列只放一张矮卡时，下方会空出一大片（实测 ~200px 的死白），
            两列高度差直接摊在脸上。这里用**真数据**把余下高度接住，
            而不是靠 padding / 拉伸卡片硬撑。
          */}
          {dimensionRows.length ? (
            <Panel data-print="card" className="gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-headline-sm text-primary">你更常想什么</span>
                <span className="text-caption text-on-surface-variant">
                  {dimensionScoped ? `看的是最近 ${items.length} 条` : `一共 ${items.length} 条`}
                </span>
              </div>

              {/*
                用「标签 + 条数」的紧凑云，而不是一根根柱：
                这一列的高度要跟左边（历史列表）大致齐平，柱状行会把右列顶得比左列还高。
                分布形状交给数字读就够了 —— 条数最多的排前面。
                数字单独装一颗白底小药丸（并拉开 gap）：不然"行动 1"会读成"行动1"。
              */}
              <div className="flex flex-wrap gap-2">
                {dimensionRows.map((row, index) => (
                  <span
                    key={row.label}
                    className="rise-in inline-flex items-center gap-2 rounded-full bg-surface-container py-1 pr-1 pl-3 text-body-sm text-on-surface"
                    style={{ animationDelay: `${staggerDelay(index)}ms` }}
                  >
                    {row.label}
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-card px-1.5 text-caption tabular-nums text-on-surface-variant">
                      {row.count}
                    </span>
                  </span>
                ))}
              </div>
            </Panel>
          ) : null}
        </Reveal>
      </div>

    </PageShell>
  )
}

/**
 * 一条历史回答：日期 / 题目 / 回答三层，回答用左竖线引用块；
 * 长回答就地展开（纯前端，不改数据）。
 * 列表错峰只在开头几项上体现，靠 staggerDelay 封顶，免得最后一条等太久。
 */
function HistoryRow({ item, index }: { item: DailyHistoryItem; index: number }) {
  const [open, setOpen] = useState(false)
  const dimension = dimensionLabel(item.dimension)
  const text = item.answer.trim() || MISSING_ANSWER
  const long = text.length > ANSWER_CLAMP_AT

  return (
    <Reveal
      as="li"
      delay={360 + staggerDelay(index)}
      className="flex flex-col gap-2 border-t border-outline-variant/40 pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* 日期是**元信息**不是背景色装饰：用副墨而不是 caption 灰
            （caption 灰落在浅底上只有 4.3 左右，读起来吃力） */}
        <span className="text-body-sm text-on-surface-variant">
          {historyDate(item.answered_at)}
        </span>
        {dimension ? (
          <Badge variant="secondary" className="rounded-full font-normal">
            {dimension}
          </Badge>
        ) : null}
      </div>
      <p className="text-body-md font-medium text-on-surface">
        {item.content.trim() || MISSING_CONTENT}
      </p>
      {/* 回答用引用块：左侧细竖线 + 正文色（不再用临时底色/白色前景） */}
      <p
        className={cn(
          'border-l-2 border-outline-variant pl-3 text-body-md break-words whitespace-pre-wrap text-on-surface',
          long && !open && 'line-clamp-3',
        )}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="motion-press flex items-center gap-1 self-end text-body-sm text-on-surface-variant hover:text-primary"
        >
          {open ? '收起' : '查看展开'}
          <ChevronDown
            className={cn('size-3.5 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      ) : null}
    </Reveal>
  )
}
