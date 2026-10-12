import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarCheck, Check, Clock, Footprints, Gauge, Lightbulb, ListChecks, MoreHorizontal, Sparkles, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/EmptyState'
import { Panel } from '@/components/Panel'
import { TaskAbandonDialog } from '@/components/TaskAbandonDialog'
import { TaskDeleteDialog } from '@/components/TaskDeleteDialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { PageShell } from '@/components/PageShell'
import { toTaskDetail } from '@/constants/routes'
import {
  ABANDONED_STATUS,
  DONE_STATUS,
  ONGOING_STATUS,
  taskProgress,
  useTaskStore,
} from '@/store/taskStore'
import { useProfileStore } from '@/store/profileStore'
import { homeApi } from '@/api/home'
import type { Task } from '@/types'
import { formatRelative } from '@/utils/format'

/**
 * 任务列表（设计说明书 2.1 /task，3.1 P0）
 * profileStore.version 变化（打卡 / 对话结束 / 删除）后重新拉取。
 *
 * Fix B：列表读取走 normalizeList（在 store 里）；后端 status 是中文。
 *
 * 动作收口（2026-10 版式收口）：
 * - 「查看步骤」是这一屏**唯一**的实心主按钮（进行中任务的下一步）；
 * - 「放弃 / 删除」从并排的两个按钮收进 `···` 菜单 —— 它们是低频破坏性动作，
 *   和主行动并排会让人不敢点任何东西。菜单项仍照旧打开 TaskAbandonDialog /
 *   TaskDeleteDialog（state 与确认逻辑一个字没改），删除项保持 destructive 语义。
 *
 * 版式（`lg:grid-cols-12`：主角 8 列 / 辅助 4 列）：
 * - **进行中**是主角：整块白卡（Panel）+ 16px 标题 + 13px 价值说明 + 琥珀进度条 +
 *   `done/total` 14px，右侧唯一主 CTA「查看步骤」；
 * - 辅助列只放**真数据**：难度 / 预计天数 / 最近更新 / 关联痛点 + 生成入口；
 * - **已完成 / 已放弃**保留原来的「浅底架子 + 小方块」写法（用户明确要的形态），
 *   只是底色从 `bg-muted/40` 换成语义浅底 `bg-surface-container-low`、字号按语义阶。
 *
 * ⚠️ 列表接口（GET /task）**不返回 steps**，所以任务块里没有「当前：xxx 步骤」那一行
 *   （只有首页的 /home/summary 才带 current_step_title）。要那一行就得每条任务再请求一次
 *   详情，为了不一屏打十几个请求，这里不显示 —— 也不编。
 */
export default function TaskListPage() {
  const { tasks, loading, fetchTasks, generate } = useTaskStore()
  const version = useProfileStore((s) => s.version)
  /** 命中的已有任务 id：卡片会被标一下，让用户一眼看到是哪条 */
  const [reusedId, setReusedId] = useState<string | null>(null)
  /** 正在确认删除 / 放弃的任务（整页共用一份弹窗，null = 关闭） */
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [abandonTarget, setAbandonTarget] = useState<Task | null>(null)
  /**
   * 状态筛选：客户端过滤，**零额外请求**（列表一次就把全部状态拿回来了）。
   * 服务端 GET /task 其实也支持 ?status=，但客户端过滤能顺带算出三个计数，
   * 而且切换时不闪 loading。
   */
  const [filter, setFilter] = useState<'全部' | '进行中' | '已完成'>('全部')
  /**
   * 任务"路径"数据：只有 /home/summary 的 ongoing_tasks 带
   * done_steps / total_steps / current_step_title（后端 group by 批量算，无 N+1），
   * 但它有硬上限（MAX_ONGOING_TASKS = 2 条）。
   *
   * ⚠️ 所以：**只有这 2 条**能显示真实路径与当前行动；第 3 条起不显示 ——
   * 不给假路径、也不为了凑齐去逐条请求详情（那会是一屏 N 个请求）。
   * 想把路径铺满整个列表，需要后端在列表接口里带上步骤计数（已记在待办里）。
   */
  const [paths, setPaths] = useState<Record<string, { done: number; total: number; current: string | null }>>({})

  useEffect(() => {
    void fetchTasks()
  }, [fetchTasks, version])

  // 多打一次 /home/summary 换"前 2 条任务的真实路径 + 当前行动"（与首页同一个接口、同一份类型）
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const summary = await homeApi.summary()
        if (!alive || !summary?.ongoing_tasks) return
        const next: Record<string, { done: number; total: number; current: string | null }> = {}
        for (const item of summary.ongoing_tasks) {
          next[item.id] = {
            done: item.done_steps,
            total: item.total_steps,
            current: item.current_step_title ?? null,
          }
        }
        setPaths(next)
      } catch {
        // 拿不到路径就退化成"没有路径"的卡片，不影响列表本身（列表有自己的错误处理）
        if (alive) setPaths({})
      }
    })()
    return () => {
      alive = false
    }
  }, [version])

  // 标一下就好，几秒后自己褪掉，避免看起来像"选中的状态"
  useEffect(() => {
    if (!reusedId) return
    const timer = window.setTimeout(() => setReusedId(null), 6000)
    return () => window.clearTimeout(timer)
  }, [reusedId])

  const handleGenerate = async () => {
    const task = await generate()
    if (!task) {
      toast.error('生成失败，先和我聊聊你的卡点')
      return
    }
    // 判定只看 reused（不匹配文案）：true = 服务端有同题任务，没有新建
    if (task.reused === true) {
      setReusedId(task.id)
      toast.info('已经有一个类似的任务了，我把它放到最前面标给你了')
      return
    }
    setReusedId(null)
    toast.success('已经按你现在的痛点生成了一个任务')
  }

  const ongoing = tasks.filter((t) => t.status === ONGOING_STATUS)
  const done = tasks.filter((t) => t.status === DONE_STATUS)
  const abandoned = tasks.filter((t) => t.status === ABANDONED_STATUS)

  // 进行中的任务：满宽单列，全部等权（后端按 created_at 倒序，最新创建 ≠ 最该先做，
  // 所以不给"第一条"任何额外视觉权重）

  return (
    <PageShell
      title="成长任务"
      badge={
        <Badge variant="secondary" className="rounded-full font-normal">
          小步打卡
        </Badge>
      }
      description="每个任务都拆成能当天做完的小步，做完就打卡。"
      breadcrumb="成长任务"
      /*
       * 主内容列限宽：稿子（stitch_ui/code.html）把任务区限在 801px。
       * 不限宽的话，1280 视口下卡片会拉到 976px —— 标题只占左半、进度条拉满全宽，
       * 反而显得松。这里只在**本页**收窄，不动共享的 PageShell。
       */
      className="max-w-[820px]"
      /*
       * 右侧只放生成入口，且一直是**次按钮**：这一屏的实心主按钮只留给
       * 进行中任务卡里的「查看步骤」（空态时留给空态块里的那一个）——
       * "先做手上这件"比"再生成一件"更该被鼓励。
       */
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleGenerate()}
          className="gap-1.5"
        >
          <Sparkles className="size-4" />
          让 AI 生成任务
        </Button>
      }
    >
      {loading && !tasks.length ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : tasks.length ? (
        <div className="flex flex-col gap-6">
        {/* 状态筛选 + 计数：把"有哪些任务"变成"能管理任务"。
            纯客户端筛选（列表本来就一次拿全），零额外请求、切换不闪 loading。 */}
        <FilterStrip
          value={filter}
          onChange={setFilter}
          counts={{ 全部: tasks.length, 进行中: ongoing.length, 已完成: done.length }}
        />

        {filter === '已完成' ? (
          done.length ? (
            <TaskShelf title="已完成" count={done.length} hint="记录还在，可以回看" dotClass="bg-primary">
              {done.map((task) => (
                <SmallTaskTile key={task.id} task={task} tone="done" onDelete={setDeleteTarget} />
              ))}
            </TaskShelf>
          ) : (
            <Panel className="gap-2">
              <p className="text-headline-sm text-primary">还没有完成的任务</p>
              <p className="text-body-sm text-on-surface-variant">
                完成一个任务的最后一步，它就会出现在这里。
              </p>
            </Panel>
          )
        ) : (
        <div className="flex flex-col gap-3">
          {/* 满宽单列：卡片吃满内容区可用宽度（1025px 视口下实测 721px，两列时只有 473px） */}
          {ongoing.length ? (
            ongoing.map((task) => (
              <OngoingPanel
                key={task.id}
                task={task}
                /* 只有 /home/summary 覆盖到的前 2 条拿到真实路径；其余为 undefined（不编） */
                path={paths[task.id]}
                highlighted={reusedId === task.id}
                onAbandon={setAbandonTarget}
                onDelete={setDeleteTarget}
                /*
                 * 卡内底部那条低强调提示（稿子里就在卡内）只在**只有一条任务**时出现：
                 * 它是"卡住时怎么办"的引导，不是每条任务各自的属性；
                 * 多条任务时重复 N 遍就成了噪音，那种情况由页面底部那一句统一承担。
                 */
                showStuckHint={ongoing.length === 1}
              />
            ))
          ) : (
            <Panel className="gap-2">
              <p className="text-headline-sm text-primary">现在没有进行中的任务</p>
              <p className="text-body-sm text-on-surface-variant">
                已经完成 {done.length} 个、放弃 {abandoned.length} 个。
                想接着往前走，就点右上角「让 AI 生成任务」，或者先去聊一句你的卡点。
              </p>
            </Panel>
          )}

          {/*
            这句原来是右侧辅助卡的结尾（"卡住的时候，与其硬扛，不如把卡点说出来。"）。
            它有真实引导价值，所以保留，但**全页只出现一次**：
            - 只有一条进行中任务时，它按稿子的写法落在**卡内底部**（见 OngoingPanel 的 showStuckHint）；
            - 多条任务时挪到这里当页脚提示，避免每条卡片重复同一句话。
            原来那句"生成本身不需要你想好题目"是重复的元话述，删除。
          */}
          {ongoing.length > 1 ? (
            <p className="text-body-sm text-on-surface-variant">
              卡住的时候，与其硬扛，不如把卡点说出来 ——
              <Link to="/chat" className="text-secondary transition-colors hover:underline">
                和 AI 聊一句
              </Link>
            </p>
          ) : null}
        </div>
        )}

          {/* 「已放弃」不参与筛选（它是归档信息，不是用户会主动切过去看的状态），始终在最下方 */}
          {abandoned.length ? (
            <TaskShelf
              title="已放弃"
              count={abandoned.length}
              hint="不会再提醒你；想彻底清掉可以删除"
              dotClass="bg-outline-variant"
            >
              {abandoned.map((task) => (
                <SmallTaskTile
                  key={task.id}
                  task={task}
                  tone="abandoned"
                  onDelete={setDeleteTarget}
                />
              ))}
            </TaskShelf>
          ) : null}
        </div>
      ) : (
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title="还没有任务，我带你从一次对话里生成"
          description="任务不是作业，是从你自己说的话里长出来的下一步。"
          action={
            <Button variant="warm" onClick={() => void handleGenerate()}>
              用我的画像生成一个
            </Button>
          }
        />
      )}

      {/* 删除 / 放弃的二次确认（整页共用一份，列表里每条卡片只是打开它的入口） */}
      <TaskDeleteDialog
        task={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      />
      <TaskAbandonDialog
        task={abandonTarget}
        onOpenChange={(open) => {
          if (!open) setAbandonTarget(null)
        }}
      />
    </PageShell>
  )
}

/**
 * 进行中的任务 —— 这一屏的主角块。
 * 白卡 Panel + 16px 标题 + 13px 价值说明 + 琥珀进度条（h-1.5）+ 右侧唯一主 CTA。
 * `···` 菜单里是低频动作（放弃 / 删除），确认弹窗逻辑与改版前完全一致。
 */
function OngoingPanel({
  task,
  path,
  highlighted,
  onAbandon,
  onDelete,
  showStuckHint = false,
}: {
  task: Task
  /**
   * 真实任务路径（来自 /home/summary 的 ongoing_tasks，后端批量算）。
   * **可能为 undefined**：那个接口只覆盖最新的 2 条进行中任务 —— 拿不到就不渲染路径，
   * 不编步数、也不为了它逐条打详情请求。
   */
  path?: { done: number; total: number; current: string | null }
  highlighted: boolean
  onAbandon: (task: Task) => void
  onDelete: (task: Task) => void
  /** 只有一条进行中任务时，才在卡内显示"卡住的时候…"那条引导（见调用点注释） */
  showStuckHint?: boolean
}) {
  const percent = taskProgress(task)

  return (
    <Panel
      data-print="card"
      padded={false}
      className={cn(
        // 满宽行式卡：16px 内边距、8px 段间距、1px 细描边 + 极轻阴影（K1，阴影由 K2 对照决定去留）
        'gap-2 rounded-xl border border-border p-4 shadow-card',
        // 「刚生成的任务」比普通卡片多一层浅墨环绕，让用户一眼看到是哪条
        highlighted && 'bg-primary-soft ring-1 ring-primary/30',
      )}
    >
      {/* ① 标题行：状态圆点 + 标题；右侧保留原有的 ··· 菜单（放弃 / 删除） */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="size-2 shrink-0 rounded-full bg-secondary" aria-hidden />
          <span className="text-headline-sm text-primary">{task.title}</span>
        </div>
        <OngoingMenu task={task} onAbandon={onAbandon} onDelete={onDelete} />
      </div>

      {/* ② 进度行：横向进度条（6px / 琥珀 / 全圆角）负责"一眼看出量"，
          右侧百分比（琥珀、等宽数字）负责精确值。0% 是有效进度，照样显示。 */}
      <div className="mt-1 flex items-center gap-3">
        <Progress
          value={percent}
          aria-label={`已完成 ${percent}%`}
          className="h-1.5 flex-1 bg-surface-container [&>[data-slot=progress-indicator]]:bg-secondary"
        />
        <span className="shrink-0 font-numeric text-body-sm font-semibold text-secondary">
          {percent}%
        </span>
      </div>

      {/* ③ 任务说明：后端 value_note 原话（"为什么值得做"）。限一行，不让卡片无限增高 */}
      {task.value_note ? (
        <p className="mt-1 line-clamp-1 text-body-md text-on-surface">{task.value_note}</p>
      ) : null}

      {/*
        ③-b 真实任务路径 + 当前行动（只有拿到后端数据时才渲染）。
        用 done/total 画分段步点：一眼知道"这条路有多长、我走到第几格"；
        当前行动直接用后端的 current_step_title 原话 —— 不编步骤名。
        拿不到数据的任务不渲染这一块（宁可少一块，也不造假路径）。
      */}
      {path && path.total > 0 ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-caption text-caption-foreground">任务路径</span>
            <span className="font-numeric text-caption text-on-surface-variant">
              {path.done}/{path.total} 步
            </span>
          </div>
          <div className="flex items-center gap-1.5" role="img" aria-label={`共 ${path.total} 步，已完成 ${path.done} 步`}>
            {Array.from({ length: path.total }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  i < path.done ? 'bg-secondary' : 'bg-surface-container',
                )}
              />
            ))}
          </div>
          {path.current ? (
            <p className="flex items-center gap-1.5 text-body-sm text-on-surface-variant">
              <Footprints className="size-3.5 shrink-0 text-caption-foreground" aria-hidden />
              当前行动：
              <span className="text-on-surface">{path.current}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ④ 元信息 + 操作：一条带分隔线的信息带 —— 左边是带图标的字段，右边是唯一的主操作。
          这样"信息"和"入口"在同一视觉带里，卡片底部不再出现一大块只放一个按钮的空白；
          字段缺失时直接不渲染（不写"未标注"占位）。 */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-surface-container-low pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-body-sm text-on-surface-variant">
          {task.difficulty ? (
            <span className="flex items-center gap-1.5">
              <Gauge className="size-3.5 shrink-0 text-caption-foreground" aria-hidden />
              难度
              <span className="font-medium text-primary">{task.difficulty}</span>
            </span>
          ) : null}
          {task.estimated_days ? (
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0 text-caption-foreground" aria-hidden />
              预计
              <span className="font-medium text-primary">{task.estimated_days} 天</span>
            </span>
          ) : null}
          <span className="flex items-center gap-1.5">
            <CalendarCheck className="size-3.5 shrink-0 text-caption-foreground" aria-hidden />
            更新于
            <span className="font-numeric text-on-surface-variant">
              {formatRelative(task.updated_at)}
            </span>
          </span>
          {task.pain_point ? (
            <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface-container-low px-2 py-0.5 text-caption text-on-surface-variant">
              <Tag className="size-3 shrink-0" aria-hidden />
              关联痛点：{task.pain_point}
            </span>
          ) : null}
        </div>

        {/* 任务自己的唯一主操作 */}
        <Button variant="warm" size="sm" asChild className="shrink-0 gap-1.5">
          <Link to={toTaskDetail(task.id)}>
            查看步骤
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      {/* ⑤ 卡内低强调提示：只在单条任务时出现（多条时由页面底部统一一句承担） */}
      {showStuckHint ? (
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-surface-container-low bg-canvas px-3 py-2 text-body-sm text-on-surface-variant">
          <Lightbulb className="size-3.5 shrink-0 text-secondary" aria-hidden />
          卡住的时候，与其硬扛，不如把卡点说出来 ——
          <Link to="/chat" className="text-secondary transition-colors hover:underline">
            和 AI 聊一句
          </Link>
        </div>
      ) : null}
    </Panel>
  )
}

/** 状态筛选条：全部 / 进行中 / 已完成（客户端筛选，计数来自已加载的列表数据） */
function FilterStrip({
  value,
  onChange,
  counts,
}: {
  value: '全部' | '进行中' | '已完成'
  onChange: (next: '全部' | '进行中' | '已完成') => void
  counts: Record<'全部' | '进行中' | '已完成', number>
}) {
  const items: Array<'全部' | '进行中' | '已完成'> = ['全部', '进行中', '已完成']
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="任务状态筛选">
      {items.map((item) => {
        const active = value === item
        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body-sm transition-colors',
              active
                ? 'border-primary bg-primary-soft font-medium text-primary ring-1 ring-primary/25'
                : 'border-border bg-card text-on-surface-variant hover:border-primary/40',
            )}
          >
            {item}
            <span className={cn('font-numeric text-caption', active ? 'text-primary' : 'text-caption-foreground')}>
              {counts[item]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** 进行中卡片右上角的 `···` 菜单：放弃 / 删除（低频、破坏性动作收在这里） */
function OngoingMenu({
  task,
  onAbandon,
  onDelete,
}: {
  task: Task
  onAbandon: (task: Task) => void
  onDelete: (task: Task) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`「${task.title}」的更多操作`}
          className="size-8 shrink-0 px-0 text-on-surface-variant"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => onAbandon(task)}>放弃这个任务</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(task)}>
          <Trash2 className="size-4" />
          删除这个任务
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 已完成 / 已放弃的「浅底架子」：小方块摆在浅底上（用户明确要的形态，保留） */
function TaskShelf({
  title,
  count,
  hint,
  dotClass,
  children,
}: {
  title: string
  count: number
  hint: string
  dotClass: string
  children: ReactNode
}) {
  return (
    <section data-print="card" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={cn('size-2 self-center rounded-full', dotClass)} aria-hidden />
        <span className="text-headline-sm text-primary">{title}</span>
        <span className="text-body-sm text-on-surface-variant">{count} 个</span>
        <span className="text-body-sm text-on-surface-variant">{hint}</span>
      </div>
      {/* 浅底"架子"：小方块摆在上面，右侧余下的也是被托住的一块面，不是空洞 */}
      <div className="flex flex-wrap items-stretch gap-3 rounded-xl bg-surface-container-low p-4">
        {children}
      </div>
    </section>
  )
}

/**
 * 已完成 / 已放弃：**小方块**，成排堆在下方（用户要求）。
 * 不显眼（淡底、字号按语义阶、没有进度条），但标题、进度、查看与删除都还在。
 */
function SmallTaskTile({
  task,
  tone,
  onDelete,
}: {
  task: Task
  tone: 'done' | 'abandoned'
  onDelete: (task: Task) => void
}) {
  const percent = taskProgress(task)
  const isDone = tone === 'done'
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg bg-card p-4 shadow-card sm:w-60">
      <div className="flex items-start gap-2">
        {isDone ? (
          <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
        ) : (
          <span className="mt-1 size-2 shrink-0 rounded-full bg-outline-variant" aria-hidden />
        )}
        <span className="line-clamp-2 flex-1 text-body-md font-medium text-primary">
          {task.title}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 text-caption text-on-surface-variant">
        {task.pain_point ? <span>{task.pain_point}</span> : null}
        <span aria-hidden>·</span>
        {/* 已完成恒为 100%，没信息量；已放弃显示走到哪儿了 */}
        <span>{isDone ? '已归档' : `停在 ${percent}%`}</span>
        <span aria-hidden>·</span>
        <span>{formatRelative(task.updated_at)}</span>
      </div>

      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`删除「${task.title}」`}
          className="size-7 px-0 text-on-surface-variant hover:text-destructive"
          onClick={() => onDelete(task)}
        >
          <Trash2 className="size-3.5" />
        </Button>
        <Button variant="outline" size="sm" asChild className="px-2.5">
          <Link to={toTaskDetail(task.id)}>查看</Link>
        </Button>
      </div>
    </div>
  )
}
