import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Flame, HelpCircle, History, MessageSquare, Send, Sparkles, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Panel } from '@/components/Panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { dailyApi } from '@/api/daily'
import { SCORE_LABEL } from '@/constants/score'
import { useProfileStore } from '@/store/profileStore'
import type { DailyHistory, TodayQuestion } from '@/types'
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
 * 后端 `daily_questions.options` 存的是 `{"options": [{key,text,weight}, …]}`（JSONB 原样，
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
 * 版式（视觉参考稿 2026-10，配色/排版/文案照参考稿，形态按本项目真实字段）：
 * 大标题「每日一问」+「轻量记录」小标签；右上两条状态 chip（连续天数 / 已积累条数）；
 * 主卡 = TODAY'S REFLECTION 标签 + 放大题目 + 轻松提示 chip + 内嵌大输入区 +
 * 底部（提示语 + 计数 + 深色按钮）；下方「以前答过的题与心声」两张并排时光卡。
 *
 * 2026-10 收口（对齐首页 / 设计系统-页面规范.md）：
 * - 两个区块都换成 `components/Panel`（白卡 + 20px 内边距 + 极轻阴影，无可见描边）；
 * - 输入区用 `<Panel inset>` 浅底块 + 白底 textarea（替代旧的 `bg-muted/50` 套 `bg-card/80`）；
 * - 提交按钮升格为全页**唯一**主 CTA（`variant="warm" size="lg"`，h-11）；
 * - 历史回答改用**引用块**（左竖线 + 正文色），不再用 `bg-card/80 + text-secondary-foreground`
 *   （那在新 token 下是白字白底，对比度 1.0）；
 * - 字号按语义阶走（区块标题 16/600、题目 18/600、正文 14、说明 13、caption 12）。
 *
 * 与参考稿**有意不同**（都是本项目没有的东西，不编）：
 * - 没有「换个题」按钮（后端没有换题接口，不做假入口）；那个位置放真实的
 *   「今天还没答 / 今天答过了」状态；
 * - 计数器写 200（后端上限就是 200 字），不写参考稿的 300；
 * - 历史卡底部不写「AI 当时提示：…」（历史条目里没有这个字段）；
 * - 主按钮文案用「记下这一句」而不是「发给 AI 聊聊」—— 这个动作是**存进画像**，
 *   不会立刻开一段对话；想聊另有旁边那颗真链接「和 AI 聊聊」。
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
  /** 历史里哪些回答展开了（长回答默认折起来，点「查看展开」再看） */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
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

  /** 空态里的「去答今天这一道」：把光标送回上面的输入框 */
  const focusAnswer = () => {
    const el = answerRef.current
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus()
  }

  const items = history?.items ?? []
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
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {today && today.streak > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-body-sm text-on-surface-variant">
              <Flame className="size-3.5 text-warning" aria-hidden />
              连续记录 {today.streak} 天
            </span>
          ) : null}
          {history && history.total > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-body-sm text-on-surface-variant">
              <TrendingUp className="size-3.5 text-on-surface-variant" aria-hidden />
              已积累 {history.total} 条思考
            </span>
          ) : null}
        </div>
      }
    >
      {loading ? (
        <AIThinking text="正在取今天的问题…" lines={2} />
      ) : today?.question ? (
        /* ① 今天这一道：整页唯一的主角，也是唯一的实心按钮所在 */
        <Panel data-print="card" className="ai-inset gap-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex flex-wrap items-center gap-2 text-caption text-caption-foreground">
              <Sparkles className="size-3.5 text-ai-accent" aria-hidden />
              <span className="tracking-wide">TODAY&apos;S REFLECTION</span>
              <span aria-hidden>·</span>
              <span className="text-on-surface-variant">今日一问</span>
            </p>
            <Badge variant="outline" className="rounded-full font-normal">
              {today.answered ? '今天答过了' : '今天还没答'}
            </Badge>
          </div>

          <p className="text-headline-md text-primary">「{today.question.content}」</p>

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
                    className="rounded-full border border-border bg-card px-3 py-1 text-body-sm text-on-surface-variant transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-on-surface"
                  >
                    {text}
                  </button>
                ))}
              </div>
            ) : null}

            {/* 已答过的回显：写过的内容放在内嵌浅底块里（与输入区同一构件） */}
            {today.answered ? (
              <Panel inset className="px-4 py-3">
                <p className="text-body-md break-words whitespace-pre-wrap text-on-surface">
                  {today.answer ?? answer}
                </p>
              </Panel>
            ) : null}

            {/* 输入区：浅底块里放一张白底的 textarea（聚焦不变形：只换 ring，不改尺寸） */}
            <Panel inset className="p-3">
              <Textarea
                ref={answerRef}
                rows={3}
                maxLength={ANSWER_MAX}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="想到什么就写什么，一句话也可以。不带修饰，只是当下的真实感受…"
                className="min-h-[88px] resize-none border-0 bg-card text-body-md shadow-none focus-visible:bg-card focus-visible:ring-1 focus-visible:ring-primary/40"
              />
            </Panel>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
                <MessageSquare className="size-3.5 shrink-0" aria-hidden />
                答不上来也没关系，写半句都行，AI 会顺着你的想法往下聊。
                <Link to="/chat" className="text-primary hover:underline">
                  和 AI 聊聊 ›
                </Link>
              </span>
              <span className="flex items-center gap-3">
                {/* 计数器退到最淡：参考稿要求「弱化压迫感」（前面别用大黑字盯着用户） */}
                <span className="tabular-nums text-body-sm text-on-surface-variant/80">
                  {answer.length}/{ANSWER_MAX}
                </span>
                <Button
                  variant="warm"
                  size="lg"
                  onClick={() => void submit()}
                  disabled={submitting || !answer.trim()}
                  className="gap-1.5"
                >
                  <Send className="size-4" />
                  {submitting ? '记下中…' : today.answered ? '更新这一句' : '记下这一句'}
                </Button>
              </span>
            </div>
          </div>
        </Panel>
      ) : (
        <EmptyState
          icon={<HelpCircle className="size-5" />}
          title="今天的问题还没准备好"
          description="每日一问接口暂时没返回内容，稍后再来看看。"
          action={
            <Button variant="warm" size="lg" onClick={() => void load()}>
              重新加载
            </Button>
          }
        />
      )}

      {/* ② 以前答过的题与心声：一张白卡，里面是并排的浅底时光卡 */}
      <Panel data-print="card" className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex flex-wrap items-center gap-2 text-headline-sm text-primary">
            <History className="size-4 text-on-surface-variant" aria-hidden />
            以前答过的题与心声
            <span className="rounded-full bg-surface-container px-2 py-0.5 text-caption font-normal text-on-surface-variant">
              回望与复盘
            </span>
          </h2>
          {items.length ? (
            <span className="text-body-sm text-on-surface-variant">共 {history?.total} 条</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          {historyStatus === 'loading' ? (
            <AIThinking text="正在翻你答过的题…" lines={2} />
          ) : historyStatus === 'failed' ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-body-md text-on-surface-variant">
                你以前答过的题暂时没取到，不影响今天这一道。
              </p>
              <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
                再试一次
              </Button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<History className="size-5" />}
              title="还没有答过的题"
              description="你写下的每一句都会留在这里，过一阵回头看，能看出自己在变。"
              action={
                today?.question ? (
                  <Button variant="outline" onClick={focusAnswer}>
                    去答今天这一道
                  </Button>
                ) : (
                  <Button
                    variant="outline"
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
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((item, index) => {
                  const dimension = dimensionLabel(item.dimension)
                  const key = `${item.id || item.question_id || 'history'}-${index}`
                  const text = item.answer.trim() || MISSING_ANSWER
                  const long = text.length > ANSWER_CLAMP_AT
                  const isOpen = Boolean(expanded[key])
                  return (
                    /* 内嵌时光卡：浅底 + 圆角，两张并排；日期 / 题 / 回答三层分明 */
                    <div
                      key={key}
                      className="flex flex-col gap-2 rounded-lg bg-surface-container-low px-4 py-3.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {/* 日期是**元信息**不是背景色装饰：用副墨而不是 caption 灰
                            （#94a3b8 落在浅底时光卡上只有 2.3 对比度，读不出来） */}
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
                          long && !isOpen && 'line-clamp-3',
                        )}
                      >
                        {text}
                      </p>
                      {long ? (
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}
                          className="flex items-center gap-1 self-end text-body-sm text-on-surface-variant hover:text-primary"
                        >
                          {isOpen ? '收起' : '查看展开'}
                          <ChevronRight
                            className={isOpen ? 'size-3.5 rotate-90' : 'size-3.5'}
                            aria-hidden
                          />
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
              {truncated ? (
                <p className="text-body-sm text-on-surface-variant">
                  你一共答过 {history?.total} 题，这里只列出最近 {items.length} 题。
                </p>
              ) : null}
            </>
          )}
        </div>
      </Panel>
    </PageShell>
  )
}
