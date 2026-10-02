import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { taskApi } from '@/api/task'
import { DONE_STATUS, ONGOING_STATUS, useTaskStore } from '@/store/taskStore'
import type { Task } from '@/types'

/**
 * 删除任务的二次确认弹窗（列表页与详情页共用同一个）。
 *
 * ## 为什么必须"先数一遍打卡，再问"
 * 行动力分数（`GET /profile` 里的 `action_score`）是**数已完成打卡的步骤**算出来的，
 * 所以删掉带打卡的任务，分数会真的下降 —— 这是"分数=证据"的必然结果，不是 bug。
 * 但列表接口只给 `progress`（0-1 的比例，四舍五入后用户看到的百分比），
 * **拿不到"已打卡步骤数"**，所以这里在用户点「删除」之后、弹确认之前，
 * 先拉一次 `GET /task/{id}` 把准确数字问出来，再把它写进确认文案里 —— **不猜**。
 *
 * 拉不到详情（网络失败 / 任务已被别处删掉）时退化成一句"如果它里面有打过卡的步骤，
 * 行动力分数会跟着下降"，宁可说得保守，也不编一个数字。
 *
 * ## 三种文案（用户实际会看到的）
 * - 一步都没打卡：删掉不影响分数，任务和步骤一起消失、没法恢复；
 * - 有 N 步打过卡（进行中）：明确写出"这个任务里有 N 步打过卡，删掉之后行动力分数会下降"；
 * - 已完成的整条任务：N 步都打过卡，另外"完成整条任务的加分"也会一起收回。
 *
 * ## 其它细节
 * - 删除进行中不接受 ESC / 点遮罩关闭（与 ChatPage 的删会话一致），避免"以为取消了其实删了"；
 * - 成功后由 store 从列表里摘掉该条 + `profileStore.bumpVersion()`，这里只负责提示；
 * - 失败时 store 保证**列表一个字节都不动**，这里只报一条错。
 */
export interface TaskDeleteDialogProps {
  /** 要删的任务；null 表示关闭 */
  task: Task | null
  onOpenChange: (open: boolean) => void
  /** 删除成功后的回调（详情页用它跳回列表） */
  onDeleted?: () => void
}

export function TaskDeleteDialog({ task, onOpenChange, onDeleted }: TaskDeleteDialogProps) {
  const remove = useTaskStore((s) => s.remove)
  /** 已打卡步骤数：null = 还没数出来（正在拉详情，或详情拉不到） */
  const [completedSteps, setCompletedSteps] = useState<number | null>(null)
  const [checking, setChecking] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const taskId = task?.id ?? null
  const taskStatus = task?.status ?? ''
  /** 本次是否打开着（外部把 task 置 null 即关闭） */
  const open = task !== null

  // 每次**打开**都重新拉一次详情：确认文案里的 N 必须是当下的真数字。
  // 依赖里放 open（false -> true 也是一次变化）是刻意的：同一个任务第二次打开
  // 也会重新数一遍，否则用户"关掉弹窗 -> 去打卡 -> 再点删除"时数字会是旧的。
  useEffect(() => {
    if (!taskId || !open) return
    let cancelled = false
    setChecking(true)
    setCompletedSteps(null)
    void (async () => {
      try {
        // silent：这次只为数数字，失败不该再弹一条全局错误（文案里已经按保守说法兜底）
        const detail = await taskApi.detail(taskId, { silent: true })
        if (cancelled) return
        setCompletedSteps((detail?.steps ?? []).filter((step) => step.completed).length)
      } catch {
        if (!cancelled) setCompletedSteps(null)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [taskId, open])

  const handleConfirm = async () => {
    if (!taskId || deleting) return
    setDeleting(true)
    const result = await remove(taskId)
    setDeleting(false)
    if (!result) {
      toast.error('删除失败，这条任务还在，列表没有变动')
      return
    }
    const parts = [`已删除「${result.title}」，连带清掉 ${result.deleted_steps} 个步骤`]
    if (result.completed_steps > 0) {
      parts.push('行动力分数已经按剩下的打卡重新算过了')
    }
    toast.success(parts.join('；'))
    onDeleted?.()
    onOpenChange(false)
  }

  /** 确认文案：说清"会发生什么"，不出现任何英文字段名 */
  const consequence = checking
    ? '正在核对这条任务里有多少步打过卡……'
    : completedSteps === null
      ? '删除之后，这条任务和它的步骤会一起消失，没法恢复。如果它里面有打过卡的步骤，行动力分数会跟着下降。'
      : completedSteps === 0
        ? '这条任务还没有打过卡，删掉它不影响你的分数。任务和步骤会一起消失，没法恢复。'
        : taskStatus === DONE_STATUS
          ? `这条任务已经完成了，里面 ${completedSteps} 步都打过卡。删掉之后任务和步骤会一起消失，没法恢复；行动力分数会跟着下降，完成整条任务的加分也会一起收回。`
          : `这个任务里有 ${completedSteps} 步打过卡，删掉之后行动力分数会下降。任务和步骤会一起消失，没法恢复。`

  return (
    <AlertDialog
      open={task !== null}
      onOpenChange={(open) => {
        // 删除进行中不接受 ESC / 遮罩点击关闭
        if (!open && !deleting) onOpenChange(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{task?.title ?? ''}」？</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        {/*
          "换个更轻的做法"的提示：只在**确实能放弃**时给（进行中 + 有打卡）。
          已完成的整条任务后端不允许放弃（1001）、界面上也没有那个入口，
          对它说"用放弃也一样"就是骗人。
        */}
        {completedSteps !== null && completedSteps > 0 && taskStatus === ONGOING_STATUS ? (
          <p className="text-xs text-muted-foreground">
            如果你只是想让它别再出现在待办里，用「放弃」也一样，而且不会掉分。
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting || checking}
            onClick={(event) => {
              event.preventDefault()
              void handleConfirm()
            }}
          >
            {deleting ? '删除中…' : '确认删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
