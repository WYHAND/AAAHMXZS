import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ListChecks, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState } from '@/components/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { PageShell } from '@/components/PageShell'
import { toTaskDetail } from '@/constants/routes'
import { taskProgress, useTaskStore } from '@/store/taskStore'
import { useProfileStore } from '@/store/profileStore'
import { formatRelative } from '@/utils/format'

/**
 * 任务列表（设计说明书 2.1 /task，3.1 P0）
 * profileStore.version 变化（打卡 / 对话结束）后重新拉取。
 *
 * Fix B：列表读取走 normalizeList（在 store 里）；后端 status 是中文。
 */
export default function TaskListPage() {
  const { tasks, loading, fetchTasks, generate } = useTaskStore()
  const version = useProfileStore((s) => s.version)

  useEffect(() => {
    void fetchTasks()
  }, [fetchTasks, version])

  const handleGenerate = async () => {
    const task = await generate()
    if (task) {
      toast.success('已经按你现在的痛点生成了一个任务')
    } else {
      toast.error('生成失败，先和我聊聊你的卡点')
    }
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
            return (
              <Card key={task.id} data-print="card" className="gap-3 py-4">
                <CardHeader className="flex-row items-start justify-between gap-3 px-4">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-base">{task.title}</CardTitle>
                    {task.pain_point ? (
                      <p className="text-xs text-muted-foreground">
                        关联痛点：{task.pain_point}
                      </p>
                    ) : null}
                  </div>
                  <Badge variant="outline" className="shrink-0 rounded-full">
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
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      预计 {task.estimated_days ?? '—'} 天 · 更新于{' '}
                      {formatRelative(task.updated_at)}
                    </span>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={toTaskDetail(task.id)}>查看步骤</Link>
                    </Button>
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
    </PageShell>
  )
}
