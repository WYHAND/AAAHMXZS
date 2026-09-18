import { useCallback, useEffect, useState } from 'react'
import { Flame, HelpCircle, Send } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { dailyApi } from '@/api/daily'
import { useProfileStore } from '@/store/profileStore'
import type { TodayQuestion } from '@/types'
import { track } from '@/utils/track'

/** 后端 DailyAnswerRequest.answer 上限 200 字 */
const ANSWER_MAX = 200

/**
 * 每日一问（设计说明书 2.1 /daily、3.2 ① 模块①）
 *
 * 后端形状：GET /daily/today -> { question: {id, dimension, content}, answered, answer, streak }
 *            POST /daily/answer -> body { question_id, answer }（**不是**路径参数）
 * 回答成功后触发画像失效（4.2）。
 * Fix A：后端没有 GET /daily/history，历史走空态。
 */
export default function DailyPage() {
  const bumpVersion = useProfileStore((s) => s.bumpVersion)
  const [today, setToday] = useState<TodayQuestion | null>(null)
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await dailyApi.today()
      setToday(data ?? null)
      setAnswer(data?.answer ?? '')
    } catch {
      setToday(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (!today?.question || !answer.trim()) return
    setSubmitting(true)
    try {
      const updated = await dailyApi.answer({
        question_id: today.question.id,
        answer: answer.trim().slice(0, ANSWER_MAX),
      })
      setToday({ ...today, answered: true, answer: updated?.answer ?? answer })
      track('daily_answer', { question_id: today.question.id })
      // 4.2：回答属于画像写操作
      bumpVersion()
      toast.success(
        updated?.profile_refreshed ? '记下了，这条已经进你的画像' : '记下了，攒够 7 题我会更新画像',
      )
    } catch {
      toast.error('提交失败，回答还留在输入框里')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell
      title="每日一问"
      description="一天一句话就够，不用写小作文。"
      breadcrumb="每日一问"
    >
      {loading ? (
        <AIThinking text="正在取今天的问题…" lines={2} />
      ) : today?.question ? (
        <Card data-print="card">
          <CardHeader className="gap-1">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <HelpCircle className="size-4 text-ai-accent" />
                今天的问题
              </CardTitle>
              {today.streak > 0 ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Flame className="size-3 text-warning" />
                  连续 {today.streak} 天
                </span>
              ) : null}
            </div>
            <CardDescription>{today.question.content}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {today.answered ? (
              <p className="rounded-lg bg-secondary px-4 py-3 text-sm text-secondary-foreground">
                {today.answer ?? answer}
              </p>
            ) : null}
            <Textarea
              rows={3}
              maxLength={ANSWER_MAX}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="想到什么写什么，一句话也可以"
            />
            <div className="flex items-center justify-between">
              <span className="font-numeric text-xs text-muted-foreground">
                {answer.length}/{ANSWER_MAX}
              </span>
              <Button
                variant="warm"
                onClick={() => void submit()}
                disabled={submitting || !answer.trim()}
                className="gap-1.5"
              >
                <Send className="size-4" />
                {submitting ? '提交中…' : today.answered ? '更新回答' : '提交'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          icon={<HelpCircle className="size-5" />}
          title="今天的问题还没准备好"
          description="每日一问接口暂时没返回内容，稍后再来看看。"
          action={
            <Button variant="warm" onClick={() => void load()}>
              重新加载
            </Button>
          }
        />
      )}
    </PageShell>
  )
}
