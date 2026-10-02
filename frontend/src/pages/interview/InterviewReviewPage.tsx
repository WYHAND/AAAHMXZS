import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
 */
export default function InterviewReviewPage() {
  const { id } = useParams<{ id: string }>()
  const [review, setReview] = useState<InterviewReview | null>(null)
  const [loading, setLoading] = useState(true)

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
          description="面试结束后由后端生成，稍后刷新看看。"
          action={
            <Button variant="warm" onClick={() => void load()}>
              重新加载
            </Button>
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
      <Card data-print="card">
        <CardHeader>
          <CardTitle className="text-base">整体表现</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-baseline gap-2">
            <span className="font-numeric text-4xl font-semibold text-foreground">
              {Math.round(review.overall_score)}
            </span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </div>
          {dimensions.length ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={dimensions} outerRadius="72%">
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis
                    dataKey="dimension"
                    tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
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
          ) : (
            <p className="text-sm text-muted-foreground">维度数据还没生成。</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card data-print="card">
          <CardHeader>
            <CardTitle className="text-base">答得好的地方</CardTitle>
          </CardHeader>
          <CardContent>
            {review.strengths?.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                {review.strengths.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">这次没有特别突出的点，正常。</p>
            )}
          </CardContent>
        </Card>

        <Card data-print="card" className="ai-inset">
          <CardHeader>
            <CardTitle className="text-base text-accent-foreground">下次可以改</CardTitle>
          </CardHeader>
          <CardContent>
            {review.improvements?.length ? (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-accent-foreground/90">
                {review.improvements.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-accent-foreground/80">
                暂时没有明显问题，可以提升强度再试一次。
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 逐题点评：按后端 InterviewQuestionReview 逐字段渲染 */}
      {questionReviews.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-foreground">逐题点评</h2>
          {questionReviews.map((item, index) => {
            // 后端主字段是 answer_summary；兼容兜底路径可能写 answer
            const yourAnswer = item.answer_summary || item.answer || ''
            const hasScore = typeof item.score === 'number'
            const score = item.score ?? 0
            return (
              <Card key={index} data-print="card" className="gap-3 py-4">
                <CardHeader className="gap-2 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">
                      {index + 1}. {item.question}
                    </CardTitle>
                    {hasScore ? (
                      <span
                        className={cn(
                          'shrink-0 font-numeric text-lg font-semibold',
                          score >= 80
                            ? 'text-success'
                            : score >= 60
                              ? 'text-foreground'
                              : 'text-destructive',
                        )}
                      >
                        {Math.round(score)}
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 px-4">
                  {yourAnswer ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">你的回答</span>
                      <p className="rounded-lg bg-secondary px-4 py-2 text-sm text-secondary-foreground">
                        {yourAnswer}
                      </p>
                    </div>
                  ) : null}

                  {item.comment ? (
                    <p className="ai-inset rounded-lg bg-accent/50 px-4 py-2 text-sm text-accent-foreground">
                      {item.comment}
                    </p>
                  ) : null}

                  {item.better_answer ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">更好的答法</span>
                      <p className="rounded-lg border border-dashed px-4 py-2 text-sm text-muted-foreground">
                        {item.better_answer}
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </section>
      ) : null}

      <div className="flex justify-end">
        {/* 本页唯一实心主按钮 */}
        <Button variant="warm" asChild>
          <Link to="/interview">再面一次</Link>
        </Button>
      </div>
    </PageShell>
  )
}
