import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, ListChecks } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState } from '@/components/EmptyState'
import { StepList } from '@/components/StepList'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { taskProgress, useTaskStore } from '@/store/taskStore'
import type { TaskStep } from '@/types'
import { toResourceLink } from '@/utils/resourceLink'
import { cn } from '@/lib/utils'

const ABANDON_REASONS = ['太难了，做不下去', '不感兴趣了', '时间不够', '方向变了']

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
                'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                selected
                  ? 'border-primary bg-primary-soft text-foreground'
                  : 'border-border bg-card hover:bg-secondary',
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
 * - 每一步有「行动指引 (action) + 资源链接 (resource)」
 * - 打卡弹窗：这一步花了多久 / 卡在哪 —— 后端只有一个 feedback 字段，
 *   前端把两栏拼成一段文本提交
 * - 放弃任务：AlertDialog 二次确认 + 原因选择；后端 abandon 接口**不接受 body**，
 *   原因只通过 track('task_abandon') 记录为本地埋点信号
 */
export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    activeTask: task,
    steps,
    loading,
    error,
    fetchTask,
    completeStep,
    abandon,
  } = useTaskStore()

  const [activeStepId, setActiveStepId] = useState<string | null>(null)
  const [checkInOpen, setCheckInOpen] = useState(false)
  // 打卡改成「做题/填表」：两个单选 + 一个可选短填空。
  // 产品决策：**不要求用户写小作文**（写长文本是留存杀手，尤其对低主动性用户）。
  const [stepProgress, setStepProgress] = useState<string>(STEP_PROGRESS[0])
  const [stepFeeling, setStepFeeling] = useState<string>(STEP_FEELING[0])
  const [note, setNote] = useState('')
  const [reason, setReason] = useState(ABANDON_REASONS[0])
  const [submitting, setSubmitting] = useState(false)

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

  const handleAbandon = async () => {
    if (!id) return
    const ok = await abandon(id, reason)
    if (ok) {
      toast.success('已放弃这个任务，我不会再催你')
      navigate('/task')
    } else {
      toast.error('操作失败，请稍后再试')
    }
  }

  const percent = taskProgress(task)

  return (
    <PageShell
      title={task.title}
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
      <Card data-print="card">
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full">
              {task.status}
            </Badge>
            {task.difficulty ? (
              <Badge variant="outline" className="rounded-full">
                难度：{task.difficulty}
              </Badge>
            ) : null}
            {task.estimated_days ? (
              <Badge variant="outline" className="rounded-full">
                预计 {task.estimated_days} 天
              </Badge>
            ) : null}
          </div>
          {task.pain_point ? (
            <CardDescription>关联痛点：{task.pain_point}</CardDescription>
          ) : null}
          {task.description ? (
            <p className="text-sm text-muted-foreground">{task.description}</p>
          ) : null}
          {task.value_note ? (
            <p className="ai-inset rounded-lg bg-accent/50 px-4 py-2 text-sm text-accent-foreground">
              {task.value_note}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <Progress value={percent} className="h-1.5 flex-1" />
            <span className="shrink-0 font-numeric text-xs text-muted-foreground">
              {percent}%
            </span>
          </div>
        </CardHeader>
      </Card>

      <Card data-print="card">
        <CardHeader>
          <CardTitle className="text-base">任务步骤</CardTitle>
        </CardHeader>
        <CardContent>
          {steps.length ? (
            <StepList
              steps={steps}
              activeStepId={activeStepId}
              onSelect={(step) => setActiveStepId(step.id)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">步骤还在生成中。</p>
          )}
        </CardContent>
      </Card>

      {activeStep ? (
        <Card data-print="card">
          <CardHeader className="gap-1">
            <CardTitle className="text-base">
              第 {activeStep.step_order} 步：行动指引
            </CardTitle>
            <CardDescription>{activeStep.title}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {activeStep.action ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {activeStep.action}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                这一步没有额外说明，按标题做就行，做完打卡。
              </p>
            )}

            {resourceLink ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={resourceLink.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-primary hover:bg-primary-soft"
                >
                  {resourceLink.label}
                  <ExternalLink className="size-3" />
                </a>
              </div>
            ) : null}

            {activeStep.feedback ? (
              <p className="rounded-lg bg-secondary px-4 py-2 text-xs text-secondary-foreground">
                上次打卡反馈：{activeStep.feedback}
              </p>
            ) : null}

            <div className="flex justify-end">
              {/* 本页唯一实心主按钮 */}
              <Button
                variant="warm"
                onClick={() => setCheckInOpen(true)}
                disabled={activeStep.completed}
              >
                {activeStep.completed ? '这一步已完成' : '打卡'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* 放弃任务：弱化入口 + 二次确认 */}
      <div className="flex justify-center pt-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              放弃这个任务
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定要放弃吗？</AlertDialogTitle>
              <AlertDialogDescription>
                放弃不会扣分，但我会把它记成一次信号，下次少推类似的。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2">
              {ABANDON_REASONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setReason(item)}
                  className={
                    reason === item
                      ? 'rounded-md border border-primary bg-primary-soft px-3 py-2 text-left text-sm'
                      : 'rounded-md border px-3 py-2 text-left text-sm hover:bg-secondary'
                  }
                >
                  {item}
                </button>
              ))}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>再想想</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleAbandon()}>确认放弃</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

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
