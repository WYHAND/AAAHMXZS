import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Printer, RefreshCw, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { StageBadge } from '@/components/StageBadge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
            className="gap-1.5"
          >
            {saving ? '保存中…' : '保存这一份'}
          </Button>
        </div>
      }
    >
      <Card data-print="card">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">当前阶段</CardTitle>
            <CardDescription>
              {stageLabel} · {report.stage_changed ? '这一周期阶段发生变化了' : '阶段保持稳定'}
            </CardDescription>
          </div>
          <StageBadge stage={normalizeStage(report.stage ?? stage)} showStepper />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-numeric text-4xl font-semibold text-foreground">
              {Math.round(report.total_score)}
            </span>
            <span className="text-sm text-muted-foreground">/ 100 综合分</span>
          </div>

          <div className="flex flex-col gap-3">
            {SCORE_ITEMS.map((item) => {
              const value = report[item.key] ?? 0
              const change = delta[item.key]
              return (
                <div key={item.key} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">
                    {item.label}
                  </span>
                  <Progress value={value} className="h-1.5 flex-1" />
                  <span className="w-10 shrink-0 text-right font-numeric text-sm text-foreground">
                    {Math.round(value)}
                  </span>
                  {hasBaseline && typeof change === 'number' ? (
                    <span
                      className={cn(
                        'w-12 shrink-0 text-right font-numeric text-xs',
                        scoreDeltaTone(change),
                      )}
                    >
                      {formatScoreDelta(change)}
                    </span>
                  ) : (
                    <span className="w-12 shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="完成任务" value={report.completed_tasks} unit="个" />
        <StatCard label="完成步骤" value={report.completed_steps} unit="步" />
        <StatCard label="活跃天数" value={report.active_days} unit="天" />
      </div>

      {/* 与上一份报告相比：没有基线时**不显示**一排 +0（那是误导） */}
      <Card data-print="card">
        <CardHeader>
          <CardTitle className="text-base">与上一份报告相比</CardTitle>
          <CardDescription>
            {hasBaseline && savedAt ? `对比的是 ${savedAt} 保存的那一份` : '保存一份后，这里会显示你的变化'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasBaseline ? (
            <div className="flex flex-wrap gap-3">
              {SCORE_COMPARE_ITEMS.map((item) => {
                const change = delta[item.key] ?? 0
                return (
                  <div key={item.key} className="flex min-w-28 flex-col rounded-lg border px-3 py-2">
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                    <span
                      className={cn(
                        'font-numeric text-lg',
                        scoreDeltaTone(change),
                      )}
                    >
                      {formatScoreDelta(change)}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              还没有可对比的基线。保存一份报告后，这里会显示你的变化。
            </p>
          )}
        </CardContent>
      </Card>

      {report.highlights?.length ? (
        <Card data-print="card">
          <CardHeader>
            <CardTitle className="text-base">本周期亮点</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {report.highlights.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {suggestions.length ? (
        <Card data-print="card" className="ai-inset">
          <CardHeader>
            <CardTitle className="text-base text-accent-foreground">下一步建议</CardTitle>
            <CardDescription className="text-accent-foreground/80">
              点「去做」我会把它拆成能当天做完的小步
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3 text-sm text-accent-foreground/90">
              {suggestions.map((item, i) => {
                const painPoint = item.pain_point
                return (
                  <li key={i} className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 gap-2">
                      <span aria-hidden>·</span>
                      <span>{item.text}</span>
                    </span>
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
          </CardContent>
        </Card>
      ) : null}

      {/* 我的补充：用户唯一能写的地方（分数由行为算出，不给任何改分入口） */}
      <Card data-print="card">
        <CardHeader>
          <CardTitle className="text-base">我的补充</CardTitle>
          <CardDescription>
            写点你自己想记的：这段时间的感受、卡住的地方、下一步打算。写好后点右上角「保存这一份」，它会跟这份报告一起存下来。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={4}
            placeholder="比如：这周投了 3 家没回音，简历里项目那块我还想再改改。"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-numeric text-xs text-muted-foreground">
              {note.length}/500
            </span>
            {dirty ? (
              <span className="text-xs text-warning">
                有未保存的修改，记得点右上角「保存这一份」
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                {report.saved ? '这段补充已经跟报告一起保存过了' : '还没保存过，保存后会成为下次对比的基线'}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  )
}

function StatCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <Card data-print="card">
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="font-numeric text-3xl font-semibold text-foreground">{value}</span>
        <span className="ml-2 text-sm text-muted-foreground">{unit}</span>
      </CardContent>
    </Card>
  )
}
