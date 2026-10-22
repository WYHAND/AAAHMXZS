import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, ChevronDown, RotateCcw } from 'lucide-react'

import { AIThinking } from '@/components/AIThinking'
import { AnimatedNumber } from '@/components/AnimatedNumber'
import { BadgeMedallion } from '@/components/BadgeMedallion'
import { BadgeScene } from '@/components/BadgeScene'
import { EmptyState } from '@/components/EmptyState'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import { ProfileTagSphere } from '@/components/ProfileTagSphere'
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
import { groupTags, GROUP_LIMIT, SPHERE_MIN_TAGS, visibleTags } from '@/utils/profileDisplay'
import { STORAGE_KEY, storage } from '@/utils/storage'
import { cn } from '@/lib/utils'

/**
 * 个人中心 / 画像（T06：一屏一个主角 + 统一卡片）
 *
 * 版式自上而下：
 * 1. 主角：画像概览 —— 最大的一张卡，阶段徽章 + 一句人话总结 + 26px 综合分 + **唯一一条进度条**
 *    （综合分，值一变从左长出来）+ **唯一一个实心 CTA**（放在卡内，不再挂在页头）；
 *    三个维度刻度条收进「看分数明细」，默认收起（首屏留给人话与那条进度条）；
 * 2. 我的奖章：整行；
 * 3. 「我的画像」（7 列，球体当主角）+「画像雷达」（5 列）—— 勘误 9.24：
 *    画像卡是一面"你是什么样的用户"的镜子：上=标题+一句人物速写（后端生成、落库缓存），
 *    中=标签球（TagCloud.js，只负责感觉），下=可读的三行（喜欢的事 / 会做的事 / 做事的风格）。
 *    展示层的过滤与排序规则在 `utils/profileDisplay.ts`：只影响渲染，
 *    不动数据、不影响 AI 输入与奖章判定。
 *
 * 动效（2026-10-12 迭代）：语汇只从 index.css「统一动效语汇」与 components/Motion.tsx 里取。
 * - 进场：主角 <Reveal lg>（640ms），两列各自错峰（140/290ms）；
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
 * 奖章走 badgeApi.list（GET /badge）。标签的 source 现在**不再展示**（9.24：
 * 那条"标了出处"的文案与它不符，见勘误 9.24.2），所以这里不再需要中文映射。
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
  /**
   * 奖章架当前选中的那一枚。`null` 只表示「用户还没点过」——
   * 渲染时由 `BadgesPanel` 兜底成**第一枚**，所以左列永远有详情、不会出现空引导态。
   */
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
                    ? '方向清晰度来自基础测评，继续打卡和聊天，下面的雷达会跟着变。'
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

          {/*
            ② 我的画像 | ③ 画像雷达（2026-10-18 上移：这两块才是"我是谁"，
            原来的顺序是奖章在前、画像在后，首屏只能看到奖章，画像要滚一屏才出现）。
            - 画像卡拿 7 列（≈600px）：球体要呼吸空间；
            - 两卡**视觉等高** —— grid 的 align-items 默认就是 stretch。
          */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Reveal delay={140} className="min-w-0 lg:col-span-7">
              <ProfileCard
                summary={profile.summary}
                tags={tags}
                updatedAt={profile.updated_at}
              />
            </Reveal>

            <Reveal delay={250} className="min-w-0 lg:col-span-5">
              <Panel data-print="card" className="h-full gap-4">
                <div className="flex flex-col gap-1.5">
                  <h2 className="text-headline-sm text-primary">画像雷达</h2>
                  <p className="text-body-sm text-on-surface-variant">
                    看的是你聊过的内容分布，不是分数；哪一项靠外都不代表好或差。
                  </p>
                </div>
                <ProfileRadar
                  tags={tags}
                  fill
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
          </div>

          {/* ④ 我的奖章：整行；左边文字区（标题 / 描述 / 选中勋章详情），右边三枚勋章横排。
              勋章是"收进来的东西"，放在画像之后，作为这一页的收尾。 */}
          <Reveal delay={360}>
            <BadgesPanel
              overview={overview}
              loaded={badgesLoaded}
              failed={badgesFailed}
              openKey={openBadge}
              onOpenKeyChange={setOpenBadge}
            />
          </Reveal>
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
 * 我的奖章（2026-xx 排版重构）：
 *
 * 从「窄栏竖排 chip + 点开后摊在下面」改成**整行横排**：
 * - **左列**（约 1/3）是文字区：标题 + 一句话描述 + **选中勋章的详情**（原来是摊在卡片下面的）；
 * - **右列**（约 2/3）是**三枚勋章横排**（后端正好三个槽位），点某一枚：选中态高亮，
 *   详情出现在左列下方。
 *
 * **永远有一枚是选中的**：进页面就默认选中第一枚（门槛最低的那枚），
 * 点已选中的那一枚**不收起**（曾经「再点一次收起」，左列会退回一句引导话 ——
 * 于是用户一进页面看到的是一块空面板，这个态已经删掉）。
 *
 * 信息一个都没丢 —— 卡片上：小奖章 / 名称 / 状态；左列详情：name / description /
 * hint / 获得日期 / 还差几步 / 进度，全部给全。
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
  /**
   * 实际选中的 key：用户点过的优先，否则**兜底第一枚**。
   * 兜底放在这里而不是 state 里，是为了不依赖「数据什么时候到」——
   * 初次加载、切号、失败重试，只要有三枚奖章，左列就一定渲染出一枚的详情。
   */
  const activeKey =
    openKey && badges.some((badge) => badge.key === openKey) ? openKey : (badges[0]?.key ?? null)
  const openBadge = badges.find((badge) => badge.key === activeKey) ?? null

  return (
    <Panel data-print="card">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* 左：文字区（标题 / 描述 / 选中详情） */}
        <div className="flex flex-col gap-3 lg:col-span-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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
            <div
              id="badge-detail"
              className="flex flex-1 flex-col justify-center rounded-lg bg-surface-container-low p-3.5"
            >
              {/* `badges` 非空 ⇒ activeKey 兜底成第一枚 ⇒ openBadge 必非空，无需空态分支 */}
              {openBadge ? <BadgeDetail badge={openBadge} /> : null}
            </div>
          ) : null}
        </div>

        {/* 右：三枚勋章横排 + 下面那一格「奖章小剧场」 */}
        {badges.length ? (
          <div className="flex h-full min-w-0 flex-col gap-3 lg:col-span-8">
            <BadgeShelf badges={badges} openKey={activeKey} onOpenKeyChange={onOpenKeyChange} />
            {/*
              这一格原本是**纯空白**（实测 660×202）：三张卡只占上半截，下半截露着面板底。
              现在放当前选中那枚的动画小剧场（key 让它换奖章时重新起播）。
            */}
            {openBadge ? (
              <div className="flex min-h-[176px] flex-1 items-center justify-center overflow-hidden rounded-lg bg-surface-container-low px-4 py-3">
                <BadgeScene key={openBadge.key} badge={openBadge} className="h-full w-full" />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-body-md text-on-surface-variant lg:col-span-8">
            {failed
              ? '奖章没读到，稍后刷新试试。'
              : loaded
                ? '奖章还在铸造，过一会儿再来看看。'
                : '正在读你的奖章…'}
          </p>
        )}
      </div>
    </Panel>
  )
}

/**
 * 勋章陈列：**三枚横排**（窄屏竖排）。每枚是一张竖版小卡（奖章 + 名称 + 状态），
 * 点选后选中态高亮，详情渲染在左侧文字区（`#badge-detail`）。
 * **点已选中的那一枚不会取消选中**（组里始终有一枚选中，不存在「都没选」的态）。
 * 中性 bg-surface-container —— 卡内小卡不要用 bg-card（那是「同屏两种卡片」的来源）。
 */
function BadgeShelf({
  badges,
  openKey,
  onOpenKeyChange,
}: {
  badges: BadgeItem[]
  /** 当前选中的奖章 key（由 `BadgesPanel` 兜底后传入，不会是 null —— 除非一枚奖章都没有） */
  openKey: string | null
  onOpenKeyChange: (key: string | null) => void
}) {
  return (
    <ul className="grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-3">
      {badges.map((badge) => {
        const isOpen = badge.key === openKey
        return (
          <li key={badge.key} className="min-w-0">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls="badge-detail"
              onClick={() => onOpenKeyChange(badge.key)}
              className={cn(
                'motion-lift motion-press flex h-full w-full flex-col items-center gap-2.5 rounded-lg px-3 py-4 text-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                isOpen
                  ? 'bg-primary-soft ring-1 ring-primary/30'
                  : 'bg-surface-container hover:bg-surface-container-high',
              )}
            >
              <BadgeMedallion badge={badge} size={44} />
              {/* 名称 15px：陈列品的标签，用更轻的字重，不抢区块标题 */}
              <span className="text-body-lg font-medium leading-6 text-primary">{badge.name}</span>
              {/* 状态行用次要文字色（caption 灰在中性底上只有 4.17，不够 4.5） */}
              <span className="text-caption text-on-surface-variant" title={badgeHint(badge)}>
                {badge.obtained ? '已获得' : '还差 ' + remainingSteps(badge.progress) + ' 个步骤'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 单枚勋章的详情（渲染在左侧文字区）：默认 112px 大奖章 + 名称 + 描述 + 出处 + 进度。
 * 展开态本来就是这个信息量，重构只是把它从「卡片下方」搬到「左侧文字区」。
 */
function BadgeDetail({ badge }: { badge: BadgeItem }) {
  return (
    <div className="flex flex-col items-center gap-3.5 text-center">
      <BadgeMedallion badge={badge} />
      <div className="flex flex-col gap-1.5">
        <p className="text-headline-md text-primary">{badge.name}</p>
        {badge.description ? (
          <p className="text-body-md text-on-surface-variant">{badge.description}</p>
        ) : null}
      </div>
      <p className="max-w-[46ch] text-body-sm text-balance text-on-surface-variant">
        {badgeHint(badge)}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-body-sm">
        <span
          className={cn(
            'flex items-center gap-2',
            badge.obtained ? 'text-primary' : 'text-secondary',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              badge.obtained ? 'bg-medal-gold' : 'bg-caption-foreground',
            )}
          />
          {badge.obtained
            ? '获得于 ' + formatDate(badge.obtained_at)
            : '还差 ' + remainingSteps(badge.progress) + ' 个步骤'}
        </span>
        <span className="text-caption text-on-surface-variant">
          进度 {badge.progress.current} / {badge.progress.target}
        </span>
      </div>
    </div>
  )
}

/**
 * 「我的画像」：上=你是谁、中=标签球、下=可读的三行（勘误 9.24.4）。
 *
 * 这是**展示层**的卡片，只读 `profile.summary` 与 `profile.tags`：
 * - 顶部那句「你是个什么样的人」由后端生成并落库（AI 不可用时是模板句），
 *   前端不在这里拼第二套文案 —— 两处各写一份必然分叉；
 * - 中间球体只负责"感觉"（背面看不见、一直在转、很难点中），可读的那份在下方；
 * - 过滤与排序规则全部在 `utils/profileDisplay.ts`（那里写明"只影响渲染"）。
 */
function ProfileCard({
  summary,
  tags,
  updatedAt,
}: {
  summary: string
  tags: ProfileTag[]
  updatedAt: string
}) {
  const visible = useMemo(() => visibleTags(tags), [tags])
  const groups = useMemo(() => groupTags(tags), [tags])
  const labels = useMemo(() => visible.map((tag) => tag.label), [visible])

  return (
    <Panel data-print="card" className="h-full gap-5">
      {/* 区域 1：你是谁（标题 + 一句人物速写） */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-headline-sm text-primary">我的画像</h2>
        {summary ? (
          <p className="text-body-lg text-on-surface">{summary}</p>
        ) : (
          <p className="text-body-sm text-on-surface-variant">
            还在认识你 —— 多聊两句，这里会慢慢具体起来。
          </p>
        )}
      </div>

      {visible.length ? (
        <>
          {/* 区域 2：标签球。标签太少时不画 —— 稀疏的球面比列表还难看，
              所以阈值与理由写在 utils/profileDisplay.ts 的 SPHERE_MIN_TAGS */}
          {labels.length >= SPHERE_MIN_TAGS ? (
            <ProfileTagSphere
              labels={labels}
              className="h-[360px] w-full [&_.profile-sphere-item]:whitespace-nowrap [&_.profile-sphere-item]:text-body-sm [&_.profile-sphere-item]:text-on-surface"
            />
          ) : null}

          {/* 区域 3：可读的三行（与球体同一份顺序，每组最多 GROUP_LIMIT 条） */}
          <div className="flex flex-col gap-2.5 border-t border-outline-variant/40 pt-4">
            {groups.map((group) => {
              const shown = group.tags.slice(0, GROUP_LIMIT)
              const rest = group.tags.length - shown.length
              return (
                <div key={group.name} className="flex items-baseline gap-3">
                  <span className="w-[68px] shrink-0 text-caption text-on-surface-variant">
                    {group.name}
                  </span>
                  <span className="text-body-sm text-on-surface-variant">
                    {shown.map((tag) => tag.label).join(' · ')}
                    {rest > 0 ? ` 共 ${group.tags.length} 条` : ''}
                  </span>
                </div>
              )
            })}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <span className="text-caption text-caption-foreground">
                最近更新 · {formatDate(updatedAt)}
              </span>
              <span className="text-caption text-caption-foreground">
                这些是我从你的对话、测评和任务里一点点记下来的。
              </span>
            </div>
          </div>
        </>
      ) : tags.length ? (
        // 有标签、但都被"可见维度"过滤掉了：文案必须说真话，不能套零值空态
        <EmptyState
          title="这块还在长"
          description="你聊过的内容我都记下了，只是还没攒出能放进这里的样子 —— 再多聊几轮就有了。"
          action={
            <Button variant="outline" size="sm" asChild className="motion-press">
              <Link to="/chat">继续聊聊</Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          title="画像还没长出来"
          description="和我聊两轮，或者做完基础测评，这里就会一点点具体起来。"
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
