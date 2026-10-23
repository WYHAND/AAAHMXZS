import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Reveal } from '@/components/Motion'
import { Panel } from '@/components/Panel'
import { StageBadge } from '@/components/StageBadge'
import { Button } from '@/components/ui/button'
import { testApi } from '@/api/test'
import { toTestIntroRetest } from '@/constants/routes'
import { SCORE_ITEMS, type ScoreKey } from '@/constants/score'
import type { Stage } from '@/constants/stage'
import { useStage } from '@/hooks/useStage'
import { useProfileStore } from '@/store/profileStore'
import type { TestResult } from '@/types'
import { formatDate } from '@/utils/format'

/**
 * 测评结果（设计说明书 2.1 /test/result）
 *
 * 后端 TestResultResponse 字段：clarity_score / action_score / resume_score /
 * total_score / stage / created_at —— 没有 tags/summary/radar，
 * 所以这里只展示三项分数与阶段。画像标签不再对用户展示（产品决定，见 ProfilePage 顶部注释）。
 *
 * 2026-10 迭代 02：本页在 router/index.tsx 里是 **BlankLayout 的窄栏页**（448px 居中小列），
 *   所以**不套 PageShell 的 1040px 壳、不做两列**，整页是一列纵向卡片：
 *   1. 主角卡 = 阶段徽章 + 一句人话结论（你现在处在……，最该先做的是……）
 *      + **一个放大到 display(34) 的分数** + 唯一主 CTA；
 *   2. 支撑卡 = 另外两项分数（数字退到 headline-lg + 一句判断）；
 *   3. 日期与「重新测评」收在支撑卡底部的同一行。
 *   页头由主角卡的 h1（text-headline-xl）承担，宽度交给布局窄栏，页面里不再自己收窄。
 *
 * 2026-10-22 方案 A（一个主角 = 一个数字）：
 *   - 三个分数并列就没有主角，所以取**三项里最低的那一项**（= 这次先看的一块）
 *     放到 text-display，其余两项退到支撑卡用 headline-lg；
 *   - 赭金只落在这一个主角数字上，按钮保持墨色实心（与首页同一套行动色）；
 *   - 删掉与主 CTA 语义重复的「接下来我会先给你一件小事做」解读块：屏幕只留一个结论；
 *   - 高度账（390×844，BlankLayout 的 py-10 + 底部系统名约 120）：主角卡约 380 +
 *     间隙 20 + 支撑卡约 270 = 670，可用约 724 —— 一屏放得下，主 CTA 不会被推出屏幕。
 * 数据来源与跳转目标与改前一致：结果仍取 GET /test/result，主 CTA 仍回工作台。
 */

/** 唯一主 CTA 的文案（去向与改前一致：回工作台，那里才会给出真正的下一步） */
const HOME_CTA = '进入我的工作台'

/**
 * 每个阶段「最该先做的一件事」——只用于这一页的结论句，属于展示文案。
 * 为什么不复用 constants/stage.ts：那里的 STAGE_DESC 讲的是"这个阶段在忙什么"，
 * 这里要的是"下一步做什么"的动词短语，两者语义不同；constants 也不是本页的负责文件。
 */
const STAGE_FOCUS: Record<Stage, string> = {
  explore: '多试一件小事，把方向收窄一点',
  prepare: '把简历和项目讲清楚',
  sprint: '按面试官视角复盘表达',
}

/**
 * 这一页只给三个分项下判断 —— 综合分由上面那句总评承担，不在这里下结论。
 * （ScoreKey 含 total_score，但 SCORE_ITEMS 只有三项，页面也只会遍历到这三项。）
 */
type VerdictKey = Exclude<ScoreKey, 'total_score'>

/**
 * 分数翻译成人话：每个维度只按低 / 中 / 高三档给一句判断，不展示成报表。
 * 数值本身仍然诚实保留（它来自后端，不是编的）。
 */
const SCORE_VERDICT: Record<VerdictKey, [string, string, string]> = {
  clarity_score: [
    '方向还在雾里，先从多试一件小事开始。',
    '心里大概有方向了，还差一次确认。',
    '方向已经很清楚，接下来是把它讲实。',
  ],
  action_score: [
    '想得多、动手少，先迈出最小的一步就好。',
    '有想法，落到具体动作上还可以再快一点。',
    '想到的大多都动手了，保持这个节奏。',
  ],
  resume_score: [
    '简历还比较空，先补上两段真实经历。',
    '简历有了雏形，再把项目讲具体一点。',
    '简历拿得出手了，接下来是投递和面试。',
  ],
}

function verdictOf(key: VerdictKey, value: number): string {
  const tier = value >= 70 ? 2 : value >= 40 ? 1 : 0
  return SCORE_VERDICT[key][tier]
}

export default function TestResultPage() {
  const navigate = useNavigate()
  const setProfile = useProfileStore((s) => s.setProfile)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const profileFetched = useProfileStore((s) => s.fetched)
  const profileLoading = useProfileStore((s) => s.loading)
  const profileFailed = useProfileStore((s) => s.failed)
  const { stage, label } = useStage()
  const [result, setResult] = useState<TestResult | null>(null)
  const [loading, setLoading] = useState(true)
  /** 结果请求抛错：与「后端查无结果」区分开，这个态必须给原因 + 重试，不能静默空白 */
  const [failed, setFailed] = useState(false)

  /*
   * ⚠️ 本页现在挂在 router/index.tsx 的 **BlankLayout 段（不带守卫）**，所以这里自己补一次画像取数。
   *    为什么必须有：下面 load() 只在 **「查不到 result 记录」或「请求抛错」** 这两条分支里调
   *    fetchProfile()，正常有结果时**不会**碰画像 —— 而阶段徽章 / 描述读的是 profileStore.stage，
   *    在守卫缺席时没人替它取过，于是刷新这一页会显示**默认阶段（探索期）**而不是后端真实阶段。
   *    三态护栏与守卫同款（没取过才取、加载中不重复发、失败不自动重试），不会造成请求风暴。
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
      setFailed(false)
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
      // 请求失败：保留这次画像取数（守卫分流依赖它），同时把失败态显性化 ——
      // 以前这里只补取数、不置失败，页面会掉进"查无结果"的空态，把接口故障说成"你没测评"。
      setFailed(true)
      await fetchProfile()
    } finally {
      setLoading(false)
    }
  }, [fetchProfile, setProfile])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div data-print="main" className="flex w-full flex-col gap-6">
        <AIThinking text="正在算你的阶段…" lines={3} />
      </div>
    )
  }

  // 错误态：说清原因，给一个重试（不静默空白）
  if (failed) {
    return (
      <div data-print="main" className="flex w-full flex-col gap-6">
        <Reveal lg>
          <Panel className="gap-4">
            <h1 className="text-headline-xl font-bold tracking-tight text-primary">
              这次没读到你的测评结果
            </h1>
            <p className="text-body-md text-on-surface-variant">
              请求测评结果时出错了，多半是网络或服务临时抽风。你的作答没有丢，重试一下就好。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="motion-press self-start"
              onClick={() => void load()}
            >
              重新加载
            </Button>
          </Panel>
        </Reveal>
      </div>
    )
  }

  // 后端查无结果记录（不是错误）：说真话，给「回工作台 / 重做一次」两条路
  if (!result) {
    return (
      <div data-print="main" className="flex w-full flex-col gap-6">
        <Reveal lg>
          <EmptyState
            title="还没查到你的测评记录"
            description="这次测评可能还没提交成功。先回工作台看看，也可以重新做一次。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="motion-press"
                  onClick={() => navigate('/', { replace: true })}
                >
                  {HOME_CTA}
                </Button>
                <Button variant="ghost" size="sm" className="motion-press" asChild>
                  <Link to={toTestIntroRetest()}>重新测评</Link>
                </Button>
              </div>
            }
          />
        </Reveal>
      </div>
    )
  }

  // 维度中文 label 统一来自 constants/score.ts，数值取真实结果字段
  const metrics = SCORE_ITEMS.map((item) => ({
    // SCORE_ITEMS 只有三个分项，一定在 SCORE_VERDICT 的键里
    key: item.key as VerdictKey,
    label: item.label,
    value: Math.round(result[item.key] ?? 0),
  }))

  /*
   * 主角数字：取三项里**最低**的那一项 —— 这一屏的结论是"最该先做什么"，
   * 所以把最该补的一块放大，而不是把三个数字并列（并列等于没有主角）。
   * 三项同分时取 SCORE_ITEMS 的第一项，结果是确定的，不随渲染顺序抖动。
   */
  const weakest = metrics.reduce((low, item) => (item.value < low.value ? item : low), metrics[0])
  const others = metrics.filter((metric) => metric.key !== weakest.key)

  return (
    <div data-print="main" className="flex w-full flex-col gap-5">
      {/* 主角卡：阶段 + 一句人话结论 + 一个放大的分数 + 唯一主 CTA */}
      <Reveal lg>
        <Panel className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StageBadge stage={stage} showStepper />
            <span className="text-caption text-caption-foreground">这次测评算出来的</span>
          </div>

          <h1 className="text-headline-xl font-bold tracking-tight text-primary">
            你现在处在「{label}」
          </h1>
          <p className="text-body-lg text-on-surface-variant">最该先做的是：{STAGE_FOCUS[stage]}</p>

          {/* 全屏唯一的主角：这一项分数用 display(34)，赭金只给它一处 */}
          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="flex items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-caption text-caption-foreground">这次先看这一项</span>
                <span className="text-headline-sm text-primary">{weakest.label}</span>
              </div>
              <div className="flex shrink-0 items-baseline gap-1">
                <span className="text-display tabular-nums text-secondary">{weakest.value}</span>
                <span className="text-body-sm text-on-surface-variant">/100</span>
              </div>
            </div>
            <p className="text-body-sm text-on-surface-variant">
              {verdictOf(weakest.key, weakest.value)}
            </p>
          </div>

          <Button
            variant="warm"
            size="lg"
            className="motion-press w-full"
            onClick={() => navigate('/', { replace: true })}
          >
            {HOME_CTA}
          </Button>
        </Panel>
      </Reveal>

      {/* 支撑卡：另外两项（数字退到 headline-lg），日期与重测收在底边同一行 */}
      <Reveal delay={160}>
        <Panel className="gap-3">
          <h2 className="text-headline-md text-primary">另外两项，一起看更准</h2>

          <ul className="flex flex-col gap-4">
            {others.map((metric) => (
              <li key={metric.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-body-md font-medium text-primary">{metric.label}</span>
                  <span className="text-headline-lg tabular-nums text-primary">{metric.value}</span>
                </div>
                <p className="text-body-sm text-on-surface-variant">
                  {verdictOf(metric.key, metric.value)}
                </p>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-caption text-caption-foreground">
              测评时间：{formatDate(result.created_at)}
            </span>
            <Button variant="ghost" size="sm" className="motion-press" asChild>
              <Link to={toTestIntroRetest()}>重新测评</Link>
            </Button>
          </div>
        </Panel>
      </Reveal>
    </div>
  )
}
