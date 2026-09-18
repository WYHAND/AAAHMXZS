import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { AIThinking } from '@/components/AIThinking'
import { StageBadge } from '@/components/StageBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { testApi } from '@/api/test'
import { useProfileStore } from '@/store/profileStore'
import { useStage } from '@/hooks/useStage'
import type { TestResult } from '@/types'
import { formatDate } from '@/utils/format'

/**
 * 测试结果（设计说明书 2.1 /test/result）
 *
 * 后端 TestResultResponse 字段：clarity_score / action_score / resume_score /
 * total_score / stage / created_at —— **没有 tags/summary/radar**，
 * 所以这里展示三项分数 + 阶段，画像标签去个人中心看。
 */
export default function TestResultPage() {
  const navigate = useNavigate()
  const setProfile = useProfileStore((s) => s.setProfile)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const { stage, desc } = useStage()
  const [result, setResult] = useState<TestResult | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await testApi.result()
      setResult(data ?? null)
      if (data?.stage) {
        // 结果页刷新时也要让守卫认为「已测评」，否则会被弹回 /test/intro
        setProfile({
          stage: data.stage,
          clarity_score: data.clarity_score,
          action_score: data.action_score,
          resume_score: data.resume_score,
          total_score: data.total_score,
          updated_at: data.created_at,
        })
      } else {
        // 没有结果记录：拉一次画像，交给守卫决定去向
        await fetchProfile()
      }
    } catch {
      await fetchProfile()
    } finally {
      setLoading(false)
    }
  }, [fetchProfile, setProfile])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <AIThinking text="正在算你的阶段…" lines={3} />

  const metrics = result
    ? [
        { label: '方向清晰度', value: result.clarity_score },
        { label: '行动力', value: result.action_score },
        { label: '简历准备度', value: result.resume_score },
      ]
    : []

  return (
    <Card className="shadow-pop">
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">你的当前阶段</CardTitle>
          <StageBadge stage={stage} showStepper />
        </div>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {result ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="font-numeric text-4xl font-semibold text-foreground">
                {Math.round(result.total_score)}
              </span>
              <span className="text-sm text-muted-foreground">/ 100 综合分</span>
            </div>

            <div className="flex flex-col gap-3">
              {metrics.map((metric) => (
                <div key={metric.label} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">
                    {metric.label}
                  </span>
                  <Progress value={metric.value} className="h-1.5 flex-1" />
                  <span className="w-10 shrink-0 text-right font-numeric text-sm text-foreground">
                    {Math.round(metric.value)}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              测评时间：{formatDate(result.created_at)}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            没读到这次的测评明细，可以先进入工作台，画像会在个人中心展示。
          </p>
        )}

        <div className="ai-inset rounded-lg bg-accent/50 px-4 py-3 text-sm text-accent-foreground">
          接下来我会先给你一件小事做，不用一次想清楚所有事。
        </div>

        <Button
          variant="warm"
          size="lg"
          className="w-full"
          onClick={() => navigate('/', { replace: true })}
        >
          进入我的工作台
        </Button>
      </CardContent>
    </Card>
  )
}
