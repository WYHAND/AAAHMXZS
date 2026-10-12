import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, ChevronDown, RotateCcw } from 'lucide-react'

import { AIThinking } from '@/components/AIThinking'
import { BadgeMedallion } from '@/components/BadgeMedallion'
import { Panel } from '@/components/Panel'
import { ProfileRadar } from '@/components/ProfileRadar'
import { StageBadge } from '@/components/StageBadge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
 * 2026-10 收口（A2 视觉改造，**一屏一个主角**）：
 *  ① 「奖章架」：三枚大金属奖章原本占满首屏约 700px，现在默认只在 `Panel inset`
 *     的浅底架子上摆**一行 chip**（30px 小奖章 + 名称 + 状态/还差几步），
 *     点某一枚或「看全部」才在下面展开大章（`BadgeShelf` 的 hovered/openKey 本地 state）。
 *     展开态把 name / description / hint / 获得日期 / 还差几步**一个不少**地给全；
 *     chip 上的 12px 状态行是 caption，不是正文。
 *  ② 「综合分」降级：36px → **26px**（headline-xl 档），旁边一句 STAGE_DESC（已有数据）的人话；
 *     三根维度刻度条（SCORE_ITEMS，中文 label 全保留）收进「看分数明细」`Collapsible`，默认收起。
 *  ③ PageShell 的 actions 里加**唯一主 CTA**「继续今天的任务」→ `/task`（真路由，
 *     路由表见 router/index.tsx 的 TaskListPage），原来的三个入口同时降级为 `outline size="sm"`。 *  ④ 画像雷达排到奖章与分数之后（内容顺序 = 阶段/分数 → 奖章架 → 雷达）。
 *  ⑤ 字号收口：原来的「31 处 12px」按语义拆开 —— 正文/字段值 `text-body-md`(14)、
 *     说明 `text-body-sm`(13)、纯 caption `text-caption`(12)；14px 数字不再配 `font-numeric`
 *     （等宽只留给 26px 的综合分）。旧类名 `text-muted-foreground` / `bg-muted/30`
 *     一并换成新 token（`text-on-surface-variant` / `bg-surface-container-low`）。
 *
 * 字号档位为什么是这样（骨架是 12/13/14/15/16/18/26，**拒绝**全页挤在 12–14）：
 * 面包屑 12 · 架子上 chip 的状态行 12 · 计数 chip 12 · 页脚 12（都是 caption）；
 * 说明性长句 13 · 分数条 label 13；正文/字段值/CTA 14（含窄屏的奖章名）；
 * 主 CTA 15；区块标题 16/600（当前阶段 / 我的奖章 / 画像雷达）；
 * **奖章名 18/500**（`sm` 以上，稿子的 headline-md 尺寸档）；综合分 26（页标题 26 由 PageShell 负责）。
 * 奖章名为什么敢比区块标题大一号：架子上每一枚是"陈列品"，名字是它的标签，字重压到 500
 * 就不抢区块标题；窄屏两列时每格只有 124px（章 30 + 文字列实测 60px，而中文全角步进 = 1em，
 * 四个字在 15px 就要 60px），所以窄屏退回 14px。**不截断**是对的（宁可折行也不丢名字）。
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
  /** 「看分数明细」：默认收起 —— 首屏要留给人话与奖章架，不是三根刻度条 */
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

  // ⚠️ 顺序完全沿用后端（门槛从低到高），这里不排序
  const badges: BadgeItem[] = overview?.items ?? []
  const obtainedCount = overview?.obtained_count ?? badges.filter((item) => item.obtained).length
  const totalCount = overview?.total ?? badges.length

  return (
    <PageShell
      title="个人中心"
      description="这里是你自己的画像，只有一份数据，不跟别人比。"
      breadcrumb="个人中心"
      actions={
        <>
          {/*
            一屏唯一的主 CTA：一个明确的「下一步」。
            尺寸/字重（h-11 / 圆角 12 / 15px·600）已由 `ui/button.tsx` 的 `size="lg"` 收敛，
            页面不再手写那两个类；这里只留 `gap-2`（图标间距）与 `self-end`
            （PageHeader 是 `sm:items-end`，动作区比标题块高时会被居中，标题下会空出约 10px）。
          */}
          <Button variant="warm" size="lg" asChild className="gap-2 self-end">
            <Link to="/task">继续今天的任务</Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </>
      }
    >
      {!ready || (loading && !profile) ? <AIThinking text="正在读你的画像…" lines={3} /> : null}

      {/* ① 当前阶段 + 综合分（分数降级成 26px，三根刻度条默认收进明细） */}
      <Panel data-print="card" className="gap-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className="text-headline-sm text-primary">当前阶段</h2>
            {STAGE_DESC[stage] ? (
              <p className="max-w-[52ch] text-body-md text-on-surface-variant">
                {STAGE_DESC[stage]}
              </p>
            ) : null}
          </div>
          <StageBadge stage={stage} showStepper />
        </div>

        {profile ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-numeric text-headline-xl font-bold tabular-nums text-primary">
                {Math.round(profile.total_score)}
              </span>
              <span className="text-body-md text-on-surface-variant">/ 100 综合分</span>
            </div>

            <Collapsible open={scoreOpen} onOpenChange={setScoreOpen}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 gap-0 text-on-surface-variant"
                >
                  {scoreOpen ? '收起分数明细' : '看分数明细'}
                  <ChevronDown
                    className={cn('size-4 transition-transform', scoreOpen && 'rotate-180')}
                    aria-hidden
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-col gap-3 pb-1 pt-3">
                  {scoreRows.map((item) => (
                    <div key={item.dimension} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-body-sm text-on-surface-variant">
                        {item.dimension}
                      </span>
                      <Progress
                        value={item.score}
                        aria-label={`${item.dimension} ${Math.round(item.score)} 分`}
                        className="h-1.5 flex-1 bg-surface-container"
                      />
                      <span className="w-10 shrink-0 text-right text-body-md tabular-nums text-primary">
                        {Math.round(item.score)}
                      </span>
                    </div>
                  ))}
                  <p className="text-body-sm text-caption-foreground">
                    三个维度都是你自己给自己的分，随打卡、答题和聊天一点点长。
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <p className="text-body-sm text-secondary">
              {tested
                ? '方向清晰度来自基础测评；继续打卡和聊天，上面的画像雷达会跟着变，想重测随时可以。'
                : '还没有做过基础测评，做完之后画像会更准。'}
            </p>
          </div>
        ) : (
          <p className="text-body-md text-on-surface-variant">画像还没读到，稍后刷新试试。</p>
        )}
      </Panel>

      {/* ② 奖章架：默认一行小方块，点开才摊开大章（不再是三枚大章占满首屏） */}
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
          <BadgeShelf
            badges={badges}
            openKey={openBadge}
            onOpenKeyChange={setOpenBadge}
          />
        ) : badgesFailed ? (
          <p className="text-body-md text-on-surface-variant">奖章没读到，稍后刷新试试。</p>
        ) : badgesLoaded ? (
          // 极端兜底：后端返回了空列表（正常情况下恒为三枚槽位）
          <p className="text-body-md text-on-surface-variant">奖章还在铸造，过一会儿再来看看。</p>
        ) : (
          <p className="text-body-md text-on-surface-variant">正在读你的奖章…</p>
        )}
      </Panel>

      {/* ③ 画像雷达（保留原实现，排到奖章与分数之后） */}
      <Panel data-print="card" className="gap-4">
        <h2 className="text-headline-sm text-primary">画像雷达</h2>
        <ProfileRadar
          tags={tags}
          empty={
            <p className="text-body-md text-on-surface-variant">
              还没有雷达数据。和我聊两轮，或者完成一个任务，这里就会长出来。
            </p>
          }
        />
      </Panel>

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

      <p className="text-caption text-caption-foreground">
        画像最近更新：{formatDateTime(profile?.updated_at)} · 阶段：{label}
      </p>
    </PageShell>
  )
}

/* ------------------------------ 奖章架 ------------------------------ */

/**
 * 奖章架 —— 三枚奖章默认只占**一行小方块**（chip：30px 小奖章 + 名称 + 状态/还差几步），
 * 摆在 `Panel inset` 的浅底"架子"上；点某一枚才在下面摊开大章（默认 112px）。
 *
 * 与旧版的差别：旧版三枚 112px 大章并排，首屏约 700px 全被奖章吃掉；
 * 现在默认态约 100px，首屏能同时看到阶段、一句人话、主 CTA 与奖章架。
 *
 * 信息一个都没丢 ——
 *   chip 上：名称 / 状态（已获得、还差 N 个步骤）；
 *   展开态：name / description / hint / obtained_at（`formatDate`）/ progress（`current / target`）。
 * 展开逻辑用本地 state（不是 `Collapsible`）：同一时刻只摊开一枚，点第二枚自动换过去，
 * `aria-expanded` + `aria-controls` 交给读屏，`title` 让被截断的 hint 悬停可读全文。
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
      <Panel as="ul" inset className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
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
                  // 用**显式网格** `auto | 1fr` 排「章 + 文字」，不用 flex-grow：
                  // flex 版实测文字列会被压到 60px（只够 caption 的宽度），
                  // 名称被挤成两行；网格给出确定的列宽，窄屏也一行放得下。
                  'grid h-full w-full grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-0.5 rounded-lg px-3 py-2.5 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40',
                  isOpen
                    ? 'bg-primary-soft ring-1 ring-primary/30'
                    : 'bg-card hover:bg-surface-container',
                )}
              >
                <BadgeMedallion badge={badge} size={30} className="row-span-2" />
                {/*
                  名称：`sm` 以上 18px、窄屏回到正文 14px。
                  18px 是稿子的 headline-md **尺寸档**，但**不**用 `text-headline-md` 的 600 字重 ——
                  奖章名比区块标题(16/600)大一号是"陈列品"的层级（架子上每一件都有自己的名字），
                  字重压回 500 就不抢区块标题。窄屏两列时每格只有 124px（章 30 + 文字列实测 60），
                  15px 的四个字也会折行，所以窄屏退回正文 14px（一行放得下，不截断、不折行）。
                */}
                <span className="text-[15px] font-medium leading-6 text-primary sm:text-[18px]">
                  {badge.name}
                </span>
                <span
                  className="truncate text-caption text-caption-foreground"
                  title={badgeHint(badge)}
                >
                  {badge.obtained ? '已获得' : `还差 ${remainingSteps(badge.progress)} 个步骤`}
                </span>
              </button>
            </li>
          )
        })}
      </Panel>

      {openBadge ? (
        <div
          id="badge-detail"
          className="flex flex-col items-center gap-3.5 rounded-lg bg-surface-container-low px-5 py-5 text-center"
        >
          <BadgeMedallion badge={openBadge} />
          <div className="flex flex-col gap-1.5">
            {/* 展开态是这一枚的「主角」，名称用 headline-md(18/600) 一档 —— chip 里放不下这一档 */}
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
                ? `获得于 ${formatDate(openBadge.obtained_at)}`
                : `还差 ${remainingSteps(openBadge.progress)} 个步骤`}
            </span>
            <span className="text-caption text-caption-foreground">
              进度 {openBadge.progress.current} / {openBadge.progress.target}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
