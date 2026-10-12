import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, ListChecks, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState } from '@/components/EmptyState'
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
import { Skeleton } from '@/components/ui/skeleton'
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
                'rounded-lg px-3.5 py-1.5 text-body-md transition-colors',
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
 * 版式（2026-10 收口）：**首屏必须能看到「打卡」** —— 主体是 `lg:grid-cols-12` 两列，
 * 左 7 列步骤时间线、右 5 列「当前步行动指引 + 打卡主按钮」；窄屏单列时顺序为
 * 概览 → 当前步指引 + 打卡 → 步骤列表。
 *
 * - 顶部概览压成一条（难度 / 预计天数 / 已完成 x/y 步 + 琥珀进度条），不再是一张
 *   "任务概览"卡里再套一层内嵌进度面板；
 * - 每一步有「行动指引 (action) + 资源链接 (resource)」，step.feedback 附在该步下方
 *   （StepList 内），所以这里不再单独开一块"上次打卡反馈"；
 * - 打卡弹窗：这一步做到哪了 / 卡在哪 —— 后端只有一个 feedback 字段，
 *   前端把两栏拼成一段文本提交；
 * - 放弃 / 删除：底部合成一行 caption 级 ghost 动作，二次确认仍走
 *   TaskAbandonDialog / TaskDeleteDialog（与列表页共用，逻辑一个字没改）。
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
        <Skeleton className="h-48 rounded-xl" />
      </PageShell>
    )
  }

  if (!task) {
    return (
      <PageShell title="任务详情" breadcrumb="成长任务">
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title="这个任务打不开了"
          description={error ?? '可能已经被删除，或链接不对。'}
          action={
            <Button variant="warm" asChild>
              <Link to="/task">回到任务列表</Link>
            </Button>
          }
        />
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
  const canAbandon = task.status === ONGOING_STATUS
  const doneSteps = steps.filter((s) => s.completed).length

  return (
    <PageShell
      title={task.title}
      badge={
        <Badge variant="outline" className="rounded-full font-normal">
          {task.status}
        </Badge>
      }
      description={task.pain_point ? `关联痛点：${task.pain_point}` : undefined}
      breadcrumb="成长任务"
      actions={
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link to="/task">
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* 概览：压成一条（窄屏第 1 屏位） */}
        <Panel data-print="card" className="gap-3 lg:col-span-12">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-body-sm text-on-surface-variant">已完成的部分</span>
              <span className="text-body-md text-primary">
                <span className="font-numeric text-headline-lg font-semibold">{percent}%</span>
                <span className="ml-2 text-body-sm text-on-surface-variant">
                  {progressHint(percent)}
                </span>
              </span>
            </div>
            <Progress
              value={percent}
              className="h-1.5 bg-surface-container [&>[data-slot=progress-indicator]]:bg-secondary"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-md">
            {task.difficulty ? (
              <span className="text-on-surface-variant">
                难度 <span className="font-medium text-primary">{task.difficulty}</span>
              </span>
            ) : null}
            {task.difficulty && task.estimated_days ? <Dot /> : null}
            {task.estimated_days ? (
              <span className="text-on-surface-variant">
                预计 <span className="font-medium text-primary">{task.estimated_days}</span> 天
              </span>
            ) : null}
            {task.difficulty || task.estimated_days ? <Dot /> : null}
            <span className="text-on-surface-variant">
              已完成 <span className="font-medium text-primary">{doneSteps}</span>/
              {steps.length || '—'} 步
            </span>
          </div>

          {task.description ? (
            <p className="text-body-sm text-on-surface-variant">{task.description}</p>
          ) : null}
        </Panel>

        {/*
         * 右侧（窄屏第 2 屏位）：当前步的行动指引 + 打卡主按钮。
         * 桌面上 sticky 贴住内容顶部，打卡永远在首屏。
         */}
        {activeStep ? (
          <div
            data-print="card"
            className="self-start lg:order-3 lg:col-span-5 lg:sticky lg:top-[calc(var(--spacing-shell)+1rem)]"
          >
            <Panel className="gap-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-body-sm text-on-surface-variant">
                    第 {activeStep.step_order} 步 · {activeStep.completed ? '已完成' : '待完成'}
                  </span>
                  <span className="text-headline-sm text-primary">{activeStep.title}</span>
                </div>
              </div>

              {/* 行动指引：卡内浅底块 */}
              <Panel inset className="text-body-md text-on-surface-variant">
                {activeStep.action ? (
                  <p className="whitespace-pre-wrap leading-relaxed">{activeStep.action}</p>
                ) : (
                  <p>这一步没有额外说明，按标题做就行，做完打卡。</p>
                )}
              </Panel>

              {/* 本页唯一实心主按钮：放在指引正下方，首屏就能看到 */}
              <div className="flex flex-col gap-2">
                <Button
                  variant="warm"
                  size="lg"
                  className="w-full"
                  onClick={() => setCheckInOpen(true)}
                  disabled={activeStep.completed}
                >
                  {activeStep.completed ? '这一步已完成' : '打卡'}
                </Button>
                {activeStep.completed ? (
                  <span className="text-caption text-caption-foreground">
                    在左边点一个还没开始的步骤，就能继续打卡。
                  </span>
                ) : null}
              </div>

              {resourceLink ? (
                <a
                  href={resourceLink.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-body-sm text-primary hover:bg-surface-container-high"
                >
                  {resourceLink.label}
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </Panel>
          </div>
        ) : null}

        {/* 左列（窄屏第 3 屏位）：步骤时间线 */}
        <Panel data-print="card" className="gap-4 lg:order-2 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-headline-sm text-primary">任务步骤</span>
            {steps.length ? (
              <span className="text-body-sm text-on-surface-variant">
                共 {steps.length} 步 · 已完成 {doneSteps} 步
              </span>
            ) : null}
          </div>

          {steps.length ? (
            <StepList
              steps={steps}
              activeStepId={activeStepId}
              onSelect={(step) => setActiveStepId(step.id)}
            />
          ) : (
            <p className="text-body-sm text-on-surface-variant">步骤还在生成中。</p>
          )}

          {/* 为什么值得做：AI 输出面板的唯一写法（暖色只留左侧竖条） */}
          {task.value_note ? (
            <p className="ai-inset rounded-lg bg-surface-container-low px-3.5 py-3 text-body-md text-on-surface">
              <span className="font-medium text-primary">为什么值得做：</span>
              {task.value_note}
            </p>
          ) : null}
        </Panel>
      </div>

      {/* 放弃 / 删除：一行 caption 级 ghost 动作（与列表页共用同一套确认弹窗） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {canAbandon ? (
          <Button
            variant="ghost"
            size="sm"
            className="px-0 text-body-sm text-on-surface-variant hover:bg-transparent hover:text-primary"
            onClick={() => setAbandonOpen(true)}
          >
            放弃这个任务
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-0 text-body-sm text-on-surface-variant hover:bg-transparent hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-3.5" />
          删除这个任务
        </Button>
      </div>

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
            <Button variant="warm" onClick={() => void handleCheckIn()} disabled={submitting}>
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

/** 把进度比例翻译成人话（只说进度，不编步骤数） */
function progressHint(percent: number): string {
  if (percent <= 0) return '还没开始'
  if (percent < 40) return '刚开头'
  if (percent < 70) return '已经过半'
  if (percent < 100) return '就差最后几步'
  return '全部做完了'
}
