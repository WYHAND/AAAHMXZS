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
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { taskProgress, useTaskStore } from '@/store/taskStore'
import type { TaskStep } from '@/types'

const ABANDON_REASONS = ['太难了，做不下去', '不感兴趣了', '时间不够', '方向变了']

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
  const [duration, setDuration] = useState('')
  const [blocker, setBlocker] = useState('')
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
    // 后端 TaskStepCompleteRequest 只有一个 feedback 字段
    const feedback = [
      duration.trim() ? `花了多久：${duration.trim()}` : '',
      blocker.trim() ? `卡在哪：${blocker.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const ok = await completeStep(id, activeStep.id, feedback)
    setSubmitting(false)
    if (ok) {
      setCheckInOpen(false)
      setDuration('')
      setBlocker('')
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

            {activeStep.resource ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={activeStep.resource}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs text-primary hover:bg-primary-soft"
                >
                  参考资源
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

      {/* 打卡弹窗 */}
      <Dialog open={checkInOpen} onOpenChange={setCheckInOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>记录这一步</DialogTitle>
            <DialogDescription>
              这一步花了多久？卡在哪？（都可以不填，会合成一段反馈提交）
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="duration">花了多久</Label>
              <Textarea
                id="duration"
                rows={2}
                maxLength={500}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="比如：断断续续两天"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="blocker">卡在哪</Label>
              <Textarea
                id="blocker"
                rows={2}
                maxLength={500}
                value={blocker}
                onChange={(e) => setBlocker(e.target.value)}
                placeholder="比如：不知道选什么技术栈"
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
