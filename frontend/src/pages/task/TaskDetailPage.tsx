import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, ListChecks, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Reveal } from '@/components/Motion'
import { Panel } from '@/components/Panel'
import { StepList } from '@/components/StepList'
import { TaskAbandonDialog } from '@/components/TaskAbandonDialog'
import { TaskDeleteDialog } from '@/components/TaskDeleteDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { PageShell } from '@/components/PageShell'
import { ONGOING_STATUS, taskProgress, useTaskStore } from '@/store/taskStore'
import type { TaskStep } from '@/types'
import { toResourceLink } from '@/utils/resourceLink'
import { cn } from '@/lib/utils'

/** 打卡表单选项：全部是"点一下"就能答完的，不需要用户组织语言 */
const STEP_PROGRESS = ['做完了', '做了一半', '还没开始'] as const
const STEP_FEELING = ['顺利', '有点卡', '卡住了'] as const

/** 打卡表单里的单选按钮组（沿用答题页的选中样式，保持全站一致） */
function ChoiceRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly string[]
  value: string
  onChange: (next: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = value === option
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={cn(
                'motion-press rounded-lg px-3.5 py-1.5 text-body-md transition-colors',
                selected
                  ? 'bg-primary-soft text-primary ring-1 ring-primary/30'
                  : 'bg-surface-container-low text-on-surface hover:bg-surface-container',
              )}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 任务详情与打卡（设计说明书 3.2 ③）
 *
 * 版式（2026-10 前端迭代 02，2026-10-22 方案 A 收口）：
 * - 页头走 PageShell，**任务名只在页头出现一次**（页面标题）；主角卡不再重复整句任务名。
 * - 主角卡 = 这一屏的主角「当前这一步 + 主按钮」：步骤名 24px 立起来，说明 15px，
 *   唯一的实心 CTA「完成这一步」贴在同一块右侧；进度条（全页唯一的赭金）退到下面，
 *   和「已完成 n/m 步」＋一句进度人话并排成一行 14px 读数；
 * - 步骤列表**放在主角卡下方**（左 7 列），右侧 5 列只放「为什么值得做」＋「关联痛点」，
 *   没有这句价值说明时步骤列表自己铺满，不留一个空列；两列等高（grid 默认 stretch），
 *   两卡的标题都只留一个 h2（24px）：左卡「还剩 n 步没走」是结论句，右卡「为什么值得做」
 *   本身就是栏目名 —— 比"一边 eyebrow 一边 h2"少一层、两卡标题基线自然对齐；
 * - 放弃 / 删除退到页面最下方一行，平时中性字、悬停才泛红，与主内容拉开距离；
 *   二次确认仍走 TaskAbandonDialog / TaskDeleteDialog（与列表页共用，逻辑一个字没改）。
 *
 * 动效（统一语汇，只增不改）：主角卡 / 两列 / 页脚分三段上浮进场；
 * 进度条 grow-x 从左长出来；主 CTA、资源链、页脚动作加 motion-press。不写 keyframes。
 *
 * 打卡弹窗：这一步做到哪了 / 卡在哪 —— 后端只有一个 feedback 字段，
 * 前端把两栏拼成一段文本提交。
 */
export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { activeTask: task, steps, loading, error, fetchTask, completeStep } = useTaskStore()

  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [checkInOpen, setCheckInOpen] = useState(false)
  // 打卡改成「做题/填表」：两个单选 + 一个可选短填空。
  // 产品决策：**不要求用户写小作文**（写长文本是留存杀手，尤其对低主动性用户）。
  const [stepProgress, setStepProgress] = useState<string>(STEP_PROGRESS[0])
  const [stepFeeling, setStepFeeling] = useState<string>(STEP_FEELING[0])
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  /** 二次确认弹窗（放弃 / 删除）的开关 */
  const [abandonOpen, setAbandonOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    if (id) void fetchTask(id)
  }, [id, fetchTask])

  // 默认选中第一个未完成的步骤
  useEffect(() => {
    if (activeStepId == null && steps.length) {
      const current = steps.find((s) => !s.completed) ?? steps[0]
      setActiveStepId(current.id)
    }
  }, [activeStepId, steps])

  const activeStep: TaskStep | undefined = useMemo(
    () => steps.find((s) => s.id === activeStepId),
    [activeStepId, steps],
  )

  // 后端的 resource 存的是**搜索关键词**（Prompt 明确禁止编造 URL），
  // 不能直接当 href 用（会跳到本站 404）。这里翻译成对应平台的搜索页。
  const resourceLink = useMemo(() => toResourceLink(activeStep?.resource), [activeStep])

  if (loading && !task) {
    return (
      <PageShell title="任务详情" breadcrumb="成长任务">
        <Reveal fade>
          <AIThinking text="正在把这个任务读出来…" lines={3} />
        </Reveal>
      </PageShell>
    )
  }

  if (!task) {
    return (
      <PageShell title="任务详情" breadcrumb="成长任务">
        <Reveal fade>
          <EmptyState
            icon={<ListChecks className="size-5" />}
            title="这个任务现在打不开"
            description={error ?? '可能它已经被删掉了，或者这个链接不对。'}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (id) void fetchTask(id)
                  }}
                >
                  再试一次
                </Button>
                <Button variant="warm" size="lg" className="motion-press" asChild>
                  <Link to="/task">回到成长任务</Link>
                </Button>
              </div>
            }
          />
        </Reveal>
      </PageShell>
    )
  }

  const handleCheckIn = async () => {
    if (!id || !activeStep) return
    setSubmitting(true)
    // 后端 TaskStepCompleteRequest 只有一个 feedback 字段：
    // 把「做题式」的答案合成一句结构化文本（不是让用户写作文，是我们自己拼）
    const feedback = [`进度：${stepProgress}`, `感受：${stepFeeling}`, note.trim() ? `补充：${note.trim()}` : '']
      .filter(Boolean)
      .join(' · ')
    const ok = await completeStep(id, activeStep.id, feedback)
    setSubmitting(false)
    if (ok) {
      setCheckInOpen(false)
      setNote('')
      toast.success('打卡成功，首页和画像已同步更新')
    } else {
      toast.error('打卡失败，请稍后再试')
    }
  }

  const percent = taskProgress(task)
  const total = steps.length
  const doneSteps = steps.filter((s) => s.completed).length
  const canAbandon = task.status === ONGOING_STATUS

  return (
    <PageShell
      title={task.title}
      badge={
        <Badge variant="outline" className="rounded-full font-normal text-caption">
          {task.status}
        </Badge>
      }
      description={task.description ?? undefined}
      breadcrumb="成长任务"
      actions={
        <Button variant="ghost" size="sm" asChild className="motion-press gap-1.5">
          <Link to="/task">
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>
      }
    >
      {/* 主角卡：这一页唯一的进度条与唯一的实心 CTA 都在这里，首屏就能看到。
          一屏一个主角 = 「当前这一步 + 主按钮」：步骤名抬到 24px 立起来，
          进度条（全页唯一的赭金）退到它下面当读数。
          内边距比普通卡大一档（p-6 / p-8）：靠留白把它从下面的步骤清单里托起来。 */}
      <Reveal lg>
        <Panel data-print="card" className="gap-6 p-6 md:p-8">
          {/* 顶部一行：身份标签（墨点，不进赭金）+ 成本读数 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-caption tracking-wide text-caption-foreground">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              你正在做的这一件
            </span>
            {task.difficulty || task.estimated_days ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-on-surface-variant">
                {task.difficulty ? (
                  <span>
                    难度 <span className="font-medium text-primary">{task.difficulty}</span>
                  </span>
                ) : null}
                {task.difficulty && task.estimated_days ? <Dot /> : null}
                {task.estimated_days ? (
                  <span>
                    预计 <span className="font-medium text-primary">{task.estimated_days}</span> 天
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>

          {/* 当前步与主 CTA：这一屏的主角。步骤名是卡内的结论句（20 → 24 抬一档，
              压过下面的进度读数），说明留在 15px，按钮是唯一的实心块；
              点主按钮走打卡弹窗（行为一个字没改） */}
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-8">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {activeStep ? (
                <>
                  <span className="text-caption tracking-wide text-caption-foreground">
                    现在做 · 第 {activeStep.step_order} 步
                  </span>
                  <h2 className="text-headline-lg text-balance text-primary">{activeStep.title}</h2>
                  {activeStep.action ? (
                    <p className="max-w-[52ch] text-body-md text-on-surface">{activeStep.action}</p>
                  ) : (
                    <p className="max-w-[52ch] text-body-md text-on-surface-variant">
                      这一步没有额外说明，按标题做就行，做完打个卡。
                    </p>
                  )}
                  {resourceLink ? (
                    <a
                      href={resourceLink.href}
                      target="_blank"
                      rel="noreferrer"
                      className="motion-press mt-0.5 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-body-sm text-primary hover:bg-surface-container-high"
                    >
                      <span className="min-w-0 break-words">{resourceLink.label}</span>
                      <ExternalLink className="size-3.5 shrink-0" />
                    </a>
                  ) : null}
                </>
              ) : (
                <p className="text-body-md text-on-surface-variant">
                  步骤还在生成中，先看看上面的任务说明。
                </p>
              )}
            </div>

            {activeStep ? (
              <div className="flex shrink-0 flex-col gap-2 md:items-end">
                <Button
                  variant="warm"
                  size="lg"
                  className="motion-press w-full md:w-auto"
                  onClick={() => setCheckInOpen(true)}
                  disabled={activeStep.completed}
                >
                  {activeStep.completed ? '这一步已完成' : '完成这一步'}
                </Button>
                {/* 只在"这一步已完成"时才需要一句指路；这句是承载信息的，不能落到 13px */}
                {activeStep.completed ? (
                  <span className="max-w-[30ch] text-body-sm text-on-surface-variant">
                    在下面点一个还没开始的步骤，就能继续。
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 进度：全页唯一的一处赭金（细条）。步数读数与那句人话并排，都在 14px 这一档 */}
          <div className="flex flex-col gap-2 border-t border-outline-variant/40 pt-5">
            <Progress
              value={percent}
              aria-label={'已完成 ' + percent + '%'}
              className="grow-x h-1.5 bg-surface-container [&>[data-slot=progress-indicator]]:bg-secondary"
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-body-sm text-on-surface-variant">
              <span className="tabular-nums">
                {total ? (
                  <>
                    已完成 <span className="font-medium text-primary">{doneSteps}</span>/{total} 步
                  </>
                ) : (
                  '步骤还在拆解，很快就能开始'
                )}
              </span>
              {total ? <span className="min-w-0">{heroLine(doneSteps, total)}</span> : null}
            </div>
          </div>

          {/* 「关联痛点」不在这里：它解释的是"为什么值得做"，已随价值说明移到右卡，
              主角卡底部只留进度这一行，不额外撑高 */}
        </Panel>
      </Reveal>

      {/* 步骤列表（左 7）与「为什么值得做」（右 5）；没有价值说明时步骤铺满，不留空列。
          这里不用 items-start：默认 stretch 让两卡等高、底边齐平 */}
      <Reveal delay={290}>
        <div className={cn('grid gap-6', task.value_note ? 'lg:grid-cols-12' : undefined)}>
          <Panel data-print="card" className={cn('gap-4', task.value_note ? 'lg:col-span-7' : undefined)}>
            {/* 标题只留一个 h2（与右卡同一档 24px）；"任务步骤"这个栏目名不再单占一行 eyebrow */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="min-w-0 text-headline-md text-primary">
                {total
                  ? doneSteps >= total
                    ? '这一步一步都走完了'
                    : `还剩 ${total - doneSteps} 步没走`
                  : '步骤还在拆解'}
              </h2>
              {total ? (
                <span className="shrink-0 text-body-sm tabular-nums text-on-surface-variant">
                  共 {total} 步
                </span>
              ) : null}
            </div>

            {total ? (
              /* 完成态样式统一由 StepList 提供（2026-10-18 已去掉那里的删除线，
                 改成"勾 + 降一档颜色"），页面不再就地覆盖。 */
              <StepList
                steps={steps}
                activeStepId={activeStepId}
                onSelect={(step) => setActiveStepId(step.id)}
              />
            ) : (
              <p className="text-body-sm text-on-surface-variant">步骤还在生成中，稍后刷新看看。</p>
            )}
          </Panel>

          {task.value_note ? (
            /* 与左卡等高（gap-6 是最小间距）：
               - h2「为什么值得做」是栏目名本身，和左卡结论句同一档，两卡首行基线对齐；
               - 价值说明与「关联痛点」chip 用 justify-between 把剩余空白**均分**，
                 短文案时不会把两百多像素全堆在卡底。
               痛点从主角卡搬来：它回答的是"为什么值得做"，不是当前进度。 */
            <Panel data-print="card" className="h-full justify-between gap-6 lg:col-span-5">
              <h2 className="text-headline-md text-primary">为什么值得做</h2>
              <p className="text-body-lg text-on-surface">{task.value_note}</p>
              {task.pain_point ? (
                <div>
                  {/* 中性浅底 chip（与列表页同一写法），赭金留给主角卡的进度条 */}
                  <span className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full bg-surface-inset px-3 py-1 text-body-sm text-on-surface-variant">
                    <Tag className="size-3.5 shrink-0" aria-hidden />
                    关联痛点：{task.pain_point}
                  </span>
                </div>
              ) : null}
            </Panel>
          ) : null}
        </div>
      </Reveal>

      {/* 放弃 / 删除：破坏性动作退到页面最下方、与主内容拉开距离；平时是中性字，
          只在悬停时泛红（attention 是"真正的错误/危险"色，不做常驻的红字）。
          二次确认仍与列表页共用同一套弹窗 */}
      <Reveal delay={650} className="mt-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {canAbandon ? (
            <Button
              variant="ghost"
              size="sm"
              className="motion-press px-0 text-body-sm text-on-surface-variant hover:bg-transparent hover:text-attention"
              onClick={() => setAbandonOpen(true)}
            >
              放弃这个任务
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="motion-press gap-1 px-0 text-body-sm text-on-surface-variant hover:bg-transparent hover:text-attention"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-3.5" />
            删除这个任务
          </Button>
        </div>
      </Reveal>

      <TaskAbandonDialog
        task={abandonOpen ? task : null}
        onOpenChange={(open) => setAbandonOpen(open)}
        onAbandoned={() => navigate('/task')}
      />
      <TaskDeleteDialog
        task={deleteOpen ? task : null}
        onOpenChange={(open) => setDeleteOpen(open)}
        onDeleted={() => navigate('/task')}
      />

      {/* 打卡弹窗：做题式表单（点选为主，最多 30 字可选补充），不让用户写小作文 */}
      <Dialog open={checkInOpen} onOpenChange={setCheckInOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>记录这一步</DialogTitle>
            <DialogDescription>
              点两下就好，不用写字。（最后那一栏可留空）
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <ChoiceRow
              label="这一步做到哪了？"
              options={STEP_PROGRESS}
              value={stepProgress}
              onChange={setStepProgress}
            />
            <ChoiceRow
              label="做得顺利吗？"
              options={STEP_FEELING}
              value={stepFeeling}
              onChange={setStepFeeling}
            />
            <div className="flex flex-col gap-2">
              <Label htmlFor="note">想补充一句？（选填，最多 30 字）</Label>
              <Input
                id="note"
                maxLength={30}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="比如：找不到教程"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInOpen(false)}>
              取消
            </Button>
            <Button variant="warm" className="motion-press" onClick={() => void handleCheckIn()} disabled={submitting}>
              {submitting ? '提交中…' : '提交打卡'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}

/** 一行元信息里的分隔点 */
function Dot() {
  return (
    <span className="text-caption-foreground" aria-hidden>
      ·
    </span>
  )
}

/**
 * 把「走了多少步」翻译成一句人话（只说真实的步数，不编进度）。
 * 标题已经回答"做什么"，主角卡上这句是"走到哪了、还差多少"。
 */
function heroLine(doneSteps: number, total: number): string {
  if (!total) return '这一步一步的清单还在拆，很快就能开始。'
  const left = total - doneSteps
  if (doneSteps <= 0) return '从第 1 步开始，做完打个卡就算走了一步。'
  if (left <= 0) return '这个任务已经全部做完，可以回看走过的路了。'
  if (left === 1) return '就差最后 1 步了，一鼓作气。'
  if (doneSteps * 2 < total) return '刚开了个头，把手上这一步做完就顺了。'
  return '已经走了一半多，还剩 ' + left + ' 步。'
}
