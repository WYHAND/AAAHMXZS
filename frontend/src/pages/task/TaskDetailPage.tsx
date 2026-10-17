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
 * 版式（2026-10 前端迭代 02）：
 * - 页头走 PageShell，**任务名只在页头出现一次**（页面标题）；主角卡不再重复整句任务名，
 *   改成一句进度人话（"刚好开头 / 已经过半 / 就差最后一步"）——标题已经说过"做什么"，
 *   卡上该回答的是"走到哪了、下一步干嘛"。
 * - 主角卡承担这一页唯一的进度条（＋「已完成 n/m 步」这一处读数）：进度人话
 *   + 关联痛点 chip（与列表页同一写法）+ 当前步指引 + 主按钮「完成这一步」；
 * - 步骤列表**放在主角卡下方**（左 7 列），右侧 5 列只放「为什么值得做」，
 *   没有这句价值说明时步骤列表自己铺满，不留一个空列；
 * - 放弃 / 删除退到页面最下方一行，用 destructive 文字色、与主内容拉开距离；
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
        <Badge variant="outline" className="rounded-full font-normal">
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
          任务名已经在页头当过标题，这里不再重复，改成一句进度人话 + 唯一的进度条。 */}
      <Reveal lg>
        <Panel data-print="card" className="gap-5">
          {/* 顶部一行：身份标签（状态点）+ 成本读数；步数读数贴到进度条下面，别拆成两件事 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-caption tracking-wide text-caption-foreground">
              <span className="size-1.5 rounded-full bg-secondary" aria-hidden />
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

          {/* 一句人话：标题说了"做什么"，这里只回答"走到哪了" */}
          <p className="max-w-[42ch] text-headline-sm text-primary">
            {heroLine(doneSteps, total)}
          </p>

          {/* 关联痛点：与列表页同一写法的小 chip（浅桃 + 图标 + rounded-full），
              不再铺成整条浅底横条 —— 一条横条会读成"这一块的内容" */}
          {task.pain_point ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary-fixed px-3 py-1 text-body-sm text-on-secondary-fixed">
              <Tag className="size-3.5" aria-hidden />
              关联痛点：{task.pain_point}
            </span>
          ) : null}

          {/* 唯一的进度条：grow-x 从左长出来（值更新时组件自己的 transition 接管）；
              步数读数就贴在条下面，读"量"不跑第二处 */}
          <div className="flex flex-col gap-2">
            <Progress
              value={percent}
              aria-label={'已完成 ' + percent + '%'}
              className="grow-x h-1.5 bg-surface-container [&>[data-slot=progress-indicator]]:bg-secondary"
            />
            <span className="text-body-sm tabular-nums text-on-surface-variant">
              {total ? (
                <>
                  已完成 <span className="font-medium text-primary">{doneSteps}</span>/{total} 步
                </>
              ) : (
                '步骤还在拆解，很快就能开始'
              )}
            </span>
          </div>

          {/* 当前步与主 CTA：点主按钮走打卡弹窗（步骤组件的现有行为，一个字没改） */}
          <div className="flex flex-col gap-3 border-t border-outline-variant/40 pt-4 md:flex-row md:items-start md:justify-between">
            <div className="flex min-w-0 flex-col gap-1.5">
              {activeStep ? (
                <>
                  <span className="text-body-sm text-on-surface-variant">
                    现在做：第 {activeStep.step_order} 步 · {activeStep.title}
                  </span>
                  {activeStep.action ? (
                    <p className="text-body-md text-on-surface">{activeStep.action}</p>
                  ) : (
                    <p className="text-body-md text-on-surface-variant">
                      这一步没有额外说明，按标题做就行，做完打个卡。
                    </p>
                  )}
                  {resourceLink ? (
                    <a
                      href={resourceLink.href}
                      target="_blank"
                      rel="noreferrer"
                      className="motion-press inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-body-sm text-primary hover:bg-surface-container-high"
                    >
                      {resourceLink.label}
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </>
              ) : (
                <span className="text-body-sm text-on-surface-variant">
                  步骤还在生成中，先看看上面的任务说明。
                </span>
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
                {/* 只在"这一步已完成"时才需要一句指路；原来那句"点两下就好，不用写小作文。"已删 */}
                {activeStep.completed ? (
                  <span className="text-caption text-caption-foreground">
                    在下面点一个还没开始的步骤，就能继续。
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </Panel>
      </Reveal>

      {/* 步骤列表（左 7）与「为什么值得做」（右 5）；没有价值说明时步骤铺满，不留空列 */}
      <Reveal delay={290}>
        <div className={cn('grid items-start gap-6', task.value_note ? 'lg:grid-cols-12' : undefined)}>
          <Panel data-print="card" className={cn('gap-4', task.value_note ? 'lg:col-span-7' : undefined)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-headline-sm text-primary">任务步骤</span>
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
            <Panel data-print="card" className="gap-3 lg:col-span-5">
              <h2 className="text-headline-sm text-primary">这个任务为什么值得做</h2>
              <p className="text-body-md text-on-surface">{task.value_note}</p>
            </Panel>
          ) : null}
        </div>
      </Reveal>

      {/* 放弃 / 删除：破坏性动作统一用 destructive 文字色，并退到页面最下方、与主内容拉开距离
          （mt-6 叠在 PageShell 的 24px 节奏之上 = 48px），二次确认仍与列表页共用同一套弹窗 */}
      <Reveal delay={650} className="mt-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {canAbandon ? (
            <Button
              variant="ghost"
              size="sm"
              className="motion-press px-0 text-body-sm text-destructive hover:bg-transparent hover:text-destructive/75"
              onClick={() => setAbandonOpen(true)}
            >
              放弃这个任务
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="motion-press gap-1 px-0 text-body-sm text-destructive hover:bg-transparent hover:text-destructive/75"
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
