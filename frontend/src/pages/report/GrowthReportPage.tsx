import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronDown, Lightbulb, Printer, RefreshCw, RotateCcw, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Panel } from '@/components/Panel'
import { StageBadge } from '@/components/StageBadge'
import { Stat, StatGroup } from '@/components/StatGroup'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { reportApi } from '@/api/report'
import { taskApi } from '@/api/task'
import { STAGE_LABEL, normalizeStage } from '@/constants/stage'
import { toTaskDetail } from '@/constants/routes'
import {
  SCORE_ITEMS,
  SCORE_COMPARE_ITEMS,
  formatScoreDelta,
  scoreDeltaTone,
} from '@/constants/score'
import { useStage } from '@/hooks/useStage'
import type { GrowthReportData } from '@/types'
import { formatDateTime, parseServerTime } from '@/utils/format'
import { cn } from '@/lib/utils'

/**
 * 成长报告（设计说明书 2.1 /report，M3）
 *
 * 语义（本次改造）：
 * - GET /report **每次实时计算** —— 打开页面就是最新数据，不再读数据库里的旧快照。
 * - 「保存这一份」= POST /report/save，把当前状态 + 「我的补充」存成一份**里程碑**，
 *   成为「与上一份报告相比」的基线；不点保存就不会落库。
 * - 「重新载入」只是重新拉一次实时数据，**不是**"点了才更新"。
 * - 页面上**不允许出现任何英文字段名**：四个维度一律走 constants/score.ts 的中文 label。
 *
 * 版式（视觉参考稿 2026-10，只取配色/排版/文案风格，形态仍按本项目的真实数据与功能）：
 * - 「当前阶段」一张卡：左边综合分、右边三条维度条；**三条维度条与 +x 默认收起**
 *   （Collapsible「看分数明细」）—— 原来一打开就是"四条进度条 + 四个 +8/+12/+5"的报表脸；
 * - 三个统计数字走 StatGroup + Stat（数字 24/700、标签 12px，单位与 statCaption 原样保留）；
 * - AI 阶段建议**提到统计面板之前**（它是这一页真正能推着人往下走的东西，
 *   不是排在第二屏的补充说明）。
 *
 * ⚠️ 与参考稿的两处**有意偏离**（都是因为本项目没有那个东西，不造假）：
 * 1. 参考稿空态里有个「查看历史模版」按钮 —— 本项目**没有**报告历史功能
 *    （无路由、无接口），所以那个位置放**已有的「保存这一份」**，与旁边那句
 *    「点击右上角「保存这一份」记录当下起点」说的是同一件事；
 * 2. 参考稿把三个统计数字下面写死成「待开启第一项微行动」等文案 —— 那是**零值场景**的
 *    话。本项目里这几个数字会随用户行为变化，所以只在真的为 0 时用参考稿文案，
 *    大于 0 时改成由数字派生的实话（见 statCaption）。
 */

/** 保存时间的中文写法（今年的省略年份） */
function formatSavedAt(value: string): string {
  // 必须走 parseServerTime：后端时间戳是 **naive UTC**（没有 Z），
  // 直接 new Date(value) 会被当成本地时间解析 —— UTC+8 下会早 8 小时，
  // 跨零点还会差一天（`saved_at` 是 report_service 用 utcnow() 写的）。
  const date = parseServerTime(value)
  if (!date) return formatDateTime(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthDay = `${date.getMonth() + 1} 月 ${date.getDate()} 日`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return sameYear ? `${monthDay} ${time}` : `${date.getFullYear()} 年 ${monthDay} ${time}`
}

export default function GrowthReportPage() {
  const navigate = useNavigate()
  const { stage } = useStage()
  const [report, setReport] = useState<GrowthReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [saving, setSaving] = useState(false)
  /** 正在生成任务的建议下标（同时只允许一条，避免连点生成多个任务） */
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null)
  /** 「我的补充」草稿（只提交给 /report/save，不自动保存） */
  const [note, setNote] = useState('')
  /** 服务端已保存的补充内容，用来判断有没有未保存的修改 */
  const [savedNote, setSavedNote] = useState('')
  /** setNote 的函数式更新里要拿"上一次保存的值"做比较，用 ref 避免闭包读到旧 state */
  const savedNoteRef = useRef('')

  /**
   * @param keepDraft 重新载入时为 true：**不要**把用户还没保存的草稿冲掉
   */
  const apply = useCallback((next: GrowthReportData | null, keepDraft = false) => {
    const serverNote = next?.user_note ?? ''
    setReport(next)
    setNote((current) => (keepDraft && current !== savedNoteRef.current ? current : serverNote))
    savedNoteRef.current = serverNote
    setSavedNote(serverNote)
  }, [])

  const load = useCallback(
    async (mode: 'initial' | 'reload' = 'initial') => {
      if (mode === 'reload') setReloading(true)
      else setLoading(true)
      try {
        apply(await reportApi.current(), mode === 'reload')
      } catch {
        // 错误提示由 api/client.ts 的统一拦截器给出
        apply(null)
      } finally {
        setLoading(false)
        setReloading(false)
      }
    },
    [apply],
  )

  useEffect(() => {
    void load()
  }, [load])

  const dirty = note !== savedNote
  const hasBaseline = Boolean(report?.saved && report?.last_saved_at)

  // 有未保存内容时离开页面给浏览器原生提醒，避免白写
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const handleReload = async () => {
    await load('reload')
    toast.success('已重新载入最新数据')
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const updated = await reportApi.save({ user_note: note })
      if (updated) {
        apply(updated)
        toast.success('已保存这一份，它会成为下次对比的基线')
      } else {
        toast.error('没读到保存结果，稍后重试一下')
      }
    } catch {
      // 统一拦截器已经 toast 过错误文案，这里不再重复
    } finally {
      setSaving(false)
    }
  }

  /** 建议 → 生成成长任务 → 跳到任务详情页（命中的已有任务同样跳过去） */
  const handleGenerateTask = async (index: number, painPoint: string) => {
    if (generatingIndex !== null) return
    setGeneratingIndex(index)
    try {
      const task = await taskApi.generate({ pain_point: painPoint })
      if (!task?.id) {
        toast.error('没生成出来，先和我聊聊你的卡点')
        return
      }
      // 判定只看 reused（不匹配文案）：true = 服务端有同题任务，没有新建
      if (task.reused === true) {
        toast.info('已经有一个类似的任务了，直接带你去看它')
      } else {
        toast.success('给你拆成了几步，去做第一步吧')
      }
      navigate(toTaskDetail(task.id))
    } catch {
      // 统一拦截器已经 toast 过错误文案
    } finally {
      setGeneratingIndex(null)
    }
  }

  if (loading) {
    return (
      <PageShell title="成长报告" breadcrumb="成长报告">
        <AIThinking text="正在汇总你这段时间的动作…" lines={4} />
      </PageShell>
    )
  }

  if (!report) {
    return (
      <PageShell title="成长报告" breadcrumb="成长报告">
        <EmptyState
          icon={<TrendingUp className="size-5" />}
          title="还没攒够数据，先把这一周的事做完"
          description="成长报告至少需要一段时间的打卡与对话记录。"
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void load('reload')}>
                重新载入
              </Button>
              <Button variant="warm" asChild>
                <Link to="/task">去看看今天的任务</Link>
              </Button>
            </div>
          }
        />
      </PageShell>
    )
  }

  const stageLabel = report.stage_label ?? STAGE_LABEL[normalizeStage(report.stage ?? stage)]
  const savedAt = report.last_saved_at ? formatSavedAt(report.last_saved_at) : null
  const suggestions = report.suggestions ?? []
  const delta = report.score_delta ?? {}
  const clarity = Math.round(report.clarity_score)

  return (
    <PageShell
      title="成长报告"
      description={
        savedAt
          ? `上次保存于 ${savedAt} · 本页每次打开都是最新数据`
          : '还没有保存过基线 · 本页每次打开都是最新数据'
      }
      breadcrumb="成长报告"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="size-4" />
            浏览器打印
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleReload()}
            disabled={reloading}
            className="gap-1.5"
          >
            <RefreshCw className={cn('size-4', reloading && 'animate-spin')} />
            重新载入
          </Button>
          {/* 本页唯一实心按钮：保存里程碑（不会自动保存） */}
          <Button
            variant="warm"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving}
            className="gap-1.5 rounded-lg"
          >
            {saving ? '保存中…' : '保存这一份'}
          </Button>
        </div>
      }
    >
      {/* ① 当前阶段：综合分 + StageBadge；三条维度条与 +x 收进「看分数明细」（默认收起） */}
      <Panel data-print="card" className="gap-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-headline-sm text-primary">当前阶段</h2>
            <p className="text-body-sm text-on-surface-variant">
              {stageLabel} · {report.stage_changed ? '这一周期阶段发生变化了' : '阶段保持稳定'}
            </p>
          </div>
          <StageBadge stage={normalizeStage(report.stage ?? stage)} size="sm" />
        </div>

        {/*
          综合分：48px → 32px。它是个参考值，这一屏的主角是紧随其后的 AI 建议。
          三条维度条与相比基线的 +x 一起收进「看分数明细」（默认收起）——
          中文 label 全部来自 constants/score.ts，一个都没少，只是不再一打开就铺在脸上。
        */}
        <Collapsible className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-numeric text-[32px] font-semibold leading-none text-primary">
                {Math.round(report.total_score)}
              </span>
              <span className="text-body-sm text-on-surface-variant">/ 100 综合分</span>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="group gap-1 text-on-surface-variant">
                看分数明细
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <div className="flex flex-col gap-3">
              {SCORE_ITEMS.map((item) => {
                const value = report[item.key] ?? 0
                const change = delta[item.key]
                return (
                  <div key={item.key} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-body-sm text-on-surface-variant">
                      {item.label}
                    </span>
                    <Progress value={value} className="h-1.5 flex-1 bg-surface-container" />
                    <span className="w-8 shrink-0 text-right font-numeric text-body-sm text-primary">
                      {Math.round(value)}
                    </span>
                    {hasBaseline && typeof change === 'number' ? (
                      <span
                        className={cn(
                          'w-10 shrink-0 text-right font-numeric text-caption',
                          scoreDeltaTone(change),
                        )}
                      >
                        {formatScoreDelta(change)}
                      </span>
                    ) : (
                      <span className="w-10 shrink-0" />
                    )}
                  </div>
                )
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </Panel>

      {/* ② AI 阶段建议：这一屏真正能推着人往下走的东西，提到统计面板之前 */}
      {suggestions.length ? (
        <Panel data-print="card" className="ai-inset gap-3 bg-surface-container-low">
          <div className="flex items-center gap-2">
            <Lightbulb className="size-4 text-secondary" aria-hidden />
            <h2 className="text-headline-sm text-secondary">AI 阶段建议</h2>
          </div>
          <p className="text-body-md text-primary">
            你现在的方向清晰度是 {clarity} 分；点「去做」我会把建议拆成能当天做完的小步。
          </p>
          <ul className="flex flex-col gap-2">
            {suggestions.map((item, i) => {
              const painPoint = item.pain_point
              return (
                <li key={i} className="flex items-start gap-3 rounded-lg bg-card px-3 py-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-secondary" aria-hidden />
                  <span className="flex-1 text-body-md text-primary">{item.text}</span>
                  {/* pain_point 为 null 的建议没有可生成的痛点，不显示按钮，也不发空请求 */}
                  {painPoint ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={generatingIndex !== null}
                      onClick={() => void handleGenerateTask(i, painPoint)}
                    >
                      {generatingIndex === i ? '生成中…' : '去做'}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Panel>
      ) : null}

      {/* ③ 三个统计数字：StatGroup + Stat（数字 24/700 等宽），单位与 caption 原样保留 */}
      <Panel data-print="card" className="gap-3">
        <h2 className="text-headline-sm text-primary">这段时间的节奏</h2>
        <StatGroup columns={3}>
          <Stat value={report.completed_tasks} unit="个" label="完成任务" accent />
          <Stat
            value={report.completed_steps}
            unit="步"
            label="完成步骤"
            divided
            className="space-y-0.5"
          />
          <Stat
            value={report.active_days}
            unit="天"
            label="活跃天数"
            divided
            className="space-y-0.5"
          />
        </StatGroup>
        {/* statCaption 的三句真话：0 与非 0 说法不同，抽到下面小字里，一个都没丢 */}
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ['tasks', report.completed_tasks],
              ['steps', report.completed_steps],
              ['days', report.active_days],
            ] as const
          ).map(([kind, value]) => (
            <p key={kind} className="text-caption text-on-surface-variant">
              {statCaption(kind, value)}
            </p>
          ))}
        </div>
      </Panel>

      {/* ④ 与上一份报告相比：基线对比卡（含"尚未归档任何基线报告"空态，逻辑不动） */}
      <Panel data-print="card" className="gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-headline-sm text-primary">与上一份报告相比</h2>
          <span className="shrink-0 pt-1 text-caption text-caption-foreground">基线对比</span>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          保存一份后，这里会清晰显示你的方向、行动与简历完整度带来的具体变化。
        </p>
        {hasBaseline ? (
          <div className="flex flex-wrap gap-3">
            {SCORE_COMPARE_ITEMS.map((item) => {
              const change = delta[item.key] ?? 0
              return (
                <div
                  key={item.key}
                  className="flex min-w-28 flex-col gap-0.5 rounded-lg bg-surface-container-low px-3 py-2"
                >
                  <span className="text-caption text-on-surface-variant">{item.label}</span>
                  <span className={cn('font-numeric text-headline-sm', scoreDeltaTone(change))}>
                    {formatScoreDelta(change)}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-container-low px-3 py-3">
            <RotateCcw className="size-4 shrink-0 text-on-surface-variant" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-body-md text-primary">尚未归档任何基线报告</span>
              <span className="text-caption text-on-surface-variant">
                点击右上角「保存这一份」记录当下起点
              </span>
            </div>
            {/* 参考稿这里放的是「查看历史模版」；本项目没有报告历史功能，
                所以放**已有的**保存动作，不做假入口 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving}
              className="shrink-0"
            >
              {saving ? '保存中…' : '保存这一份'}
            </Button>
          </div>
        )}
      </Panel>

      {report.highlights?.length ? (
        <Panel data-print="card" className="gap-3">
          <h2 className="text-headline-sm text-primary">本周期亮点</h2>
          <ul className="flex flex-col gap-2">
            {report.highlights.map((item, i) => (
              <li key={i} className="flex gap-2 text-body-md text-on-surface-variant">
                <span aria-hidden>·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* 我的补充：用户唯一能写的地方（分数由行为算出，不给任何改分入口） */}
      <Panel data-print="card" className="gap-2">
        <h2 className="text-headline-sm text-primary">我的补充</h2>
        <p className="text-body-sm text-on-surface-variant">
          写点你自己想记的：这段时间的感受、卡住的地方、下一步打算。写好后点右上角「保存这一份」，它会跟这份报告一起存下来。
        </p>
        <Textarea
          className="mt-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          rows={4}
          placeholder="比如：这周投了 3 家没回音，简历里项目那块我还想再改改。"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="tabular-nums text-caption text-caption-foreground">
            {note.length}/500
          </span>
          {dirty ? (
            <span className="text-body-sm text-warning">
              有未保存的修改，记得点右上角「保存这一份」
            </span>
          ) : (
            <span className="text-body-sm text-on-surface-variant">
              {report.saved ? '这段补充已经跟报告一起保存过了' : '还没保存过，保存后会成为下次对比的基线'}
            </span>
          )}
        </div>
      </Panel>
    </PageShell>
  )
}

/**
 * 统计数字下面那行小字。
 *
 * 参考稿写死的是「待开启第一项微行动」「本周规划累计进展」「连续探索，保持步调」——
 * 那是**零值场景**的话。数字大于 0 时再这么说就是假话，所以按数字派生。
 */
function statCaption(kind: 'tasks' | 'steps' | 'days', value: number): string {
  if (kind === 'tasks') return value === 0 ? '待开启第一项微行动' : `已完成 ${value} 个，保持节奏`
  if (kind === 'steps') return value === 0 ? '本周规划累计进展' : `本周已累计 ${value} 步`
  return value === 0 ? '今天就能开始，做一件小事' : '连续探索，保持步调'
}
