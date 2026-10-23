import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  CheckCircle2,
  Lightbulb,
  MessageSquare,
  Printer,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Reveal, staggerDelay } from '@/components/Motion'
import { Panel } from '@/components/Panel'
import { StageBadge } from '@/components/StageBadge'
import { Stat, StatGroup } from '@/components/StatGroup'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { reportApi } from '@/api/report'
import { taskApi } from '@/api/task'
import { STAGE_LABEL, normalizeStage } from '@/constants/stage'
import { toTaskDetail } from '@/constants/routes'
import { SCORE_ITEMS, SCORE_LABEL, formatScoreDelta } from '@/constants/score'
import { useStage } from '@/hooks/useStage'
import type { GrowthReportData } from '@/types'
import { formatDateTime, parseServerTime } from '@/utils/format'
import { cn } from '@/lib/utils'

/**
 * 成长报告（设计说明书 2.1 /report，T12 版式收口）
 *
 * 语义（未改动）：
 * - GET /report 每次实时计算，打开页面就是最新数据，不读旧快照。
 * - 「保存这一份」= POST /report/save，把当前状态 + 「我的补充」存成里程碑，成为下次对比基线。
 * - 「重新载入」只是重拉一次实时数据，不是"点了才更新"。
 * - 页面上不出现任何英文字段名，四个维度一律走 constants/score.ts 的中文 label。
 *
 * 版式（对标首页：一屏一个主角 + 两列 7/5）：
 * 1. 页头用 PageHeader（PageShell 内建），描述换成一句人话「这段时间你做了什么、离目标还有多远」；
 *    右上只留次按钮（打印 / 重新载入），实心主 CTA 让给主角卡；
 * 2. 主角：顶部一张大卡写一句结论，数字全部来自真实字段（completed_tasks / completed_steps），
 *    再加一句由三个维度里最低的那一项派生的实话，不编造；卡内是**全页唯一的进度条**
 *    （整体准备度）与**唯一的实心 CTA**（保存这一份）。整体准备度从「当前阶段」搬上来，
 *    避免同一个分数在屏上出现两次；
 * 3. 数字区走 StatGroup（3 列），赭金只给一个数字，标签用 body-sm；
 * 4. 「下一步」与「你做得好的」按 7/5 两列、**等高**（右卡用 stretch + h-full 补到左卡高度）；
 *    没有亮点的分区不开第二列；
 * 5. 「当前阶段」单独整行铺开，三条维度直接显示；与上一份基线的差值**并进同一行**
 *    （分数右侧的 `+8`），不再为同一组数字单开一张「与上一份报告相比」卡；
 *    综合得分的差值跟着主角卡里的「整体准备度」走，因为它本来就是同一个分数；
 * 6. 弱化动作退到页面末尾一行（和 AI 聊一句）。
 *
 * 动效（components/Motion 的 CSS 语汇，不新增 keyframes）：
 * 各区块按序 Reveal 进场，建议 / 亮点 / 对比项用 staggerDelay 错峰；可点处一律 motion-press；
 * 会变化的数值条（整体准备度 + 三个维度）用 grow-x。
 *
 * 有意的偏离（因为本项目没有那个东西，不造假）：
 * - 后端 /report 出参里没有「近 N 天活动」字段，也不为此新增接口调用，所以不做活动柱状图；
 *   数字区只呈现真实存在的三个累计值。
 * - 参考稿空态里的「查看历史模版」本项目没有，沿用已有的「保存这一份」，不做假入口。
 */

/** 保存时间的中文写法（今年的省略年份） */
function formatSavedAt(value: string): string {
  // 必须走 parseServerTime：后端时间戳是 naive UTC（没有 Z），
  // 直接 new Date(value) 会被当成本地时间解析，UTC+8 下会早 8 小时，跨零点还会差一天。
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
   * @param keepDraft 重新载入时为 true：不要把用户还没保存的草稿冲掉
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
    /*
     * 第一道闸：数据没到就**一个数字都不渲染**，只挂加载占位（AIThinking，复用现有组件）。
     * 所以「整体准备度 0 / 100」不是从这里来的 —— 它来自主角卡里那个从 0 数起的数字滚动，
     * 第二道闸在下面（分数直接渲染真值）。
     */
    return (
      <PageShell title="成长报告" breadcrumb="成长报告">
        <Reveal fade>
          <AIThinking text="正在汇总你这段时间的动作…" lines={4} />
        </Reveal>
      </PageShell>
    )
  }

  if (!report) {
    return (
      <PageShell title="成长报告" breadcrumb="成长报告">
        <Reveal fade>
          <EmptyState
            icon={<TrendingUp className="size-5" />}
            title="还没攒够数据，先把这一周的事做完"
            description="成长报告至少需要一段时间的打卡与对话记录。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void load('reload')}>
                  重新载入
                </Button>
                <Button variant="warm" size="lg" asChild>
                  <Link to="/task">去看看今天的任务</Link>
                </Button>
              </div>
            }
          />
        </Reveal>
      </PageShell>
    )
  }

  const stageLabel = report.stage_label ?? STAGE_LABEL[normalizeStage(report.stage ?? stage)]
  const savedAt = report.last_saved_at ? formatSavedAt(report.last_saved_at) : null
  const suggestions = report.suggestions ?? []
  const delta = report.score_delta ?? {}
  const clarity = Math.round(report.clarity_score)
  const overall = Math.round(report.total_score)
  const highlights = report.highlights ?? []

  // 三个维度里最低的一项：它离目标最远，先说它，这句真话由数据派生
  const dims = [
    { label: SCORE_LABEL.clarity_score, value: report.clarity_score },
    { label: SCORE_LABEL.action_score, value: report.action_score },
    { label: SCORE_LABEL.resume_score, value: report.resume_score },
  ]
  const weakest = dims.reduce((min, item) => (item.value < min.value ? item : min))

  const heroLine = buildConclusion(report.completed_tasks, report.completed_steps)
  const heroSupport = `离目标还差一段：三个维度里「${weakest.label}」最需要补，先动它见效最快。`

  const hasNext = suggestions.length > 0
  const hasHighlights = highlights.length > 0
  const twoCol = hasNext && hasHighlights
  const anyActionable = suggestions.some((item) => Boolean(item.pain_point))
  /** 综合得分的差值：它和主角卡的「整体准备度」是同一个分数，所以跟着那行走，不另开卡 */
  const totalDelta =
    hasBaseline && typeof delta.total_score === 'number' ? delta.total_score : null

  return (
    <PageShell
      title="成长报告"
      description="这段时间你做了什么、离目标还有多远，都汇在这一页；每次打开都是最新数据。"
      breadcrumb="成长报告"
      /* 右上只留次按钮：实心主 CTA 让给主角卡（存档当下、成为下次对比的基线）。 */
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="motion-press gap-1.5"
          >
            <Printer className="size-4" />
            浏览器打印
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleReload()}
            disabled={reloading}
            className="motion-press gap-1.5"
          >
            <RefreshCw className={cn('size-4', reloading && 'animate-spin')} />
            重新载入
          </Button>
        </div>
      }
    >
      {/* 主角：一句结论 + 全页唯一的进度条（整体准备度）+ 唯一的实心 CTA。
          整体准备度从「当前阶段」搬上来，同一个分数不在屏上出现两次。 */}
      <Reveal lg>
        <Panel data-print="card" className="gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-caption font-semibold tracking-wide text-on-surface-variant">
              <span className="size-1.5 rounded-full bg-secondary-fixed" aria-hidden />
              这一段的结论
            </span>
            <StageBadge stage={normalizeStage(report.stage ?? stage)} size="sm" />
          </div>

          <p className="max-w-3xl text-headline-lg text-primary">{heroLine}</p>
          <p className="max-w-[60ch] text-body-md text-on-surface-variant">{heroSupport}</p>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div className="flex flex-col gap-1">
                <span className="text-body-sm text-on-surface-variant">整体准备度</span>
                {/*
                 * 第二道闸：分数直接渲染真值，**不用 AnimatedNumber**。
                 * 它初始化是 `useState(reduce ? value : 0)` —— 数据明明已经到了（上面 `loading` 已经拦掉
                 * 没数据的渲染），它却先生成一个「整体准备度 0 / 100」再数到真实值，
                 * 用户看到的就是"我的准备度是 0"。0 不是真值就不许端出去
                 * （`overall` 来自已到手的 report，见上面的 `const overall = Math.round(report.total_score)`）。
                 * tabular-nums：数字等宽，值变了不跳宽（原来由 AnimatedNumber 内部加的那个类）。
                 */}
                <span className="flex items-baseline gap-1.5">
                  <span className="font-numeric text-display tabular-nums text-primary">{overall}</span>
                  <span className="text-body-md text-on-surface-variant">/ 100</span>
                </span>
              </div>
              {totalDelta !== null ? (
                /*
                 * 这一屏的主角是「变化」：差值单独一行，比正文大一档。
                 * 这里刻意不用 cn('text-headline-md', tone)：tailwind-merge 会把字号类
                 * 和 `text-settled` / `text-attention` 判成同一组（都是 text-*），后者赢、字号被丢掉。
                 * 用字符串拼接让两个类都留下。
                 */
                <span className="flex items-baseline gap-2 pb-1">
                  <span className="text-body-sm text-caption-foreground">较上次</span>
                  <span className={`text-headline-md tabular-nums ${deltaTone(totalDelta)}`}>
                    {formatScoreDelta(totalDelta)}
                  </span>
                </span>
              ) : null}
            </div>
            <div className="grow-x">
              <Progress
                value={overall}
                aria-label={'整体准备度 ' + overall + ' 分'}
                className="h-2 bg-surface-container"
              />
            </div>
          </div>

          {/* 一实一虚两个按钮一行；「上次保存于」退到卡底单独一行，不和按钮抢宽度 */}
          <div className="flex flex-col gap-2 border-t border-surface-container-low pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {/* 本页唯一实心按钮：把当下这一份存成基线（不会自动保存） */}
              <Button
                variant="warm"
                size="lg"
                onClick={() => void handleSave()}
                disabled={saving}
                className="motion-press gap-1.5"
              >
                {saving ? '保存中…' : '保存这一份'}
              </Button>
              <Button variant="outline" size="sm" asChild className="motion-press">
                <Link to="/task">去看看今天的任务</Link>
              </Button>
            </div>
            <span className="text-body-sm text-caption-foreground">
              {savedAt ? '上次保存于 ' + savedAt : '还没有保存过基线 · 本页每次打开都是最新数据'}
            </span>
          </div>
        </Panel>
      </Reveal>

      {/* 数字区：StatGroup 三列，赭金只给一个数字，标签走 body-sm */}
      <Reveal delay={110}>
        <Panel data-print="card" className="gap-3">
          <h2 className="text-headline-md text-primary">这段时间的节奏</h2>
          <StatGroup columns={3}>
            <Stat value={report.completed_tasks} unit="个" label="完成的小任务" accent />
            <Stat value={report.completed_steps} unit="步" label="走完的微步" divided />
            <Stat value={report.active_days} unit="天" label="有动静的天数" divided />
          </StatGroup>
          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ['tasks', report.completed_tasks],
                ['steps', report.completed_steps],
                ['days', report.active_days],
              ] as const
            ).map(([kind, value]) => (
              <p key={kind} className="text-body-sm text-on-surface-variant">
                {statCaption(kind, value)}
              </p>
            ))}
          </div>
        </Panel>
      </Reveal>

      {/* 下一步（7） + 你做得好的（5）：两卡等高、底边齐平（grid 默认 stretch + 卡 h-full）。
          右卡内容短：亮点列表 flex-1 在剩余高度里居中，空白不会全堆在卡底。
          ⚠️ 卡必须带 `w-full`：Reveal 这里是 `flex`（横向），卡是它的 flex item，
          沿主轴宽度按内容收缩（实测 562/286，右边到不了栏边）；w-full 才回到 7/5 满宽。 */}
      {hasNext || hasHighlights ? (
        <div className={cn('grid grid-cols-1 gap-6', twoCol && 'lg:grid-cols-12')}>
          {hasNext ? (
            <Reveal delay={220} className={cn('flex', twoCol && 'lg:col-span-7')}>
              <Panel data-print="card" className="ai-inset h-full w-full gap-4">
                <div className="flex items-center gap-2">
                  <Lightbulb className="size-[18px] text-primary" aria-hidden />
                  <h2 className="text-headline-md text-primary">下一步</h2>
                </div>
                <p className="text-body-md text-on-surface-variant">
                  {anyActionable
                    ? '你现在的方向清晰度是 ' +
                      clarity +
                      ' 分；点「去做」我会把建议拆成能当天做完的小步。'
                    : '你现在的方向清晰度是 ' + clarity + ' 分，这几条是我读你的记录得到的下一步。'}
                </p>
                <ul className="flex flex-col gap-2">
                  {suggestions.map((item, i) => (
                    <Reveal
                      as="li"
                      key={i}
                      fade
                      delay={220 + staggerDelay(i)}
                      className="flex items-start gap-3 rounded-lg bg-surface-container-low px-3.5 py-3"
                    >
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-on-surface-variant" aria-hidden />
                      <span className="flex-1 text-body-md text-primary">{item.text}</span>
                      {/* pain_point 为 null 的建议没有可生成的痛点，不显示按钮，也不发空请求 */}
                      {item.pain_point ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="motion-press shrink-0"
                          disabled={generatingIndex !== null}
                          onClick={() => void handleGenerateTask(i, item.pain_point as string)}
                        >
                          {generatingIndex === i ? '生成中…' : '去做'}
                        </Button>
                      ) : null}
                    </Reveal>
                  ))}
                </ul>
              </Panel>
            </Reveal>
          ) : null}

          {hasHighlights ? (
            <Reveal delay={320} className={cn('flex', twoCol && 'lg:col-span-5')}>
              <Panel data-print="card" className="h-full w-full gap-3">
                <h2 className="text-headline-md text-primary">你做得好的</h2>
                {/* flex-1 + justify-center：亮点只有一两条时，列表在卡内剩余高度里居中，
                    而不是留一大块空白压在卡底（标题仍在最上方，两卡首行基线不变） */}
                <ul className="flex flex-1 flex-col justify-center gap-2">
                  {highlights.map((item, i) => (
                    <Reveal
                      as="li"
                      key={i}
                      fade
                      delay={320 + staggerDelay(i)}
                      className="flex gap-2 text-body-md text-on-surface-variant"
                    >
                      <span aria-hidden>·</span>
                      <span>{item}</span>
                    </Reveal>
                  ))}
                </ul>
              </Panel>
            </Reveal>
          ) : null}
        </div>
      ) : null}

      {/* 当前阶段：整行铺开。与上一份基线的差值**并进同一行**（分数右边的 +8），
          同一组数字不再占两张卡；没有基线时右侧留空，不加任何说明卡。 */}
      <Reveal delay={400}>
        <Panel data-print="card" className="gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex flex-col gap-1">
              <h2 className="text-headline-md text-primary">当前阶段</h2>
              <p className="text-body-sm text-on-surface-variant">
                {stageLabel} · {report.stage_changed ? '这一周期阶段发生变化了' : '阶段保持稳定'}
              </p>
            </div>
            {/* 只留一行小字说明右边的 +x 是什么，不再用一整张卡解释 */}
            {hasBaseline ? (
              <span className="shrink-0 text-body-sm text-caption-foreground">较上次保存</span>
            ) : null}
          </div>
          <div className="flex flex-col gap-3">
            {SCORE_ITEMS.map((item, i) => {
              const value = report[item.key] ?? 0
              const change = delta[item.key]
              return (
                <div key={item.key} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-body-sm text-on-surface-variant">
                    {item.label}
                  </span>
                  {/* 会变化的数值条：进场时从左长出来，三条错开 130ms，读成一段而不是三处同时动 */}
                  <div className="grow-x flex-1" style={{ animationDelay: i * 130 + 'ms' }}>
                    <Progress value={value} className="h-1.5 bg-surface-container" />
                  </div>
                  {/*
                   * 分数 + 差值拼成一组、按基线对齐：右对齐的是差值那一列，
                   * 所以三行的 `68`、`54`、`41` 在同一竖线上，`+8` / `+12` 也在同一竖线上。
                   * 没有基线时这组只留分数宽度（w-8），不让右边空出一块。
                   */}
                  <span
                    className={cn(
                      'flex shrink-0 items-baseline justify-end gap-2',
                      hasBaseline ? 'w-[4.5rem]' : 'w-8',
                    )}
                  >
                    <span className="tabular-nums text-body-sm text-primary">
                      {Math.round(value)}
                    </span>
                    {hasBaseline ? (
                      /* 字符串拼接（不用 cn）：tailwind-merge 会把字号类当成颜色类丢掉 */
                      <span
                        className={`w-8 shrink-0 text-right tabular-nums text-body-sm ${
                          typeof change === 'number' ? deltaTone(change) : ''
                        }`}
                      >
                        {typeof change === 'number' ? formatScoreDelta(change) : null}
                      </span>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        </Panel>
      </Reveal>

      {/* 我的补充：用户唯一能写的地方（分数由行为算出，不给任何改分入口） */}
      <Reveal delay={610}>
        <Panel data-print="card" className="gap-3">
          <h2 className="text-headline-md text-primary">我的补充</h2>
          <p className="text-body-sm text-on-surface-variant">
            写点你自己想记的：这段时间的感受、卡住的地方、下一步打算。写好后点上面的「保存这一份」，它会跟这份报告一起存下来。
          </p>
          <Textarea
            className="mt-1"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            rows={4}
            placeholder="比如：这周投了 3 家没回音，简历里项目那块我还想再改改。"
          />
          {/* 只在真有未保存修改时给一行提示；「已经保存过了」这类日志式状态不再占位 */}
          <div
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-1',
              dirty ? 'justify-between' : 'justify-end',
            )}
          >
            {dirty ? (
              <span className="text-body-sm text-secondary">
                有未保存的修改，记得点上面的「保存这一份」
              </span>
            ) : null}
            <span className="tabular-nums text-caption text-caption-foreground">{note.length}/500</span>
          </div>
        </Panel>
      </Reveal>

      {/* 弱化动作退到页面底部一行 */}
      <Reveal delay={680}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="motion-press gap-1.5">
            <Link to="/chat">
              <MessageSquare className="size-3.5" aria-hidden />
              读着有想说的？和我聊一句
            </Link>
          </Button>
        </div>
      </Reveal>
    </PageShell>
  )
}

/**
 * 分差的语义色（方案 A：只从 token 取）。
 *
 * 涨 = 克制绿 --settled；跌 = 注意红 --attention；没变 = 次要墨色。
 * 共享的 `scoreDeltaTone` 仍映射到旧的 --destructive 与 --success，
 * 新色板下红色应为 --attention；这里先在本页落新色，等共享层统一后可删掉本函数。
 */
function deltaTone(value: number): string {
  const rounded = Math.round(value)
  if (rounded > 0) return 'text-settled'
  if (rounded < 0) return 'text-attention'
  return 'text-on-surface-variant'
}

/**
 * 主角卡的那一句结论：只用真实字段拼，不编造。
 * 有任务 / 有微步就说出来；一件都没有时给一句真话的零值开场（不是套用有数据的文案）。
 */
function buildConclusion(tasks: number, steps: number): string {
  const bits: string[] = []
  if (tasks > 0) bits.push(`完成了 ${tasks} 个小任务`)
  if (steps > 0) bits.push(`走完了 ${steps} 步微步`)
  if (!bits.length) return '这一段还没有动作记录，做一件小事，这里就会亮起来。'
  return `这段时间你${bits.join('、')}，往前走了一小段。`
}

/**
 * 统计数字下面那行小字。
 *
 * 参考稿写死的是「待开启第一项微行动」「本周规划累计进展」「连续探索，保持步调」——
 * 那是零值场景的话。数字大于 0 时再这么说就是假话，所以按数字派生、且不重复上面的数字。
 */
function statCaption(kind: 'tasks' | 'steps' | 'days', value: number): string {
  if (kind === 'tasks') {
    return value === 0 ? '还没有完成的记录，挑一件今天就做得完的' : '每完成一件，简历就厚一点'
  }
  if (kind === 'steps') {
    return value === 0 ? '还没有微步记录，动一下就出现在这' : '微步是当天能走完的那一档'
  }
  return value === 0 ? '还没有活跃记录，来了就会记下' : '来过、动过，都会算进节奏'
}
