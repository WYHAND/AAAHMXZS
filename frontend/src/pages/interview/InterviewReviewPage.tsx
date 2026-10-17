import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { EmptyState } from '@/components/EmptyState'
import { Reveal } from '@/components/Motion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/Panel'
import { PageShell } from '@/components/PageShell'
import { Stat, StatGroup } from '@/components/StatGroup'
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
 * 2026-10 收口（版式）：
 *   - 页头用 PageShell（面包屑「首页 › 模拟面试」），主 CTA「再面一次」放在页头动作区 ——
 *     复盘很长，钉在页尾等于永远看不见，进页头才在第一屏兑现「唯一的实心按钮」；
 *   - 两列 7/5：左列是 AI 点评主角卡（一句总评 + 逐题点评），
 *     右列是评分（StatGroup，琥珀只给「综合得分」一个数字）；
 *   - 一句总评用 text-headline-xl 当主角那句人话，和页头同级但不抢页头的 h1；
 *   - 评分翻译成人话：一句判断 + 一个分数，不堆成成绩单表格；
 *   - 「下次可以改」这类 AI 输出统一成 `ai-inset + <Panel inset> + 正文色`
 *     （浅桃只留给小面积强调，正文色必须是 `text-on-surface`）；
 *   - 琥珀稀缺：每屏 `text-secondary` ≤3 处 —— 「AI 点评」逐题小标不再用琥珀
 *     （那块左侧已有 ai-inset 琥珀竖条），琥珀只留给「下次可以改」与综合得分；
 *   - 复盘还没生成时用 AIThinking 说清"正在回看你刚才的回答"，不留转圈的空白。
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
        {/* 补生成期间也是"在回看你刚才的回答"，不能只剩一个转圈按钮 */}
        {generating ? (
          <AIThinking text="正在回看你刚才的回答，把点评整理出来…" lines={4} />
        ) : (
          <EmptyState
            title="这份复盘还没生成"
            description="如果这场面试还没结束（或者结束那一步没成功），点下面这个按钮，我立刻按你已经答的内容补一份复盘。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="warm"
                  size="lg"
                  className="motion-press"
                  onClick={() => void generate()}
                  disabled={generating}
                >
                  生成复盘
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="motion-press"
                  onClick={() => void load()}
                  disabled={generating}
                >
                  重新加载
                </Button>
              </div>
            }
          />
        )}
      </PageShell>
    )
  }

  // 维度名一律过中文映射（AI 偶发英文键时不能直接渲染）
  const dimensions: ProfileRadarItem[] = Object.entries(review.dimension_scores ?? {}).map(
    ([dimension, score]) => ({ dimension: interviewDimensionLabel(dimension), score }),
  )
  const questionReviews = (review.question_reviews ?? []).filter(
    (item): item is InterviewQuestionReview => Boolean(item),
  )
  // 只有真的打过分才显示分数：兜底复盘（AI 没生成出来）里 overall_score 是 0，
  // 把 0 当成"你考了 0 分"端出去是假信息。
  const hasScores = dimensions.length > 0

  return (
    <PageShell
      title="面试复盘"
      description="重点不是分数，是下次改哪两件事。"
      breadcrumb="模拟面试"
      actions={
        <Button variant="warm" size="lg" className="motion-press" asChild>
          <Link to="/interview">再面一次</Link>
        </Button>
      }
    >
      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* 左列（7）：AI 点评主角卡 —— 一句总评 + 逐题点评。大块进场用 rise-in-lg */}
        <Reveal lg className="lg:col-span-7">
          <Panel data-print="card" className="gap-6">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="size-[18px]" aria-hidden />
              <span className="text-headline-sm">AI 点评</span>
            </div>

            {/* 一句总评：AI 的原话直接当结论，用主角字号，不包进"成绩单"里 */}
            {review.summary ? (
              <p className="text-headline-xl text-primary">{review.summary}</p>
            ) : null}

            {/* 答得好的地方 */}
            <div className="flex flex-col gap-2">
              <span className="text-body-sm text-on-surface-variant">答得好的地方</span>
              {review.strengths?.length ? (
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-md text-on-surface">
                  {review.strengths.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-md text-on-surface-variant">这次没有特别突出的点，正常。</p>
              )}
            </div>

            {/* 下次可以改：AI 输出的唯一写法（ai-inset + Panel inset + 正文色） */}
            <Panel inset className="ai-inset">
              <span className="text-body-sm text-secondary">下次可以改</span>
              {review.improvements?.length ? (
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-md text-on-surface">
                  {review.improvements.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-body-md text-on-surface">
                  暂时没有明显问题，可以提升强度再试一次。
                </p>
              )}
            </Panel>

            {/* 逐题点评：按后端 InterviewQuestionReview 逐字段渲染。
                进场只做在「卡」这一层：整块随主角卡一起上浮，卡内每一项不再单独加动效 ——
                子项若与父卡同拍淡入会叠成重影，长滚动页也更该安静。 */}
            {questionReviews.length ? (
              <div className="flex flex-col gap-5">
                <span className="text-headline-sm text-primary">逐题点评</span>
                {questionReviews.map((item, index) => {
                  // 后端主字段是 answer_summary；兼容兜底路径可能写 answer
                  const yourAnswer = item.answer_summary || item.answer || ''
                  const hasScore = typeof item.score === 'number'
                  const score = item.score ?? 0
                  const content = (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-body-md font-semibold text-primary">
                          {index + 1}. {item.question}
                        </h3>
                        {/* 得分用 Badge 表达，不再是彩色大数字（颜色语义保留：≥80 绿 / ≥60 常规 / <60 destructive） */}
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
                          <span className="text-caption text-on-surface-variant">你的回答</span>
                          <Panel inset className="text-body-md text-on-surface">
                            {yourAnswer}
                          </Panel>
                        </div>
                      ) : null}

                      {item.comment ? (
                        <Panel inset className="ai-inset">
                          <span className="text-caption text-on-surface-variant">AI 点评</span>
                          <p className="text-body-md text-on-surface">{item.comment}</p>
                        </Panel>
                      ) : null}

                      {item.better_answer ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-caption text-on-surface-variant">更好的答法</span>
                          <p className="rounded-lg border border-dashed border-outline-variant/60 px-4 py-2.5 text-body-md text-on-surface-variant">
                            {item.better_answer}
                          </p>
                        </div>
                      ) : null}
                    </>
                  )
                  return (
                    <div
                      key={index}
                      className="flex flex-col gap-3 border-t border-outline-variant/40 pt-5 first:border-t-0 first:pt-0"
                    >
                      {content}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </Panel>
        </Reveal>

        {/* 右列（5）：评分 —— 一句判断 + 一个分数，琥珀只给综合得分 */}
        <Reveal delay={90} className="lg:col-span-5">
          <Panel data-print="card" className="gap-5">
            <div className="flex flex-col gap-1.5">
              <span className="text-headline-sm text-primary">这次考得怎么样</span>
              {hasScores ? (
                <p className="text-body-md text-on-surface-variant">
                  {scoreVerdict(Math.round(review.overall_score))}
                </p>
              ) : null}
            </div>

            {hasScores ? (
              <StatGroup columns={2}>
                <Stat
                  value={<AnimatedNumber value={Math.round(review.overall_score)} />}
                  unit="/100"
                  label="综合得分"
                  accent
                />
                {dimensions.map((dimension) => (
                  <Stat
                    key={dimension.dimension}
                    value={Math.round(dimension.score)}
                    label={dimension.dimension}
                  />
                ))}
              </StatGroup>
            ) : (
              <p className="text-body-md text-on-surface-variant">
                这次没有 AI 评分（点评这次没生成出来，左边只有按作答情况给的建议）。
              </p>
            )}
          </Panel>
        </Reveal>
      </div>
    </PageShell>
  )
}

/** 综合得分翻译成一句人话（不做成成绩单表格） */
function scoreVerdict(score: number): string {
  if (score >= 85) return '这场打得稳，细节再收一收就接近真实面试水平了。'
  if (score >= 70) return '整体在及格线以上，项目再讲深一点会更有说服力。'
  if (score >= 60) return '基本能答上，只是亮点没讲出来，下次先把结论前置。'
  return '这次答得偏紧，先把表达结构理顺，比堆内容更有效。'
}
