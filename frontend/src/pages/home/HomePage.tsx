import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lightbulb, MessageSquare, Sparkles } from 'lucide-react'

import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { NextActionButton } from '@/components/NextActionButton'
import { ProfileRadar } from '@/components/ProfileRadar'
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
import { homeApi } from '@/api/home'
import { normalizeStage } from '@/constants/stage'
import { toTaskDetail } from '@/constants/routes'
import { useResponsive } from '@/hooks/useResponsive'
import { useStage } from '@/hooks/useStage'
import { useChatStore } from '@/store/chatStore'
import { useProfileStore } from '@/store/profileStore'
import type { HomeSummary } from '@/types'
import { cn } from '@/lib/utils'

/**
 * 首页（设计说明书 3.2 ① 阶段化仪表盘）
 *
 * 模块结构：
 *   ① 今日一问（可空）   ② AI 发现（可空）   ③ 进行中的任务（最多 2 条）
 *   ④ 我的画像速览       ⑤ 下一步建议 —— **永远存在**
 *
 * 数据来自后端**后补实现**的聚合接口 GET /home/summary：
 *   stage / stage_label / profile{4 分数 + tested} / tags[] /
 *   daily_question / ai_findings[] / ongoing_tasks[] / next_action{text,route,reason}
 * next_action 是产品「AI 主动性」的落点，**前端不做推荐逻辑**（设计说明书 5.4）。
 */

export default function HomePage() {
  const navigate = useNavigate()
  const { isDesktop } = useResponsive()
  const { stage, label, fallbackCta } = useStage()
  const version = useProfileStore((s) => s.version)
  const setNextAction = useProfileStore((s) => s.setNextAction)

  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  /** 「让 AI 先开口」请求在途：三个空态共用一个状态，防止连点建出多个空会话 */
  const [opening, setOpening] = useState(false)
  /** 同步重入闸：state 要等下一次渲染才生效，同一拍内的第二次点击靠它拦住 */
  const openingRef = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await homeApi.summary()
      setSummary(data ?? null)
      setFailed(!data)
      // 后端下发的下一步建议缓存到 store，供顶栏与其它页面复用
      setNextAction(data?.next_action ?? null)
    } catch {
      setSummary(null)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [setNextAction])

  // 4.2：version 变化（打卡 / 对话结束 / 每日一问）后首页必须重新拉取
  useEffect(() => {
    void load()
  }, [load, version])

  /**
   * 三个空态统一的主动入口：**先让 AI 开口，再带用户进对话页**。
   *
   * 为什么不是简单跳 /chat：那样用户落地时看到的是一个空输入框，还得自己想话题 ——
   * 这正是产品要改掉的被动姿态。先 `newConversation()` 把空会话备好，
   * ChatPage 的 `useEffect([activeId])` 会紧接着 ensureOpening，
   * 所以用户抵达对话页时 AI 的第一个问题已经在路上了。
   *
   * `newConversation()` 失败返回 null（失败文案由 store 内部统一 toast）：
   * 这时**不导航**，页面原样保留，按钮在 finally 里恢复可点。
   */
  const handleLetAiSpeak = useCallback(async () => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    try {
      const conversationId = await useChatStore.getState().newConversation()
      if (conversationId) navigate('/chat')
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }, [navigate])

  // CTA：后端 next_action 优先，拿不到时回落到阶段固定文案
  const action = summary?.next_action
    ? { text: summary.next_action.text, route: summary.next_action.route, reason: summary.next_action.reason }
    : { text: fallbackCta.text, route: fallbackCta.route, reason: '' }

  const tags = summary?.tags ?? []
  const tasks = summary?.ongoing_tasks ?? []
  const daily = summary?.daily_question ?? null
  const findings = summary?.ai_findings ?? []
  const displayStage = normalizeStage(summary?.stage ?? stage)
  const displayLabel = summary?.stage_label ?? label

  return (
    <div data-print="main" className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">今天做一件小事就够了</h1>
          <p className="text-sm text-muted-foreground">
            当前阶段：{displayLabel} · 我会跟着你的进度调整建议
          </p>
        </div>
        <StageBadge stage={displayStage} showStepper />
      </header>

      {loading ? <AIThinking stage={stage} /> : null}

      {failed && !loading ? (
        <EmptyState
          title="工作台没加载出来"
          description="首页聚合接口没返回数据，稍后重试。"
          action={
            <Button variant="warm" onClick={() => void load()}>
              重新加载
            </Button>
          }
        />
      ) : null}

      {/* ① 今日一问（轻，一句话） */}
      <Card data-print="card" className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lightbulb className="size-4 text-ai-accent" />
            今日一问
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
          {daily ? (
            <>
              <p className="text-sm text-foreground">「{daily.content}」</p>
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/daily">{daily.answered ? '看看我的回答' : '随手答一句'}</Link>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                今天的问题还在生成，先去和我说说最近在忙什么也行。
              </p>
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/daily">去每日一问</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ② AI 发现（后端从痛点标签权重 Top3 来，暖色） */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Sparkles className="size-4 text-ai-accent" />
            AI 发现
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/profile">查看全部</Link>
          </Button>
        </div>
        {findings.length ? (
          <div className={isDesktop ? 'grid grid-cols-2 gap-4' : 'flex flex-col gap-3'}>
            {findings.map((finding) => (
              <Card key={finding.pain_point} data-print="card" className="ai-inset gap-2 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="text-sm text-accent-foreground">
                    {finding.label}
                  </CardTitle>
                  {finding.reason ? (
                    <CardDescription className="text-accent-foreground/80">
                      {finding.reason}
                    </CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="flex justify-end px-4">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={finding.target_route || '/chat'}>去看看</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            title="我还没看到你的卡点"
            description="让我先问你一句，你的回答会变成这里的第一条发现。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <AskAiButton pending={opening} onClick={() => void handleLetAiSpeak()} />
                <Button variant="ghost" asChild>
                  <Link to="/chat">和 AI 聊聊</Link>
                </Button>
              </div>
            }
          />
        )}
      </section>

      {/* ③ 进行中的任务（后端已限制最多 2 条） */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">进行中的任务</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/task">全部任务</Link>
          </Button>
        </div>
        {tasks.length ? (
          <div className="flex flex-col gap-3">
            {tasks.slice(0, 2).map((task) => {
              const percent = task.total_steps
                ? Math.round((task.done_steps / task.total_steps) * 100)
                : 0
              return (
                <Card key={task.id} data-print="card" className="gap-3 py-4">
                  <CardContent className="flex flex-col gap-2 px-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-foreground">{task.title}</span>
                      <span className="shrink-0 font-numeric text-xs text-muted-foreground">
                        {task.done_steps}/{task.total_steps} 步
                      </span>
                    </div>
                    <Progress value={percent} className="h-1.5" />
                    {task.current_step_title ? (
                      <p className="text-xs text-muted-foreground">
                        当前：{task.current_step_title}
                      </p>
                    ) : null}
                    <div className="flex justify-end">
                      <Button variant="outline" size="sm" asChild>
                        <Link to={toTaskDetail(task.id)}>继续</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <EmptyState
            title="现在没有进行中的任务"
            description="任务要有对话结论才能生成，我先问你第一个问题。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <AskAiButton pending={opening} onClick={() => void handleLetAiSpeak()} />
                <Button variant="ghost" asChild>
                  <Link to="/task">去任务列表看看</Link>
                </Button>
              </div>
            }
          />
        )}
      </section>

      {/* ④ 我的画像速览（六轴画像雷达）。标签不给用户看：见 ProfilePage 的产品决定注释 */}
      <Card data-print="card">
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">我的画像速览</CardTitle>
            <CardDescription>
              综合分 {Math.round(summary?.profile.total_score ?? 0)}，只有一份数据，不跟别人比
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/profile">完善画像</Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ProfileRadar
            tags={tags}
            empty={
              /* 画像空态：保留事实（画像是聊出来的、测评会给一份初始画像），
                 但必须带一个可点的动作，不能停在纯告知 */
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">
                  画像要靠聊天一点点长出来，做完基础测评也会有一份初始画像。我先问你第一个问题。
                </p>
                <AskAiButton
                  pending={opening}
                  size="sm"
                  onClick={() => void handleLetAiSpeak()}
                />
              </div>
            }
          />
          {summary && !summary.profile.tested ? (
            <p className="text-xs text-warning">
              还没做过基础测评，做完之后画像会更准。
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ⑤ 下一步建议：整屏唯一大按钮，永远存在（3.2 ① 模块⑤，文案由后端下发） */}
      <Card data-print="card" className="items-center gap-3 py-6 text-center">
        <CardContent className="flex w-full flex-col items-center gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MessageSquare className="size-4" />
            下一步建议
          </p>
          <p className="text-base text-foreground">{action.text}</p>
          {action.reason ? (
            <p className={cn('max-w-md text-xs text-muted-foreground')}>{action.reason}</p>
          ) : null}
          <NextActionButton text={action.text} to={action.route} />
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * 空态里的统一主动入口「让 AI 先开口」。
 *
 * 三个空态（AI 发现 / 进行中的任务 / 画像）共用同一个组件，
 * 保证同一屏里不会出现三种不同说法的同一个动作。
 *
 * 用色纪律：固定 `outline`。整屏唯一的实心 bg-primary 按钮是底部
 * 「下一步建议」（NextActionButton），空态不能再抢一个实心按钮。
 * `pending` 由父级传入（请求在途时 disabled），点不动就不会建出第二个空会话。
 */
function AskAiButton({
  pending,
  size = 'default',
  onClick,
}: {
  pending: boolean
  size?: 'default' | 'sm'
  onClick: () => void
}) {
  return (
    <Button variant="outline" size={size} disabled={pending} onClick={onClick}>
      {pending ? '正在让 AI 开口…' : '让 AI 先开口'}
    </Button>
  )
}
