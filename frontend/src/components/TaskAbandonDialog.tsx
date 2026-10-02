import { useState } from 'react'
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
import { useTaskStore } from '@/store/taskStore'
import type { Task } from '@/types'

/**
 * 放弃任务的二次确认弹窗（列表页与详情页共用同一个，沿用详情页原来的写法）。
 *
 * 语义与后端 `POST /task/{id}/abandon` 一致：**只是把状态改成「已放弃」**，
 * 任务与打卡记录都留着、**不扣分** —— 所以文案是"放弃不会扣分，但我会把它记成一次信号"。
 * 想彻底清掉列表要的是「删除」（硬删除，见 TaskDeleteDialog），两者别混。
 *
 * - 原因选择只作为本地埋点信号（后端不接受 body，见 store 的 abandon）；
 * - 已完成的整条任务后端会拒（1001），调用方**不要**给它显示这个入口。
 */
export interface TaskAbandonDialogProps {
  /** 要放弃的任务；null 表示关闭 */
  task: Task | null
  onOpenChange: (open: boolean) => void
  /** 放弃成功后的回调（详情页用它跳回列表） */
  onAbandoned?: () => void
}

/** 放弃原因（沿用详情页原来的四项，未新增） */
const ABANDON_REASONS = ['太难了，做不下去', '不感兴趣了', '时间不够', '方向变了']

export function TaskAbandonDialog({ task, onOpenChange, onAbandoned }: TaskAbandonDialogProps) {
  const abandon = useTaskStore((s) => s.abandon)
  const [reason, setReason] = useState(ABANDON_REASONS[0])
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = async () => {
    if (!task || submitting) return
    setSubmitting(true)
    const ok = await abandon(task.id, reason)
    setSubmitting(false)
    if (ok) {
      toast.success('已放弃这个任务，我不会再催你')
      onAbandoned?.()
      onOpenChange(false)
    } else {
      toast.error('操作失败，请稍后再试')
    }
  }

  return (
    <AlertDialog
      open={task !== null}
      onOpenChange={(open) => {
        // 提交中不接受 ESC / 遮罩点击关闭
        if (!open && !submitting) onOpenChange(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确定要放弃「{task?.title ?? ''}」吗？</AlertDialogTitle>
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
          <AlertDialogCancel disabled={submitting}>再想想</AlertDialogCancel>
          <AlertDialogAction
            disabled={submitting}
            onClick={(event) => {
              event.preventDefault()
              void handleConfirm()
            }}
          >
            {submitting ? '提交中…' : '确认放弃'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
