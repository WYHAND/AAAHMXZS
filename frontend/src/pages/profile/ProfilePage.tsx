import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, RotateCcw } from 'lucide-react'

import { AIThinking } from '@/components/AIThinking'
import { BadgeMedallion } from '@/components/BadgeMedallion'
import { ProfileRadar } from '@/components/ProfileRadar'
import { StageBadge } from '@/components/StageBadge'
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
import { Separator } from '@/components/ui/separator'
import { PageShell } from '@/components/PageShell'
import { badgeApi } from '@/api/badge'
import { STAGE_DESC } from '@/constants/stage'
import { SCORE_ITEMS } from '@/constants/score'
import { toTestIntroRetest, toTestResume } from '@/constants/routes'
import { useStage } from '@/hooks/useStage'
import { useProfileStore } from '@/store/profileStore'
import type { BadgeItem, BadgeOverview } from '@/types'
import { remainingSteps } from '@/utils/badge'
import { formatDate, formatDateTime } from '@/utils/format'
import { STORAGE_KEY, storage } from '@/utils/storage'
import { cn } from '@/lib/utils'

/** 后端 hint 缺字段时的兜底（旧形状不会有 hint），永远是中文 */
function badgeHint(badge: BadgeItem): string {
  if (badge.hint) return badge.hint
  return badge.obtained ? '留着它，这是你走过这段路的证明。' : '继续做任务，这枚就快到手了。'
}

/**
 * 个人中心 / 画像（设计说明书 2.1 /profile、4.2 version 失效）
 *
 * 后端 Profile 字段：clarity_score / action_score / resume_score / total_score /
 * stage / tested / tags[]（tag 文案字段是 label，不是 name）/ user。
 * 画像写端点只有 POST /profile/feedback，**前端已不再调用**（见下面的产品决定）。
 *
 * ⚠️ tag.source 是英文枚举（test/chat/resume/interview/daily/task），
 *    一旦有渲染点必须过中文映射，不能直接显示英文。
 *
 * Fix C（render-check bug #1）：接上 GET /badge，做一个**轻量**奖章区块
 * （手册 1.5：P1 只保留「一个轻量奖章（完成第一个任务）」，明确砍掉了奖章墙）。
 * Fix D3：给出「重新测评」入口（TestIntroPage 只认 ?retest=1）。
 *
 * 2026-xx 重做「我的奖章」：从「名称小标签 + 一行空态灰字」换成三槽位奖章区
 * （BadgeMedallion 画大尺寸金属奖章）。响应形状收口在 utils/badge.ts：
 * 新契约是 BadgeOverview 对象，后端改造未落地时旧裸数组也能降级渲染。
 *
 * 2026-xx 「能力雷达」→「画像雷达」：轴从三项分数换成画像的**六个维度**
 * （实现只在 components/ProfileRadar.tsx，首页共用同一份）。那三项分数没有消失，
 * 仍留在上面「当前阶段」卡片的三根进度条里（见下面 scoreRows）。
 */
export default function ProfilePage() {
  const { stage, label } = useStage()
  const version = useProfileStore((s) => s.version)
  const profile = useProfileStore((s) => s.profile)
  const tags = useProfileStore((s) => s.tags)
  const loading = useProfileStore((s) => s.loading)
  const tested = useProfileStore((s) => s.tested)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const [ready, setReady] = useState(false)
  const [overview, setOverview] = useState<BadgeOverview | null>(null)
  const [badgesLoaded, setBadgesLoaded] = useState(false)
  const [badgesFailed, setBadgesFailed] = useState(false)
  const [hasTestProgress, setHasTestProgress] = useState(false)

  const load = useCallback(async () => {
    await fetchProfile()
    try {
      setOverview(await badgeApi.list())
      setBadgesFailed(false)
    } catch {
      setOverview(null)
      setBadgesFailed(true)
    } finally {
      setBadgesLoaded(true)
    }
    setReady(true)
  }, [fetchProfile])

  useEffect(() => {
    void load()
  }, [load, version])

  useEffect(() => {
    setHasTestProgress(
      Boolean(storage.session.get<unknown>(STORAGE_KEY.testProgress, null)),
    )
  }, [])

  // 「当前阶段」卡片里那三根进度条：方向清晰度 / 行动力 / 简历完整度。
  // 中文 label 统一来自 constants/score.ts（不要在这里写第二套）。
  const scoreRows = profile
    ? SCORE_ITEMS.map((item) => ({
        dimension: item.label,
        score: profile[item.key] ?? 0,
      }))
    : []

  // ⚠️ 顺序完全沿用后端（门槛从低到高），这里不排序
  const badges: BadgeItem[] = overview?.items ?? []

  return (
    <PageShell
      title="个人中心"
      description="这里是你自己的画像，只有一份数据，不跟别人比。"
      breadcrumb="个人中心"
      actions={
        <>
          {hasTestProgress ? (
            <Button variant="outline" size="sm" asChild>
              <Link to={toTestResume()}>继续上次答题</Link>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link to={toTestIntroRetest()}>
              <RotateCcw className="size-3.5" />
              重新测评
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/chat">完善画像</Link>
          </Button>
        </>
      }
    >
      {!ready || (loading && !profile) ? <AIThinking text="正在读你的画像…" lines={3} /> : null}

      <Card data-print="card">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">当前阶段</CardTitle>
            <CardDescription>{STAGE_DESC[stage]}</CardDescription>
          </div>
          <StageBadge stage={stage} showStepper />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {profile ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-numeric text-4xl font-semibold text-foreground">
                  {Math.round(profile.total_score)}
                </span>
                <span className="text-sm text-muted-foreground">/ 100 综合分</span>
              </div>

              <div className="flex flex-col gap-3">
                {scoreRows.map((item) => (
                  <div key={item.dimension} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-muted-foreground">
                      {item.dimension}
                    </span>
                    <Progress value={item.score} className="h-1.5 flex-1" />
                    <span className="w-10 shrink-0 text-right font-numeric text-sm text-foreground">
                      {Math.round(item.score)}
                    </span>
                  </div>
                ))}
              </div>

              {!tested ? (
                <p className="text-xs text-warning">
                  还没有做过基础测评，做完之后画像会更准。
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  方向清晰度来自基础测评；继续打卡和聊天，上面的画像雷达会跟着变，想重测随时可以。
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">画像还没读到，稍后刷新试试。</p>
          )}
        </CardContent>
      </Card>

      {/* 奖章区：三槽位并排（窄屏纵向堆叠）。未获得也是「铸模」态，不留整块空白 */}
      <Card data-print="card">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="size-4 text-ai-accent" />
              我的奖章
            </CardTitle>
            <CardDescription>做任务、答题、完善画像，一枚一枚点亮它们。</CardDescription>
          </div>
          {badges.length ? (
            <Badge variant="outline" className="shrink-0 gap-1 rounded-full font-numeric">
              {overview?.obtained_count ?? badges.filter((badge) => badge.obtained).length}
              <span className="text-muted-foreground">/ {overview?.total ?? badges.length}</span>
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {badges.length ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {badges.map((badge) => (
                <article
                  key={badge.key}
                  className={cn(
                    'flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-5 text-center',
                    badge.obtained ? 'border-medal-ring/50' : 'bg-muted/30',
                  )}
                >
                  <BadgeMedallion badge={badge} />
                  <div className="flex flex-col gap-1">
                    <p
                      className={cn(
                        'text-sm font-medium',
                        badge.obtained ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {badge.name}
                    </p>
                    {badge.description ? (
                      <p className="text-xs text-muted-foreground">{badge.description}</p>
                    ) : null}
                  </div>
                  <p className="text-xs text-balance text-muted-foreground">{badgeHint(badge)}</p>
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        badge.obtained ? 'bg-medal-gold' : 'bg-muted-foreground/50',
                      )}
                    />
                    {badge.obtained ? (
                      <span className="font-numeric text-xs text-muted-foreground">
                        获得于 {formatDate(badge.obtained_at)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        还差 {remainingSteps(badge.progress)} 个步骤
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : badgesFailed ? (
            <p className="text-sm text-muted-foreground">奖章没读到，稍后刷新试试。</p>
          ) : badgesLoaded ? (
            // 极端兜底：后端返回了空列表（正常情况下恒为三枚槽位）
            <p className="text-sm text-muted-foreground">奖章还在铸造，过一会儿再来看看。</p>
          ) : (
            <p className="text-sm text-muted-foreground">正在读你的奖章…</p>
          )}
        </CardContent>
      </Card>

      <Card data-print="card">
        <CardHeader>
          <CardTitle className="text-base">画像雷达</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileRadar
            tags={tags}
            empty={
              <p className="text-sm text-muted-foreground">
                还没有雷达数据。和我聊两轮，或者完成一个任务，这里就会长出来。
              </p>
            }
          />
        </CardContent>
      </Card>

      {/*
        产品决定：画像标签**整块不给用户看**（原来的「我的标签」卡片连认可/否定按钮一并删除）。
        请不要"顺手加回来"。三个理由：
          1. 标签里有诊断式/负面标签（痛点/拖延、焦虑/中、认知/模糊），
             展示等于告诉用户"我们给你打了个诊断"，而且是负面的；
          2. 百分比是**内部置信度**（AI 对这条判断的把握），不是用户的得分，
             端出去像在给用户打分；
          3. 标签词本身是分类术语（认知/清晰、能力/执行），不是人话。
        结论：标签是**给机器看的中间产物**，用户侧不可见。用户要纠正 AI 的理解，
        只能通过**继续对话**（原来的认可/否定入口已按用户要求一并移除）。
        注意后端仍在用这些标签：生成任务用「痛点」、画像雷达用「维度」、推荐用「兴趣/技能」，
        所以 profile.tags 这份数据本身保留（`GET /profile`、store、types 结构都不动），
        本页上面的「画像雷达」继续拿它作为输入，只是不再逐条渲染标签名与权重。

        随之失效的死代码已一并清掉（唯一调用点就是这个卡片和它的按钮）：
        handleFeedback 回调、store 的 feedback action、api 的 profileApi.feedback、
        ProfileFeedbackPayload 类型，以及只为标签来源提示服务的
        constants/profile.ts（tagSourceLabel / TAG_SOURCE_LABEL，整个文件）。
        别为了"把标签显示回来"重新引入这些——那等于把这个产品决定撤销。
      */}

      <Separator />

      <p className="text-xs text-muted-foreground">
        画像最近更新：{formatDateTime(profile?.updated_at)} · 阶段：{label}
      </p>
    </PageShell>
  )
}
