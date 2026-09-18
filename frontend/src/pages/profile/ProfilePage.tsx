import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from 'recharts'
import { Award, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { toast } from 'sonner'

import { AIThinking } from '@/components/AIThinking'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageShell } from '@/components/PageShell'
import { badgeApi } from '@/api/badge'
import { STAGE_DESC } from '@/constants/stage'
import { toTestIntroRetest, toTestResume } from '@/constants/routes'
import { useStage } from '@/hooks/useStage'
import { useProfileStore } from '@/store/profileStore'
import type { ProfileRadarItem, UserBadge } from '@/types'
import { formatDate, formatDateTime } from '@/utils/format'
import { normalizeList } from '@/utils/list'
import { STORAGE_KEY, storage } from '@/utils/storage'

/**
 * 个人中心 / 画像（设计说明书 2.1 /profile、4.2 version 失效）
 *
 * 后端 Profile 字段：clarity_score / action_score / resume_score / total_score /
 * stage / tested / tags[]（tag 文案字段是 label，不是 name）/ user。
 * 画像写端点只有 POST /profile/feedback（标签认可/否定），不弹采集表单。
 *
 * Fix C（render-check bug #1）：接上 GET /badge，做一个**轻量**奖章区块
 * （手册 1.5：P1 只保留「一个轻量奖章（完成第一个任务）」，明确砍掉了奖章墙）。
 * Fix D3：给出「重新测评」入口（TestIntroPage 只认 ?retest=1）。
 */
export default function ProfilePage() {
  const { stage, label } = useStage()
  const version = useProfileStore((s) => s.version)
  const profile = useProfileStore((s) => s.profile)
  const tags = useProfileStore((s) => s.tags)
  const loading = useProfileStore((s) => s.loading)
  const tested = useProfileStore((s) => s.tested)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const feedback = useProfileStore((s) => s.feedback)
  const [ready, setReady] = useState(false)
  const [badges, setBadges] = useState<UserBadge[]>([])
  const [badgesLoaded, setBadgesLoaded] = useState(false)
  const [hasTestProgress, setHasTestProgress] = useState(false)

  const load = useCallback(async () => {
    await fetchProfile()
    try {
      setBadges(normalizeList(await badgeApi.list()))
    } catch {
      setBadges([])
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

  const radar: ProfileRadarItem[] = profile
    ? [
        { dimension: '方向清晰度', score: profile.clarity_score },
        { dimension: '行动力', score: profile.action_score },
        { dimension: '简历准备度', score: profile.resume_score },
      ]
    : []

  const handleFeedback = async (tagId: string, approved: boolean) => {
    const ok = await feedback({ tag_id: tagId, approved })
    if (!ok) {
      toast.error('提交失败，稍后再试')
      return
    }
    toast.success(approved ? '已记下，我会更信这条' : '已记下，我会降低它的权重')
  }

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
                {radar.map((item) => (
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
                  测评结果会随你的打卡与对话持续更新，想重测随时可以。
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">画像还没读到，稍后刷新试试。</p>
          )}
        </CardContent>
      </Card>

      {/* 奖章（Fix C）：轻量展示，不做奖章墙 */}
      <Card data-print="card">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="size-4 text-ai-accent" />
              我的奖章
            </CardTitle>
            <CardDescription>完成第一个任务就能拿到第一枚</CardDescription>
          </div>
          {badges.length ? (
            <Badge variant="outline" className="shrink-0 rounded-full font-numeric">
              {badges.length}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {badges.length ? (
            <div className="flex flex-wrap gap-2">
              {badges.map((badge) => (
                <Tooltip key={badge.id}>
                  <TooltipTrigger asChild>
                    <span className="flex items-center gap-2 rounded-full border border-ai-accent/40 bg-accent px-3 py-1.5 text-sm text-accent-foreground">
                      <Award className="size-3.5" />
                      {badge.name}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    获得于 {formatDate(badge.obtained_at)}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          ) : badgesLoaded ? (
            <p className="text-sm text-muted-foreground">
              还没有奖章。去任务列表做一个小任务，完成第一步就能拿到。
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">正在读你的奖章…</p>
          )}
        </CardContent>
      </Card>

      <Card data-print="card">
        <CardHeader>
          <CardTitle className="text-base">能力雷达</CardTitle>
          <CardDescription>只有一个系列，主色 + 20% 透明填充</CardDescription>
        </CardHeader>
        <CardContent>
          {radar.length && profile ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radar} outerRadius="72%">
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
            <p className="text-sm text-muted-foreground">
              还没有雷达数据。和我聊两轮，或者完成一个任务，这里就会长出来。
            </p>
          )}
        </CardContent>
      </Card>

      <Card data-print="card">
        <CardHeader>
          <CardTitle className="text-base">我的标签</CardTitle>
          <CardDescription>标签来自你的真实行为，认可与否会调整权重</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {tags.length ? (
            tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="shrink-0 rounded-full">
                        {tag.dimension}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>来源：{tag.source}</TooltipContent>
                  </Tooltip>
                  <span className="truncate text-sm text-foreground">{tag.label}</span>
                  <span className="shrink-0 font-numeric text-xs text-muted-foreground">
                    {Math.round(tag.weight * 100)}%
                  </span>
                </div>
                <div data-print="hide" className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="这条标签准"
                    onClick={() => void handleFeedback(tag.id, true)}
                  >
                    <ThumbsUp className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="这条标签不准"
                    onClick={() => void handleFeedback(tag.id, false)}
                  >
                    <ThumbsDown className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">标签还没长出来，先不急。</p>
          )}
        </CardContent>
      </Card>

      <Separator />

      <p className="text-xs text-muted-foreground">
        画像最近更新：{formatDateTime(profile?.updated_at)} · 阶段：{label}
      </p>
    </PageShell>
  )
}
