import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/Panel'
import { PageShell } from '@/components/PageShell'
import { interviewApi } from '@/api/interview'
import { interviewDimensionLabel } from '@/constants/interview'
import type { InterviewQuestionReview, InterviewReview, ProfileRadarItem } from '@/types'
import { cn } from '@/lib/utils'

/**
 * 面试复盘（设计说明书 2.1 /interview/review/:id，M2）
 *
 * 对齐后端 InterviewReviewResponse：
 *   overall_score / dimension_scores{维度:分数} / strengths[] / improvements[] /
 *   question_reviews[] / summary / generated_at
 *
 * 「逐题点评」按后端 schema 逐字段渲染
 * （question / answer_summary / score / comment / better_answer），
 * 缺字段就不渲染该块 —— **不允许再用 <pre>{JSON.stringify(...)}</pre> 兜底**。
 *
 * 2026-10 收口：整页从 `Card` 换成 `Panel`（唯一卡片外观）；
 * 「下次可以改」这类 AI 输出统一成 `ai-inset + bg-surface-container-low + 正文字色`
 * （原来正文写的是 `text-accent-foreground` —— 那是"浅桃底上的深褐字"，
 * 现在浅桃只留给小面积强调，正文色必须是 `text-on-surface`）。
 */
export default function InterviewReviewPage() {
  const { id } = useParams<{ id: string }>()
  const [review, setReview] = useState<InterviewReview | null>(null)
  const [loading, setLoading] = useState(true)
  /** 正在补生成复盘（POST /interview/{id}/finish，要调 AI，可能十几秒） */
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const data = await interviewApi.review(id)
      setReview(data ?? null)
    } catch {
      setReview(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  /**
   * 没有复盘时**就地补一份**：调 finish 生成，再读一次。
   *
   * 为什么要有这个按钮：复盘是 finish 的产物，而 finish 可能没被调用过
   * （早期版本「结束面试」只是跳走）、也可能中途失败。没有它，用户在这个页面上
   * 只有一个**永远点不出来**的「重新加载」—— 面试卡在"进行中"，复盘页永远空着。
   */
  const generate = useCallback(async () => {
    if (!id) return
    setGenerating(true)
    try {
      await interviewApi.finish(id)
    } catch {
      toast.error('生成复盘没成功，过一会儿再点一次。')
      setGenerating(false)
      return
    }
    setGenerating(false)
    await load()
  }, [id, load])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <PageShell title="面试复盘" breadcrumb="模拟面试">
        <AIThinking text="正在回看你刚才的回答…" lines={4} />
      </PageShell>
    )
  }

  if (!review) {
    return (
      <PageShell title="面试复盘" breadcrumb="模拟面试">
        <EmptyState
          title="这份复盘还没生成"
          description="如果这场面试还没结束（或者结束那一步没成功），点下面这个按钮，我立刻按你已经答的内容补一份复盘。"
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="warm" size="lg" onClick={() => void generate()} disabled={generating}>
                {generating ? '正在生成复盘…' : '生成复盘'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={generating}>
                重新加载
              </Button>
            </div>
          }
        />
      </PageShell>
    )
  }

  // 维度名一律过中文映射（AI 偶发英文键时不能直接渲染到雷达图上）
  const dimensions: ProfileRadarItem[] = Object.entries(review.dimension_scores ?? {}).map(
    ([dimension, score]) => ({ dimension: interviewDimensionLabel(dimension), score }),
  )
  const questionReviews = (review.question_reviews ?? []).filter(
    (item): item is InterviewQuestionReview => Boolean(item),
  )

  return (
    <PageShell
      title="面试复盘"
      description={review.summary || '重点不是分数，是下次改哪两件事。'}
      breadcrumb="模拟面试"
    >
      <Panel data-print="card" className="gap-5">
        <h2 className="text-headline-sm text-primary">整体表现</h2>
        {/*
          只有真的打过分才显示总分：兜底复盘（AI 没生成出来）里 overall_score 是 0，
          把 0 当成"你考了 0 分"端出去是假信息。
          版式：总分与雷达图并排（总分列 auto、雷达 1fr），窄屏自动堆叠；
          雷达容器 224px（原来 256px，与总分并排后 256 会顶掉右列留白）。
        */}
        {dimensions.length ? (
          <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-center">
            <div className="flex items-baseline gap-1.5">
              <span className="font-numeric text-[32px] font-bold leading-none text-primary">
                {Math.round(review.overall_score)}
              </span>
              <span className="text-body-sm text-on-surface-variant">/ 100</span>
            </div>
            {/* 容器收到 520px（高度 224px）：只有 4 个维度时铺满整列会让菱形显得小而空 */}
            <div className="h-[224px] w-full min-w-0 max-w-[520px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={dimensions} outerRadius="72%">
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis
                    dataKey="dimension"
                    tick={{ fontSize: 12, fill: 'var(--on-surface-variant)' }}
                  />
                  <Radar
                    dataKey="score"
                    stroke="var(--primary)"
                    fill="var(--primary)"
                    fillOpacity={0.2}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="text-body-md text-on-surface-variant">
            本次没有 AI 评分（点评这次没生成出来，下面只有按作答情况给的建议）。
          </p>
        )}
      </Panel>

      <div className="grid gap-6 sm:grid-cols-2">
        <Panel data-print="card" className="gap-3">
          <h2 className="text-headline-sm text-primary">答得好的地方</h2>
          {review.strengths?.length ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-md text-on-surface-variant">
              {review.strengths.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">这次没有特别突出的点，正常。</p>
          )}
        </Panel>

        {/* AI 输出：琥珀只留给竖条与标题，正文用 text-on-surface */}
        <Panel data-print="card" className="ai-inset gap-3">
          <h2 className="text-headline-sm text-secondary">下次可以改</h2>
          {review.improvements?.length ? (
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-md text-on-surface">
              {review.improvements.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface">暂时没有明显问题，可以提升强度再试一次。</p>
          )}
        </Panel>
      </div>

      {/* 逐题点评：按后端 InterviewQuestionReview 逐字段渲染 */}
      {questionReviews.length ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-headline-sm text-primary">逐题点评</h2>
          {questionReviews.map((item, index) => {
            // 后端主字段是 answer_summary；兼容兜底路径可能写 answer
            const yourAnswer = item.answer_summary || item.answer || ''
            const hasScore = typeof item.score === 'number'
            const score = item.score ?? 0
            return (
              <Panel key={index} data-print="card" padded={false} className="gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-headline-sm text-primary">
                    {index + 1}. {item.question}
                  </h3>
                  {/* 得分用 Badge 表达，不再是大号彩色数字（颜色语义保留：≥80 绿 / ≥60 常规 / <60 destructive） */}
                  {hasScore ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        'mt-0.5 shrink-0 px-2 py-0.5 text-label-md',
                        score >= 80
                          ? 'border-success/40 text-success'
                          : score >= 60
                            ? 'text-on-surface'
                            : 'border-destructive/40 text-destructive',
                      )}
                    >
                      {Math.round(score)} 分
                    </Badge>
                  ) : null}
                </div>

                {yourAnswer ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-caption-foreground">你的回答</span>
                    <p className="rounded-lg bg-surface-container-low px-4 py-2 text-body-md text-on-surface">
                      {yourAnswer}
                    </p>
                  </div>
                ) : null}

                {item.comment ? (
                  <p className="ai-inset rounded-lg bg-surface-container-low px-4 py-2 text-body-md text-on-surface">
                    {item.comment}
                  </p>
                ) : null}

                {item.better_answer ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-caption text-caption-foreground">更好的答法</span>
                    <p className="rounded-lg border border-dashed border-outline-variant/60 px-4 py-2 text-body-md text-on-surface-variant">
                      {item.better_answer}
                    </p>
                  </div>
                ) : null}
              </Panel>
            )
          })}
        </section>
      ) : null}

      <div className="flex justify-end">
        {/* 本页唯一实心主按钮 */}
        <Button variant="warm" size="lg" asChild>
          <Link to="/interview">再面一次</Link>
        </Button>
      </div>
    </PageShell>
  )
}
