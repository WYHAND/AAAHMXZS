import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Printer, RefreshCw, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { StageBadge } from '@/components/StageBadge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { PageShell } from '@/components/PageShell'
import { reportApi } from '@/api/report'
import { normalizeStage } from '@/constants/stage'
import { useStage } from '@/hooks/useStage'
import type { GrowthReportContent } from '@/types'
import { formatDateTime } from '@/utils/format'
import { cn } from '@/lib/utils'

/**
 * 成长报告（设计说明书 2.1 /report，M3）
 *
 * Fix A：路径是 GET /report（**不是** /report/growth）。
 * 后端 ReportResponse.content 是 GrowthReportContent：
 *   stage / stage_changed / clarity_score / action_score / resume_score / total_score /
 *   score_delta{} / completed_tasks / completed_steps / active_days /
 *   highlights[] / suggestions[]
 * **没有 trend 时间序列**，所以原来的折线图改成「分数 + 变化」对比视图。
 */
export default function GrowthReportPage() {
  const { stage } = useStage()
  const [content, setContent] = useState<GrowthReportContent | null>(null)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    try {
      const report = await reportApi.growth(refresh ? { refresh: true } : undefined)
      setContent(report?.content ?? null)
      setCreatedAt(report?.created_at ?? null)
    } catch {
      setContent(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleRefresh = async () => {
    await load(true)
    toast.success('已经重新算过一份报告')
  }

  if (loading) {
    return (
      <PageShell title="成长报告" breadcrumb="成长报告">
        <AIThinking text="正在汇总你这段时间的动作…" lines={4} />
      </PageShell>
    )
  }

  if (!content) {
    return (
      <PageShell title="成长报告" breadcrumb="成长报告">
        <EmptyState
          icon={<TrendingUp className="size-5" />}
          title="还没攒够数据，先把这一周的事做完"
          description="成长报告至少需要一段时间的打卡与对话记录。"
          action={
            <Button variant="warm" asChild>
              <Link to="/task">去看看今天的任务</Link>
            </Button>
          }
        />
      </PageShell>
    )
  }

  const scores = [
    { label: '方向清晰度', value: content.clarity_score, key: 'clarity_score' },
    { label: '行动力', value: content.action_score, key: 'action_score' },
    { label: '简历准备度', value: content.resume_score, key: 'resume_score' },
  ]
  const deltaEntries = Object.entries(content.score_delta ?? {})

  return (
    <PageShell
      title="成长报告"
      description={createdAt ? `生成于 ${formatDateTime(createdAt)}` : undefined}
      breadcrumb="成长报告"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="size-4" />
            浏览器打印
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="gap-1.5"
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            重新计算
          </Button>
        </div>
      }
    >
      <Card data-print="card">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">当前阶段</CardTitle>
            <CardDescription>
              {content.stage_changed ? '这一周期阶段发生变化了' : '阶段保持稳定'}
            </CardDescription>
          </div>
          <StageBadge stage={normalizeStage(content.stage ?? stage)} showStepper />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-numeric text-4xl font-semibold text-foreground">
              {Math.round(content.total_score)}
            </span>
            <span className="text-sm text-muted-foreground">/ 100 综合分</span>
          </div>

          <div className="flex flex-col gap-3">
            {scores.map((score) => {
              const delta = content.score_delta?.[score.key]
              return (
                <div key={score.key} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">
                    {score.label}
                  </span>
                  <Progress value={score.value} className="h-1.5 flex-1" />
                  <span className="w-10 shrink-0 text-right font-numeric text-sm text-foreground">
                    {Math.round(score.value)}
                  </span>
                  {typeof delta === 'number' ? (
                    <span
                      className={cn(
                        'w-12 shrink-0 text-right font-numeric text-xs',
                        delta >= 0 ? 'text-success' : 'text-destructive',
                      )}
                    >
                      {delta >= 0 ? '+' : ''}
                      {delta}
                    </span>
                  ) : (
                    <span className="w-12 shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="完成任务" value={content.completed_tasks} unit="个" />
        <StatCard label="完成步骤" value={content.completed_steps} unit="步" />
        <StatCard label="活跃天数" value={content.active_days} unit="天" />
      </div>

      {deltaEntries.length ? (
        <Card data-print="card">
          <CardHeader>
            <CardTitle className="text-base">与上一份报告相比</CardTitle>
            <CardDescription>只有变化过的维度会出现在这里</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {deltaEntries.map(([key, value]) => (
              <div key={key} className="flex flex-col rounded-lg border px-3 py-2">
                <span className="text-xs text-muted-foreground">{key}</span>
                <span
                  className={cn(
                    'font-numeric text-lg',
                    value >= 0 ? 'text-success' : 'text-destructive',
                  )}
                >
                  {value >= 0 ? '+' : ''}
                  {value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {content.highlights?.length ? (
        <Card data-print="card">
          <CardHeader>
            <CardTitle className="text-base">本周期亮点</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {content.highlights.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {content.suggestions?.length ? (
        <Card data-print="card" className="ai-inset">
          <CardHeader>
            <CardTitle className="text-base text-accent-foreground">下一步建议</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-accent-foreground/90">
              {content.suggestions.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </PageShell>
  )
}

function StatCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <Card data-print="card">
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="font-numeric text-3xl font-semibold text-foreground">{value}</span>
        <span className="ml-2 text-sm text-muted-foreground">{unit}</span>
      </CardContent>
    </Card>
  )
}
