import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Printer, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
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
import { useResumeStore } from '@/store/resumeStore'
import { track } from '@/utils/track'
import { cn } from '@/lib/utils'

/**
 * 简历优化报告（设计说明书 3.2 ⑤，M2）
 *
 * 对齐后端 ResumeOptimizeResponse：
 *   ats_score / completeness / matched_keywords[] / missing_keywords[] /
 *   suggestions: [{section, problem, suggestion, example}] / summary / generated_at
 *
 * 后端**没有**「采纳/忽略建议」接口，所以「忽略」只上报埋点 advice_ignore，
 * 采纳状态仅在前端会话内标记（不落库）。
 * 报告数据走 resumeStore（4.1）。
 */
export default function ResumeReportPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const report = useResumeStore((s) => s.report)
  const loading = useResumeStore((s) => s.loading)
  const fetchReport = useResumeStore((s) => s.fetchReport)
  const optimize = useResumeStore((s) => s.optimize)
  const clearReport = useResumeStore((s) => s.clearReport)
  const [optimizing, setOptimizing] = useState(false)
  const [handled, setHandled] = useState<Record<number, 'adopted' | 'ignored'>>({})

  const load = useCallback(async () => {
    if (!id) return
    // 切换简历时先清掉上一份报告，避免闪出别人的内容
    clearReport()
    setHandled({})
    await fetchReport(id)
  }, [clearReport, fetchReport, id])

  useEffect(() => {
    void load()
  }, [load])

  const reoptimize = async () => {
    if (!id) return
    setOptimizing(true)
    const ok = await optimize(id)
    setOptimizing(false)
    if (ok) {
      setHandled({})
      toast.success('已经重新算过一遍')
    } else {
      toast.error('重新优化失败，稍后再试')
    }
  }

  const handleIgnore = (index: number) => {
    setHandled((prev) => ({ ...prev, [index]: 'ignored' }))
    // 后端没有「忽略建议」接口：只作为无感采集信号
    track('advice_ignore', { resume_id: id, suggestion_index: index })
    toast.info('已忽略，我不会再重复这条')
  }

  const handleAdopt = (index: number) => {
    setHandled((prev) => ({ ...prev, [index]: 'adopted' }))
    toast.success('已采纳，去编辑页改完再重新优化')
  }

  if (loading) {
    return (
      <PageShell title="简历优化报告" breadcrumb="简历">
        <AIThinking text="正在逐条读你的简历…" lines={4} />
      </PageShell>
    )
  }

  if (!report) {
    return (
      <PageShell title="简历优化报告" breadcrumb="简历">
        <EmptyState
          title="还没有这份简历的报告"
          description="先上传或生成一份简历，我才能逐条给建议。"
          action={
            <Button variant="warm" onClick={() => navigate('/resume')}>
              回到简历列表
            </Button>
          }
        />
      </PageShell>
    )
  }

  const suggestions = report.suggestions ?? []

  return (
    <PageShell
      title="简历优化报告"
      breadcrumb="简历"
      actions={
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link to="/resume">
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>
      }
    >
      {/* ATS 评分 + 分项 */}
      <Card data-print="card">
        <CardHeader>
          <CardTitle className="text-base">ATS 评分</CardTitle>
          <CardDescription>{report.summary || '分数不是目的，先改问题最明确的那几条'}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex items-baseline gap-2">
            <span className="font-numeric text-4xl font-semibold text-foreground">
              {Math.round(report.ats_score)}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-sm text-muted-foreground">完整度</span>
              <Progress value={report.completeness} className="h-1.5 flex-1" />
              <span className="w-10 shrink-0 text-right font-numeric text-sm text-foreground">
                {Math.round(report.completeness)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 关键词命中情况 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card data-print="card">
          <CardHeader>
            <CardTitle className="text-base">命中的关键词</CardTitle>
            <CardDescription>这些保留，别删</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {report.matched_keywords?.length ? (
              report.matched_keywords.map((keyword) => (
                <Badge
                  key={keyword}
                  variant="outline"
                  className="rounded-full border-success/40 bg-success/10 text-success"
                >
                  {keyword}
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">暂时没匹配到岗位关键词。</p>
            )}
          </CardContent>
        </Card>

        <Card data-print="card">
          <CardHeader>
            <CardTitle className="text-base">缺失的关键词</CardTitle>
            <CardDescription>有相关经历就补上</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {report.missing_keywords?.length ? (
              report.missing_keywords.map((keyword) => (
                <Badge key={keyword} variant="outline" className="rounded-full">
                  {keyword}
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">岗位关键词基本覆盖了。</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 逐条建议（按后端返回顺序，不做严重度排序 —— 后端没有 severity 字段） */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">待改进</h2>
        {suggestions.length ? (
          suggestions.map((item, index) => (
            <Card
              key={index}
              data-print="card"
              className={cn('gap-3 py-4', handled[index] === 'ignored' && 'opacity-60')}
            >
              <CardHeader className="gap-1 px-4">
                <CardTitle className="text-base">
                  {index + 1}. {item.section || '整体'}
                </CardTitle>
                {item.problem ? <CardDescription>问题：{item.problem}</CardDescription> : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-4">
                {item.suggestion ? (
                  <p className="ai-inset rounded-lg bg-accent/50 px-4 py-2 text-sm text-accent-foreground">
                    建议：{item.suggestion}
                  </p>
                ) : null}
                {item.example ? (
                  <p className="rounded-lg bg-secondary px-4 py-2 text-xs text-secondary-foreground">
                    示例：{item.example}
                  </p>
                ) : null}

                {handled[index] === 'adopted' ? (
                  <p className="text-xs text-success">已采纳</p>
                ) : handled[index] === 'ignored' ? (
                  <p className="text-xs text-muted-foreground">已忽略</p>
                ) : (
                  <div data-print="hide" className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => handleIgnore(index)}>
                      忽略
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleAdopt(index)}>
                      采纳建议
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <EmptyState
            title="暂时没有可改的地方"
            description="要么简历已经不错，要么我还没读到内容。可以重新优化一次。"
            action={
              <Button variant="outline" onClick={() => void reoptimize()}>
                重新优化
              </Button>
            }
          />
        )}
      </section>

      <div data-print="hide" className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => window.print()} className="gap-1.5">
          <Printer className="size-4" />
          浏览器打印
        </Button>
        {/* 本页唯一实心主按钮 */}
        <Button
          variant="warm"
          onClick={() => void reoptimize()}
          disabled={optimizing}
          className="gap-1.5"
        >
          <RefreshCw className={cn('size-4', optimizing && 'animate-spin')} />
          {optimizing ? '重新优化中…' : '重新优化'}
        </Button>
      </div>
    </PageShell>
  )
}
