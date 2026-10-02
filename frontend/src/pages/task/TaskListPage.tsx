import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/EmptyState'
import { TaskAbandonDialog } from '@/components/TaskAbandonDialog'
import { TaskDeleteDialog } from '@/components/TaskDeleteDialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { PageShell } from '@/components/PageShell'
import { toTaskDetail } from '@/constants/routes'
import {
  ABANDONED_STATUS,
  DONE_STATUS,
  ONGOING_STATUS,
  taskProgress,
  useTaskStore,
} from '@/store/taskStore'
import { useProfileStore } from '@/store/profileStore'
import type { Task } from '@/types'
import { formatRelative } from '@/utils/format'

/**
 * 任务列表（设计说明书 2.1 /task，3.1 P0）
 * profileStore.version 变化（打卡 / 对话结束 / 删除）后重新拉取。
 *
 * Fix B：列表读取走 normalizeList（在 store 里）；后端 status 是中文。
 *
 * 每张卡片三个动作（用户的真实痛点是"清不掉"，所以「删除」必须在这里就有）：
 * - 查看步骤：原有入口，一个字没动；
 * - 删除：硬删除（连带步骤），二次确认弹窗会先数清有多少步打过卡、说清分数后果；
 * - 放弃：把详情页那个弱化入口提到列表页，语义不变（只改状态、不扣分）。
 *   只给「进行中」的任务显示（已完成的会被后端拒，已放弃的再点一次没有意义）。
 *
 * 状态与排序：列表按「进行中 -> 已完成 -> 已放弃」排（见 store 的 sortTasksForDisplay），
 * 已完成/已放弃的卡片底色与状态徽章都更淡 —— 但**不隐藏**，用户想回看还在。
 */
export default function TaskListPage() {
  const { tasks, loading, fetchTasks, generate } = useTaskStore()
  const version = useProfileStore((s) => s.version)
  /** 命中的已有任务 id：卡片会被标一下，让用户一眼看到是哪条 */
  const [reusedId, setReusedId] = useState<string | null>(null)
  /** 正在确认删除 / 放弃的任务（整页共用一份弹窗，null = 关闭） */
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [abandonTarget, setAbandonTarget] = useState<Task | null>(null)

  useEffect(() => {
    void fetchTasks()
  }, [fetchTasks, version])

  // 标一下就好，几秒后自己褪掉，避免看起来像"选中的状态"
  useEffect(() => {
    if (!reusedId) return
    const timer = window.setTimeout(() => setReusedId(null), 6000)
    return () => window.clearTimeout(timer)
  }, [reusedId])

  const handleGenerate = async () => {
    const task = await generate()
    if (!task) {
      toast.error('生成失败，先和我聊聊你的卡点')
      return
    }
    // 判定只看 reused（不匹配文案）：true = 服务端有同题任务，没有新建
    if (task.reused === true) {
      setReusedId(task.id)
      toast.info('已经有一个类似的任务了，我把它放到最前面标给你了')
      return
    }
    setReusedId(null)
    toast.success('已经按你现在的痛点生成了一个任务')
  }

  return (
    <PageShell
      title="成长任务"
      description="每个任务都拆成能当天做完的小步，做完就打卡。"
      breadcrumb="成长任务"
      actions={
        <Button variant="warm" size="sm" onClick={() => void handleGenerate()} className="gap-1.5">
          <Sparkles className="size-4" />
          让 AI 生成任务
        </Button>
      }
    >
      {loading && !tasks.length ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : tasks.length ? (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => {
            const percent = taskProgress(task)
            const isOngoing = task.status === ONGOING_STATUS
            const isAbandoned = task.status === ABANDONED_STATUS
            const isDone = task.status === DONE_STATUS
            return (
              <Card
                key={task.id}
                data-print="card"
                className={cn(
                  'gap-3 py-4',
                  // 已完成 / 已放弃的卡片视觉上更淡（但一条都不隐藏）
                  !isOngoing && 'bg-muted/40',
                  reusedId === task.id && 'border-primary/50 bg-primary-soft/60',
                )}
              >
                <CardHeader className="flex-row items-start justify-between gap-3 px-4">
                  <div className="flex flex-col gap-1">
                    <CardTitle className={cn('text-base', !isOngoing && 'text-muted-foreground')}>
                      {task.title}
                    </CardTitle>
                    {task.pain_point ? (
                      <p className="text-xs text-muted-foreground">
                        关联痛点：{task.pain_point}
                      </p>
                    ) : null}
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 rounded-full',
                      isOngoing && 'border-primary/40 text-primary',
                      isAbandoned && 'text-muted-foreground',
                      isDone && 'text-muted-foreground',
                    )}
                  >
                    {task.status}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 px-4">
                  <div className="flex items-center gap-3">
                    <Progress value={percent} className="h-1.5 flex-1" />
                    <span className="shrink-0 font-numeric text-xs text-muted-foreground">
                      {percent}%
                    </span>
                  </div>
                  {isAbandoned ? (
                    // 已放弃的任务不藏起来（用户可能想回看），但要说明它不会再催，
                    // 并给出"想清理就删掉"的出口 —— 这正是用户"清不掉"的痛点所在
                    <p className="text-xs text-muted-foreground">
                      已放弃：不会再提醒你，记录还留着。想彻底清掉可以删除。
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      预计 {task.estimated_days ?? '—'} 天 · 更新于{' '}
                      {formatRelative(task.updated_at)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {isOngoing ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          onClick={() => setAbandonTarget(task)}
                        >
                          放弃
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(task)}
                      >
                        <Trash2 className="size-4" />
                        删除
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to={toTaskDetail(task.id)}>查看步骤</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title="还没有任务，我带你从一次对话里生成"
          description="任务不是作业，是从你自己说的话里长出来的下一步。"
          action={
            <Button variant="warm" onClick={() => void handleGenerate()}>
              用我的画像生成一个
            </Button>
          }
        />
      )}

      {/* 删除 / 放弃的二次确认（整页共用一份，列表里每条卡片只是打开它的入口） */}
      <TaskDeleteDialog
        task={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
      <TaskAbandonDialog
        task={abandonTarget}
        onOpenChange={(open) => {
          if (!open) setAbandonTarget(null)
        }}
      />
    </PageShell>
  )
}
