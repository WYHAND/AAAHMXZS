import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, ChevronDown, RotateCcw } from 'lucide-react'

import { AIThinking } from '@/components/AIThinking'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { BadgeMedallion } from '@/components/BadgeMedallion'
import { EmptyState } from '@/components/EmptyState'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import { ProfileRadar } from '@/components/ProfileRadar'
import { Reveal, staggerDelay } from '@/components/Motion'
import { StageBadge } from '@/components/StageBadge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { badgeApi } from '@/api/badge'
import { SCORE_ITEMS } from '@/constants/score'
import { STAGE_DESC } from '@/constants/stage'
import { toTestIntroRetest, toTestResume } from '@/constants/routes'
import { useStage } from '@/hooks/useStage'
import { useProfileStore } from '@/store/profileStore'
import type { BadgeItem, BadgeOverview, ProfileTag } from '@/types'
import { remainingSteps } from '@/utils/badge'
import { formatDate, formatDateTime } from '@/utils/format'
import { STORAGE_KEY, storage } from '@/utils/storage'
import { cn } from '@/lib/utils'

/**
 * 个人中心 / 画像（T06：一屏一个主角 + 统一卡片）
 *
 * 版式自上而下：
 * 1. 主角：画像概览 —— 最大的一张卡，阶段徽章 + 一句人话总结 + 26px 综合分 + **唯一一条进度条**
 *    （综合分，值一变从左长出来）+ **唯一一个实心 CTA**（放在卡内，不再挂在页头）；
 *    三个维度刻度条收进「看分数明细」，默认收起（首屏留给人话与那条进度条）；
 * 2. 两列 7/5 支撑：左「画像雷达」（全站唯一 recharts），右「我的奖章」+「画像标签」；
 * 3. 画像标签：每条标签旁边说清它来自哪里（测评 / 对话 / 任务），不再只列裸标签。
 *
 * 动效（2026-10-12 迭代）：语汇只从 index.css「统一动效语汇」与 components/Motion.tsx 里取。
 * - 进场：主角 <Reveal lg>（320ms），两列各自错峰（80/160ms）；
 * - 数值条：综合分那条进度条挂 `grow-x`（从左长出来）；
 * - 交互反馈：可点按钮 `motion-press`，奖章 chip `motion-lift`；
 * - 明细里的三行刻度用 `staggerDelay` 错峰——它只在用户点开那一刻播，
 *   与页面进场不重叠，不会出现「同屏多处一起动」。
 *
 * 卡片纪律：全页只有一种卡片外观与一种内边距 —— 卡片一律 Panel（20px），
 * 卡内浅底块一律 Panel inset（bg-surface-container-low，14px）；奖章 chip 用中性
 * bg-surface-container，不再拿 bg-card 当卡内小卡（那是「同屏两种卡片」的来源）。
 *
 * 数据来源与接口调用一个没变：画像走 store.fetchProfile（GET /profile），
 * 奖章走 badgeApi.list（GET /badge）。tag.source 是英文枚举（test/chat/resume/
 * interview/daily/task），渲染前必须过中文映射，不能直接显示英文。
 */
export default function ProfilePage() {
  const { stage } = useStage()
  const version = useProfileStore((s) => s.version)
  const profile = useProfileStore((s) => s.profile)
  const tags = useProfileStore((s) => s.tags)
  const loading = useProfileStore((s) => s.loading)
  const failed = useProfileStore((s) => s.failed)
  const tested = useProfileStore((s) => s.tested)
  const fetchProfile = useProfileStore((s) => s.fetchProfile)
  const [ready, setReady] = useState(false)
  const [overview, setOverview] = useState<BadgeOverview | null>(null)
  const [badgesLoaded, setBadgesLoaded] = useState(false)
  const [badgesFailed, setBadgesFailed] = useState(false)
  const [hasTestProgress, setHasTestProgress] = useState(false)
  /** 「看分数明细」：默认收起 —— 首屏要留给人话与雷达，不是三根刻度条 */
  const [scoreOpen, setScoreOpen] = useState(false)
  /** 奖章架当前**点开**的那一枚（null = 全员保持 chip 小方块） */
  const [openBadge, setOpenBadge] = useState<string | null>(null)

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

  const showInitialLoading = !ready || (loading && !profile)
  const showProfileError = failed && !profile

  return (
    <PageShell
      title="个人中心"
      description="这里是你自己的画像，只有一份数据，不跟别人比。"
      breadcrumb="个人中心"
      actions={
        <>
          {/*
            页头只留次按钮（outline / sm）：整屏唯一的实心主 CTA 在下面主角卡里
            （契约三.1「最大的那张卡承担主要行动」），页头再放一个大按钮就是两个主行动。
          */}
          {hasTestProgress ? (
            <Button variant="outline" size="sm" asChild className="motion-press">
              <Link to={toTestResume()}>继续上次答题</Link>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild className="motion-press gap-1.5">
            <Link to={toTestIntroRetest()}>
              <RotateCcw className="size-3.5" />
              重新测评
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="motion-press">
            <Link to="/chat">完善画像</Link>
          </Button>
        </>
      }
    >
      {showInitialLoading ? <AIThinking text="正在读你的画像…" lines={3} /> : null}

      {/* 错误态：说清原因并给一个重试，不允许静默空白 */}
      {showProfileError ? (
        <EmptyState
          title="画像没读到"
          description="画像接口这次没返回数据，可能是网络波动或后端在忙，重试一下就好。"
          action={
            <Button variant="outline" size="sm" onClick={() => void load()} className="motion-press">
              重新加载
            </Button>
          }
        />
      ) : null}

      {profile ? (
        <>
          {/* ① 主角：画像概览（阶段 + 一句人话 + 唯一进度条 + 唯一实心 CTA） */}
          <Reveal lg>
            <Panel data-print="card" className="gap-5">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
                <div className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-headline-sm text-primary">当前阶段</h2>
                    <StageBadge stage={stage} showStepper />
                  </div>
                  <p className="max-w-[46ch] text-body-lg text-on-surface-variant">
                    {STAGE_DESC[stage]}
                  </p>
                </div>
                <div className="flex items-baseline gap-2">
                  <AnimatedNumber
                    value={Math.round(profile.total_score)}
                    className="font-numeric text-headline-xl font-bold text-primary"
                  />
                  <span className="text-body-md text-on-surface-variant">/ 100 综合分</span>
                </div>
              </div>

              {/* 全页唯一一条进度条：综合分。值一变就从左长出来（grow-x）。 */}
              <div className="flex flex-col gap-2.5">
                <Progress
                  value={Math.round(profile.total_score)}
                  aria-label={`综合分 ${Math.round(profile.total_score)} 分，满分 100`}
                  className="grow-x h-1.5 bg-surface-container"
                />
                <p className="text-body-sm text-on-surface-variant">
                  {tested
                    ? '方向清晰度来自基础测评，继续打卡和聊天，上面的雷达会跟着变。'
                    : '还没做过基础测评，做完之后画像会更准。'}
                </p>
              </div>

              <Collapsible open={scoreOpen} onOpenChange={setScoreOpen}>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="motion-press -ml-3 gap-0 text-on-surface-variant"
                    >
                      {scoreOpen ? '收起分数明细' : '看分数明细'}
                      <ChevronDown
                        className={cn('size-4 transition-transform', scoreOpen && 'rotate-180')}
                        aria-hidden
                      />
                    </Button>
                  </CollapsibleTrigger>
                  {/* 整屏唯一的实心主 CTA：一个明确的「下一步」，就落在主角卡里 */}
                  <Button variant="warm" size="lg" asChild className="motion-press gap-2">
                    <Link to="/task">继续今天的任务</Link>
                  </Button>
                </div>
                <CollapsibleContent>
                  <div className="flex flex-col gap-3 pb-1 pt-3">
                    {/* 明细只在用户点开时出现，错峰播一次，不与页面进场重叠 */}
                    {scoreRows.map((item, index) => (
                      <Reveal key={item.dimension} delay={staggerDelay(index)}>
                        <div className="flex items-center gap-3">
                          <span className="w-24 shrink-0 text-body-sm text-on-surface-variant">
                            {item.dimension}
                          </span>
                          <Progress
                            value={item.score}
                            aria-label={item.dimension + ' ' + Math.round(item.score) + ' 分'}
                            className="h-1.5 flex-1 bg-surface-container"
                          />
                          <span className="w-10 shrink-0 text-right text-body-md tabular-nums text-primary">
                            {Math.round(item.score)}
                          </span>
                        </div>
                      </Reveal>
                    ))}
                    <p className="text-body-sm text-caption-foreground">
                      三个维度都是你自己给自己的分，随打卡、答题和聊天一点点长。
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Panel>
          </Reveal>

          {/* ② 两列 7/5 支撑：雷达（左）/ 奖章 + 标签（右） */}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
            <Reveal delay={80} className="lg:col-span-7">
              <Panel data-print="card" className="gap-4">
                <div className="flex flex-col gap-1.5">
                  <h2 className="text-headline-sm text-primary">画像雷达</h2>
                  <p className="text-body-sm text-on-surface-variant">
                    看的是你聊过的内容分布，不是分数；哪一项靠外都不代表好或差。
                  </p>
                </div>
                <ProfileRadar
                  tags={tags}
                  empty={
                    <EmptyState
                      title="雷达还没长出来"
                      description="和我聊两轮，或者完成一个小任务，这里就有形状了。"
                      action={
                        <Button variant="outline" size="sm" asChild className="motion-press">
                          <Link to="/chat">去聊聊</Link>
                        </Button>
                      }
                    />
                  }
                />
              </Panel>
            </Reveal>

            <Reveal delay={160} className="flex min-w-0 flex-col gap-6 lg:col-span-5">
              <BadgesPanel
                overview={overview}
                loaded={badgesLoaded}
                failed={badgesFailed}
                openKey={openBadge}
                onOpenKeyChange={setOpenBadge}
              />
              {/* ③ 画像标签：每条都说清出处，不列裸标签 */}
              <TagsPanel tags={tags} />
            </Reveal>
          </div>
        </>
      ) : !failed && ready ? (
        <BadgesPanel
          overview={overview}
          loaded={badgesLoaded}
          failed={badgesFailed}
          openKey={openBadge}
          onOpenKeyChange={setOpenBadge}
        />
      ) : null}

      {profile ? (
        <p className="text-caption text-on-surface-variant">
          画像最近更新：{formatDateTime(profile.updated_at)}
        </p>
      ) : null}
    </PageShell>
  )
}

/* ------------------------------ 奖章 ------------------------------ */

/**
 * 我的奖章：默认一组小方块（chip：30px 小奖章 + 名称 + 状态/还差几步），
 * 摆在 Panel inset 的浅底架子上（窄栏内单列排布，名称不折行）；点某一枚才在下面摊开大章。
 *
 * 信息一个都没丢 —— chip 上：名称 / 状态；展开态：name / description / hint /
 * 获得日期 / 还差几步 / 进度，全部给全。
 */
function BadgesPanel({
  overview,
  loaded,
  failed,
  openKey,
  onOpenKeyChange,
}: {
  overview: BadgeOverview | null
  loaded: boolean
  failed: boolean
  openKey: string | null
  onOpenKeyChange: (key: string | null) => void
}) {
  // ⚠️ 顺序完全沿用后端（门槛从低到高），这里不排序
  const badges: BadgeItem[] = overview?.items ?? []
  const obtainedCount = overview?.obtained_count ?? badges.filter((item) => item.obtained).length
  const totalCount = overview?.total ?? badges.length

  return (
    <Panel data-print="card" className="gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="flex items-center gap-2 text-headline-sm text-primary">
            <Award className="size-4 text-secondary" aria-hidden />
            我的奖章
          </h2>
          {badges.length ? (
            <span className="rounded-full bg-secondary-fixed px-2.5 py-0.5 text-caption font-medium tabular-nums text-on-secondary-fixed">
              已获得 {obtainedCount} / {totalCount}
            </span>
          ) : null}
        </div>
        <p className="text-body-sm text-on-surface-variant">
          做任务、答题、完善画像，一枚一枚点亮它们。
        </p>
      </div>

      {badges.length ? (
        <BadgeShelf badges={badges} openKey={openKey} onOpenKeyChange={onOpenKeyChange} />
      ) : failed ? (
        <p className="text-body-md text-on-surface-variant">奖章没读到，稍后刷新试试。</p>
      ) : loaded ? (
        // 极端兜底：后端返回了空列表（正常情况下恒为三枚槽位）
        <p className="text-body-md text-on-surface-variant">奖章还在铸造，过一会儿再来看看。</p>
      ) : (
        <p className="text-body-md text-on-surface-variant">正在读你的奖章…</p>
      )}
    </Panel>
  )
}

/**
 * 奖章架：默认一组 chip（30px 小奖章 + 名称 + 状态），点开一枚才摊开大章；窄栏里单列排布。
 * chip 用中性 bg-surface-container（不是 bg-card）——卡内小卡是「同屏两种卡片」的来源。
 */
function BadgeShelf({
  badges,
  openKey,
  onOpenKeyChange,
}: {
  badges: BadgeItem[]
  /** 当前点开的奖章 key（null = 全部保持 chip） */
  openKey: string | null
  onOpenKeyChange: (key: string | null) => void
}) {
  const openBadge = badges.find((badge) => badge.key === openKey) ?? null

  return (
    <div className="flex flex-col gap-4">
      <Panel as="ul" inset className="grid grid-cols-1 gap-2.5">
        {badges.map((badge) => {
          const isOpen = badge.key === openKey
          return (
            <li key={badge.key}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls="badge-detail"
                onClick={() => onOpenKeyChange(isOpen ? null : badge.key)}
                className={cn(
                  // 用**显式网格** auto | 1fr 排「章 + 文字」：flex-grow 版实测会把文字列压到 60px，
                  // 名称被挤成两行；网格给出确定的列宽，窄屏也一行放得下。
                  'motion-lift motion-press grid h-full w-full grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-0.5 rounded-lg px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                  isOpen
                    ? 'bg-primary-soft ring-1 ring-primary/30'
                    : 'bg-surface-container hover:bg-surface-container-high',
                )}
              >
                <BadgeMedallion badge={badge} size={30} className="row-span-2" />
                {/* 名称 15px：陈列品的标签，用更轻的字重，不抢区块标题 */}
                <span className="text-body-lg font-medium leading-6 text-primary">
                  {badge.name}
                </span>
                {/* 状态行承载信息，用次要文字色（caption 灰在 chip 的中性底上只有 4.17，不够 4.5） */}
                <span
                  className="truncate text-caption text-on-surface-variant"
                  title={badgeHint(badge)}
                >
                  {badge.obtained ? '已获得' : '还差 ' + remainingSteps(badge.progress) + ' 个步骤'}
                </span>
              </button>
            </li>
          )
        })}
      </Panel>

      {openBadge ? (
        <div id="badge-detail">
          <Reveal fade>
            <Panel inset className="items-center gap-3.5 text-center">
              <BadgeMedallion badge={openBadge} />
              <div className="flex flex-col gap-1.5">
                {/* 展开态是这一枚的「主角」，名称用 headline-md(18/600) 一档 */}
                <p className="text-headline-md text-primary">{openBadge.name}</p>
                {openBadge.description ? (
                  <p className="text-body-md text-on-surface-variant">{openBadge.description}</p>
                ) : null}
              </div>
              <p className="max-w-[46ch] text-body-sm text-balance text-on-surface-variant">
                {badgeHint(openBadge)}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-body-sm">
                <span
                  className={cn(
                    'flex items-center gap-2',
                    openBadge.obtained ? 'text-primary' : 'text-secondary',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      openBadge.obtained ? 'bg-medal-gold' : 'bg-caption-foreground',
                    )}
                  />
                  {openBadge.obtained
                    ? '获得于 ' + formatDate(openBadge.obtained_at)
                    : '还差 ' + remainingSteps(openBadge.progress) + ' 个步骤'}
                </span>
                <span className="text-caption text-on-surface-variant">
                  进度 {openBadge.progress.current} / {openBadge.progress.target}
                </span>
              </div>
            </Panel>
          </Reveal>
        </div>
      ) : null}
    </div>
  )
}

/** 收起时先给几个标签（超过这个数才出现「展开全部」） */
const TAG_PREVIEW_COUNT = 8

/** 一条标签 = 名字 + 出处（出处走下面的中文映射，后端 source 是英文枚举） */
function TagChip({ tag }: { tag: ProfileTag }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-body-sm text-on-surface">
      {tag.label}
      <span className="text-caption text-on-surface-variant">{tagSourceHint(tag.source)}</span>
    </span>
  )
}

/**
 * 画像标签：**默认收起的胶囊云**。
 *
 * 为什么不是一行一条：标签会越攒越多（几十个很常见），一行一条会拖成一条长长的竖栏，
 * 卡片高度也不可控。换成 flex-wrap 的胶囊后，同样多的标签只占几行。
 *
 * 展开也不能无限长：先给 TAG_PREVIEW_COUNT 个，剩下的收进可折叠区；
 * 展开后那一块**限高内部滚动** —— 数据一条不少（折叠不等于藏数据），
 * 但卡片高度有上限，不会一点开就顶出去一整屏。
 */
function TagsPanel({ tags }: { tags: ProfileTag[] }) {
  const [open, setOpen] = useState(false)
  const preview = tags.slice(0, TAG_PREVIEW_COUNT)
  const rest = tags.slice(TAG_PREVIEW_COUNT)

  return (
    <Panel data-print="card" className="gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-headline-sm text-primary">画像标签</h2>
        <p className="text-body-sm text-on-surface-variant">
          这些是我从你的对话、测评和任务里一点点记下来的，每一条都标了出处。
        </p>
      </div>

      {tags.length ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {preview.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>

          {rest.length ? (
            <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1">
              <CollapsibleContent>
                <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto pr-1 pb-1">
                  {rest.map((tag) => (
                    <TagChip key={tag.id} tag={tag} />
                  ))}
                </div>
              </CollapsibleContent>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="motion-press -ml-3 gap-0 self-start text-on-surface-variant"
                >
                  {open ? '收起' : `展开全部 ${tags.length} 条`}
                  <ChevronDown
                    className={cn('size-4 transition-transform', open && 'rotate-180')}
                    aria-hidden
                  />
                </Button>
              </CollapsibleTrigger>
            </Collapsible>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="还没有标签"
          description="多和我聊几句，或者做完基础测评，这里会一条条长出来。"
          action={
            <Button variant="outline" size="sm" asChild className="motion-press">
              <Link to="/chat">和 AI 聊聊</Link>
            </Button>
          }
        />
      )}
    </Panel>
  )
}

/* ------------------------------ 文案 ------------------------------ */

/** 后端 hint 缺字段时的兜底（旧形状不会有 hint），永远是中文 */
function badgeHint(badge: BadgeItem): string {
  if (badge.hint) return badge.hint
  return badge.obtained ? '留着它，这是你走过这段路的证明。' : '继续做任务，这枚就快到手了。'
}

/** 画像标签来源 → 一句人话（取值见 types/index.ts 的 ProfileTag.source 注释） */
const TAG_SOURCE_HINT: Record<string, string> = {
  test: '来自基础测评',
  chat: '来自对话',
  resume: '来自简历',
  interview: '来自模拟面试',
  daily: '来自每日一问',
  task: '来自成长任务',
}

function tagSourceHint(source: string): string {
  return TAG_SOURCE_HINT[source] ?? '来自你的成长记录'
}
