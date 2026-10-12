import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import { StageBadge } from '@/components/StageBadge'
import { Stat, StatGroup } from '@/components/StatGroup'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { testApi } from '@/api/test'
import { SCORE_ITEMS } from '@/constants/score'
import { STAGE_LABEL } from '@/constants/stage'
import { useProfileStore } from '@/store/profileStore'
import { useStage } from '@/hooks/useStage'
import type { TestResult } from '@/types'
import { formatDate } from '@/utils/format'

/**
 * 测试结果（设计说明书 2.1 /test/result）
 *
 * 后端 TestResultResponse 字段：clarity_score / action_score / resume_score /
 * total_score / stage / created_at —— **没有 tags/summary/radar**，
 * 所以这里展示三项分数 + 阶段。
 * 画像标签不再对用户展示（产品决定，见 ProfilePage 顶部注释），这里也不要再引导用户去看标签。
 *
 * 2026-10 收口：本页过去是全站唯一没有页骨架的页面（裸渲在 RequireAuth 下，内容铺满整屏、
 * 没有 h1、下半屏 350px 空白）。现在改用 PageShell（1040px + h1 26/700），
 * 结构收敛成「一句结论 → 三个数字 → （收起）分数明细 → AI 一句话 → 唯一主 CTA」，
 * 字号只用语义阶（headline-xl / headline-sm / body-md / body-sm / caption）。
 */
/**
 * 本页唯一主 CTA 的收口类名。
 * ⚠️ 为什么不是光写 size="lg"：共享的 `components/ui/button.tsx` 里 lg 是
 *    `rounded-md(6px) + text-base(16px/500)`，而 2026-10 规格要求
 *    **44px / 圆角 12 / 15px·600**。button.tsx 不在本页的改造范围内（属于共享层），
 *    所以在页面这一层补上圆角与字号字重，视觉规格先到位；
 *    等共享层把 lg 改成 12/15·600 后，这两句 utility 会被覆盖成同一个值，可直接删。
 */
const PRIMARY_CTA = 'w-full rounded-xl text-[15px] font-semibold'

export default function TestResultPage() {
  const navigate = useNavigate()
  const setProfile = useProfileStore((s) => s.setProfile)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const profileFetched = useProfileStore((s) => s.fetched)
  const profileLoading = useProfileStore((s) => s.loading)
  const profileFailed = useProfileStore((s) => s.failed)
  const { stage, desc } = useStage()
  const [result, setResult] = useState<TestResult | null>(null)
  const [loading, setLoading] = useState(true)

  /*
   * ⚠️ 本页现在挂在 router/index.tsx 的 **BlankLayout 段（不带守卫）**，所以这里自己补一次画像取数。
   *    为什么必须有：下面 load() 只在 **「查不到 result 记录」或「请求抛错」** 这两条分支里调
   *    fetchProfile()，正常有结果时**不会**碰画像 —— 而阶段徽章 / 描述读的是 profileStore.stage，
   *    在守卫缺席时没人替它取过，于是刷新这一页会显示**默认阶段（探索期）**而不是后端真实阶段。
   *    三态护栏与守卫同款（没取过才取、加载中不重复发、失败不自动重试），不会造成请求风暴。
   *    另一个已知修复：本页是"测完提交后"的落点，此前刷新它会因 profileStore 未 fetch 被守卫判成
   *    「没做过测评」而弹回 /test/intro —— 那段注释里写的正是这个坑。
   */
  useEffect(() => {
    if (!profileFetched && !profileLoading && !profileFailed) {
      void fetchProfile()
    }
  }, [profileFetched, profileLoading, profileFailed, fetchProfile])

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

  // 维度中文 label 统一来自 constants/score.ts
  const metrics = result
    ? SCORE_ITEMS.map((item) => ({ label: item.label, value: result[item.key] ?? 0 }))
    : []

  return (
    <PageShell
      title="你的当前阶段"
      breadcrumb="测评结果"
      badge={<StageBadge stage={stage} showStepper />}
      description={desc}
    >
      <Panel className="gap-5">
        {result ? (
          <>
            {/* 主角：一句结论式标题（数据全部来自 TestResultResponse，不编造字段） */}
            <h2 className="text-headline-sm text-primary sm:text-headline-md">
              你现在的阶段是「{STAGE_LABEL[stage]}」，这是这次测评算出来的结果
            </h2>

            <StatGroup columns={3}>
              {metrics.map((metric, i) => (
                <Stat
                  key={metric.label}
                  value={Math.round(metric.value)}
                  label={metric.label}
                  accent={i === 0}
                  divided={i > 0}
                />
              ))}
            </StatGroup>

            {/* 三条分项明细默认收起，避免首屏堆两套同样的数字 */}
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="px-0">
                  看这次的分数明细
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="flex flex-col gap-3">
                  {metrics.map((metric) => (
                    <div key={metric.label} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-body-sm text-on-surface-variant">
                        {metric.label}
                      </span>
                      <Progress value={metric.value} className="h-1.5 flex-1" />
                      <span className="w-10 shrink-0 text-right text-body-sm font-medium text-primary tabular-nums">
                        {Math.round(metric.value)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="pt-3 text-caption text-caption-foreground">
                  测评时间：{formatDate(result.created_at)}
                </p>
              </CollapsibleContent>
            </Collapsible>
          </>
        ) : (
          <EmptyState
            title="这次没能读到你的测评明细"
            description="没读到这次的测评明细，可以先进入工作台，画像会在个人中心展示。"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/', { replace: true })}>
                进入我的工作台
              </Button>
            }
          />
        )}

        {/* AI 输出面板的唯一写法：ai-inset（左 3px 琥珀竖条）+ 卡内浅底 */}
        {result ? (
          <>
            <div className="ai-inset rounded-lg bg-surface-container-low px-4 py-3 text-body-md text-on-surface">
              接下来我会先给你一件小事做，不用一次想清楚所有事。
            </div>

            {/* 本屏唯一主 CTA */}
            <Button
              variant="warm"
              size="lg"
              className={PRIMARY_CTA}
              onClick={() => navigate('/', { replace: true })}
            >
              进入我的工作台
            </Button>
          </>
        ) : null}
      </Panel>
    </PageShell>
  )
}
