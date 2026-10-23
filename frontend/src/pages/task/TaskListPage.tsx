import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Footprints,
  Lightbulb,
  ListChecks,
  MoreHorizontal,
  Sparkles,
  Tag,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { AIThinking } from '@/components/AIThinking'
import { EmptyState } from '@/components/EmptyState'
import { Reveal, staggerDelay } from '@/components/Motion'
import { Panel } from '@/components/Panel'
import { TaskAbandonDialog } from '@/components/TaskAbandonDialog'
import { TaskDeleteDialog } from '@/components/TaskDeleteDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
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

/** 真实任务路径（来自 /home/summary 的 ongoing_tasks，只覆盖最新的 2 条；拿不到就不渲染） */
type TaskPath = { done: number; total: number; current: string | null }

/**
 * 「手上的其它任务」最多一屏露 3 个框（单框 76px + 框间距 8px），多出来的滑动查看 ——
 * 这套滑动是用户要保留的，**不要**改成折叠。
 * 注意它是**上限**（max-height）：不足 3 条时卡片按内容收短，不留大块空白。
 * 76 是 15px 标题（25 行高）+ 14px 元信息（22 行高）+ 上下 12px 内边距算出来的；
 * 字号阶再抬一档就要重新算，否则文字会被 `overflow-hidden` 切掉。
 * ⚠️ 改这里的数字，要同步 TaskRow 上的 `h-[76px]` 与 DailyQuote 的 `h-[76px]`。
 */
const ROW_H = 76
const ROW_GAP = 8
const VISIBLE_ROWS = 3
const SLOT_H = ROW_H * VISIBLE_ROWS + ROW_GAP * (VISIBLE_ROWS - 1) // 244

/**
 * 「走过的路」清单的折叠阈值：超过 2 条才折叠（默认只露 2 条 + 一个「展开」按钮），
 * 不超过 2 条就和原来一样直接铺开、不出现任何按钮。
 */
const FOLD_AT = 2

/**
 * 成长任务列表（设计说明书 2.1 /task，3.1 P0）
 * profileStore.version 变化（打卡 / 对话结束 / 删除）后重新拉取。
 *
 * 版式（2026-10 前端迭代 02，对齐主页样板）：
 * - 页头交给 PageShell 里的 PageHeader（标题 26/700 + 一句人话 + 右侧一个次按钮）；
 * - 一屏一个主角：把「当前最该做的那一条」做成最大的白卡 —— 中性 chip 点题、
 *   标题、一句副墨的「为什么值得做」、关联痛点 chip、**步骤路径**（唯一的一处进度，也是
 *   全屏唯一用到赭金的地方）+ 「已完成 1/2 步」读数、唯一的实心 CTA「继续做」；没有进行中任务时，
 *   主角区改成「开始新任务」的真话引导，不伪造任务；
 * - 其余任务按状态分组，两列 7/5 支撑（左：手上的其它；右：走过的路）。
 *   两栏**顶边与下沿对齐**：grid 默认 stretch，较矮的一栏用 `flex-1` 吃满行高，
 *   列表区把余量居中分配，不会把几十 px 空白全堆在卡片底部；
 *   左栏「手上的其它任务」：最多一屏露 3 条（多了滑动、少了就居中收在卡内）；
 *   右栏「走过的路」：顶部固定一句「每日一句」（按日期轮换、一个框那么大、醒目），
 *   下面 2 个框给做过的任务；超过 2 条时标题行右侧出现「展开其余 N 条 / 收起」（不占额外高度）。
 *
 * 动效（全站语汇，见 index.css「统一动效语汇」一节）：
 * - 进场：主角区 `Reveal lg`（640ms 从容），支撑两栏 `Reveal`（480ms），
 *   列表行 `Reveal as="li" delay={staggerDelay(i)}`（只错开头几项）；
 * - 步骤连线：只按进度着色，不生长、不脉冲（卡片里不再有第二处生长动效）；
 * - 按钮：`motion-press`（按下轻缩）；不用循环动画、不弹跳、不改布局尺寸。
 *
 * ⚠️ 列表接口（GET /task）不返回 steps，也没有「当前步」；只有 /home/summary 的
 *   前 2 条 ongoing_tasks 带 done/total/current。拿不到就先不给路径，绝不编。
 *
 * ⚠️ 「当前最该做」用后端 next_action.route 指到哪条来定（前端不自己判优先级）；
 *   指不到就退回列表里的第一条进行中任务。
 *
 * 动作收口：完成 / 放弃 / 删除的确认弹窗照旧调用 TaskAbandonDialog、TaskDeleteDialog，
 * 逻辑一个字没改。低频破坏性动作（放弃 / 删除）收进 「···」 菜单。
 */
export default function TaskListPage() {
  const { tasks, loading, error, fetchTasks, generate } = useTaskStore()
  const version = useProfileStore((s) => s.version)
  /** 命中的已有任务 id：卡片会被标一下，让用户一眼看到是哪条 */
  const [reusedId, setReusedId] = useState<string | null>(null)
  /** 正在确认删除 / 放弃的任务（整页共用一份弹窗，null = 关闭） */
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null)
  const [abandonTarget, setAbandonTarget] = useState<Task | null>(null)
  /** 前 2 条进行中任务的真实路径（后端批量算，无 N+1） */
  const [paths, setPaths] = useState<Record<string, TaskPath>>({})
  /** 后端建议的下一步落在这条任务的 id 上（next_action.route = /task/{id}） */
  const [focusId, setFocusId] = useState<string | null>(null)
  /** 「走过的路」是否展开（超过 FOLD_AT 条才有这个开关） */
  const [historyExpanded, setHistoryExpanded] = useState(false)

  useEffect(() => {
    void fetchTasks()
  }, [fetchTasks, version])

  // 多打一次 /home/summary 换「前 2 条任务的真实路径」+ 后端建议的当前任务（与首页同一接口）
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const summary = await homeApi.summary()
        if (!alive || !summary) return
        const next: Record<string, TaskPath> = {}
        for (const item of summary.ongoing_tasks ?? []) {
          next[item.id] = {
            done: item.done_steps,
            total: item.total_steps,
            current: item.current_step_title ?? null,
          }
        }
        setPaths(next)
        const route = summary.next_action?.route ?? ''
        setFocusId(route.startsWith('/task/') ? route.slice('/task/'.length) : null)
      } catch {
        // 拿不到路径就退化成「没有路径」的卡片，不影响列表本身（列表有自己的错误处理）
        if (alive) {
          setPaths({})
          setFocusId(null)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [version])

  // 标一下就好，几秒后自己褪掉，避免看起来像「选中的状态」
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
      toast.info('已经有一个类似的任务了，我把它标给你了')
      return
    }
    setReusedId(null)
    toast.success('已经按你现在的痛点生成了一个任务')
  }

  const ongoing = tasks.filter((t) => t.status === ONGOING_STATUS)
  const done = tasks.filter((t) => t.status === DONE_STATUS)
  const abandoned = tasks.filter((t) => t.status === ABANDONED_STATUS)
  const heroTask = ongoing.find((t) => t.id === focusId) ?? ongoing[0] ?? null
  const otherOngoing = ongoing.filter((t) => t.id !== heroTask?.id)
  /** 走过的路 = 已完成 + 已放弃；超过 FOLD_AT 条才给「展开 / 收起」（开关放在标题行里，不占额外高度） */
  const historyTasks = [...done, ...abandoned]
  const historyFoldable = historyTasks.length > FOLD_AT
  const historyOpen = historyFoldable && historyExpanded

  return (
    <PageShell
      title="成长任务"
      badge={
        <Badge variant="secondary" className="rounded-full font-normal text-caption">
          小步打卡
        </Badge>
      }
      description="一次只做一件小事，做完再换下一件。"
      breadcrumb="成长任务"
      /*
       * 右上只放生成入口，且一直是次按钮：这一屏的实心主按钮只留给主角区的
       * 「继续做」（或没有进行中任务时空态里的那一个）——「先做手上这件」比「再生成一件」更该被鼓励。
       */
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleGenerate()}
          className="motion-press gap-1.5"
        >
          <Sparkles className="size-4" aria-hidden />
          让 AI 生成任务
        </Button>
      }
    >
      {loading && !tasks.length ? (
        <LoadingBlock />
      ) : error && !tasks.length ? (
        /* 接口失败：说清原因 + 给一个重试入口，不留静默空白 */
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title="任务列表没加载出来"
          description={'没拿到任务数据：' + error}
          action={
            <Button variant="outline" onClick={() => void fetchTasks()}>
              重新加载
            </Button>
          }
        />
      ) : !tasks.length ? (
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title="还没有任务，我带你从一次对话里生成"
          description="任务不是作业，是从你自己说的话里长出来的下一步。"
          action={
            <Button variant="warm" size="lg" className="motion-press" onClick={() => void handleGenerate()}>
              用我的画像生成一个
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* ① 主角：当前最该做的那一件；没有进行中任务时改成「开始新任务」的引导 */}
          {heroTask ? (
            <Reveal lg>
              <HeroTask
                task={heroTask}
                path={paths[heroTask.id]}
                highlighted={reusedId === heroTask.id}
                onAbandon={setAbandonTarget}
                onDelete={setDeleteTarget}
              />
            </Reveal>
          ) : (
            <Reveal lg>
              <EmptyState
                icon={<ListChecks className="size-5" />}
                title="现在没有进行中的任务"
                description="手头这几件都做完了。让 AI 从你的画像里挑一件当天能做完的小事，做完再换下一件。"
                action={
                  <Button
                    variant="warm"
                    size="lg"
                    className="motion-press"
                    onClick={() => void handleGenerate()}
                  >
                    开始新任务
                  </Button>
                }
              />
            </Reveal>
          )}

          {/* ② 其余任务按状态分组，两列 7/5 支撑。
              不加 items-start：grid 默认 stretch，两栏顶边、下沿对齐，
              较矮的一栏靠卡片 flex-1 吃满行高（余量在卡内分配，不留在卡外） */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Reveal delay={140} className="flex min-w-0 flex-col lg:col-span-7">
              <Panel data-print="card" className="flex-1 gap-4">
                {/* 卡内标题改成结论句（数字进标题，所以 count 传 0 不再出重复的计数 chip） */}
                <SectionHead
                  title={otherOngoing.length ? `手边还有 ${otherOngoing.length} 件` : '手边没有别的任务'}
                  count={0}
                  note="一件一件来"
                />
                {/* 最多一屏 3 个框（多出来的滑动查看）；不足 3 条时由列表区 flex-1
                    居中吃掉余量 —— 不固定撑满 232px，也不把空白堆在卡片底部 */}
                <div className="flex flex-1 flex-col justify-center">
                  {otherOngoing.length ? (
                    <ul
                      className="flex flex-col gap-2 overflow-y-auto pr-1"
                      style={{ maxHeight: SLOT_H }}
                    >
                      {otherOngoing.map((task, index) => (
                        <Reveal as="li" key={task.id} delay={staggerDelay(index)}>
                          <TaskRow
                            task={task}
                            tone="ongoing"
                            highlighted={reusedId === task.id}
                            onAbandon={setAbandonTarget}
                            onDelete={setDeleteTarget}
                          />
                        </Reveal>
                      ))}
                    </ul>
                  ) : (
                    <SupportLine
                      icon={<Sparkles className="size-4" />}
                      text={
                        heroTask
                          ? '手头只有这一件在做，把它做完再换下一件就好。'
                          : '现在没有进行中的任务，想继续就从上面的入口生成一件。'
                      }
                    />
                  )}
                </div>
              </Panel>
            </Reveal>

            <Reveal delay={250} className="flex min-w-0 flex-col lg:col-span-5">
              <Panel data-print="card" className="flex-1 gap-4">
                <SectionHead
                  title={historyTasks.length ? `走过 ${historyTasks.length} 件` : '走过的路还空着'}
                  count={0}
                  note="记录都还留着"
                  action={
                    /* 折叠开关放标题行里：不占额外高度，两栏靠 grid stretch 对齐下沿 */
                    historyFoldable ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-expanded={historyExpanded}
                        onClick={() => setHistoryExpanded((v) => !v)}
                        className="motion-press -mr-2 gap-1 text-on-surface-variant"
                      >
                        <ChevronDown
                          className={cn('size-3.5 transition-transform', historyExpanded && 'rotate-180')}
                          aria-hidden
                        />
                        {historyExpanded ? '收起' : '展开其余 ' + (historyTasks.length - FOLD_AT) + ' 条'}
                      </Button>
                    ) : undefined
                  }
                />
                {/* 折叠态最多 3 个框高（每日一句 + 2 条）＝上限，不是固定高度；
                    展开后右栏内容变高，左栏卡片随 grid stretch 一起拉高，下沿仍然齐平 */}
                <div
                  className="flex flex-1 flex-col gap-2"
                  style={historyOpen ? undefined : { maxHeight: SLOT_H }}
                >
                  <DailyQuote />
                  {historyTasks.length ? (
                    <ul className="flex flex-col gap-2">
                      {(historyOpen ? historyTasks : historyTasks.slice(0, FOLD_AT)).map(
                        (task, index) => (
                          <Reveal as="li" key={task.id} delay={staggerDelay(index)}>
                            <TaskRow
                              task={task}
                              tone={task.status === DONE_STATUS ? 'done' : 'abandoned'}
                              highlighted={reusedId === task.id}
                              onDelete={setDeleteTarget}
                            />
                          </Reveal>
                        ),
                      )}
                    </ul>
                  ) : (
                    <SupportLine
                      icon={<Check className="size-4" />}
                      text="还没有做完或放弃的任务。走完一件，它就搬到这儿。"
                    />
                  )}
                </div>
              </Panel>
            </Reveal>
          </div>

          {/* ③ 弱化动作退到页面底部一行 */}
          <Reveal delay={360}>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" asChild className="motion-press gap-1.5">
                <Link to="/chat">
                  <Lightbulb className="size-3.5" aria-hidden />
                  卡住了？和 AI 聊一句
                </Link>
              </Button>
            </div>
          </Reveal>
        </div>
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

/** 加载态：沿用 AIThinking 的等待文案，骨架按真实版式排布，避免加载完成时整页跳动 */
function LoadingBlock() {
  return (
    <div className="flex flex-col gap-6">
      <AIThinking text="正在把你的任务列出来…" lines={2} />
      <Skeleton className="h-72 rounded-xl" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Skeleton className="h-40 rounded-xl lg:col-span-7" />
        <Skeleton className="h-40 rounded-xl lg:col-span-5" />
      </div>
    </div>
  )
}

/**
 * 主角卡：当前最该做的那一件。
 * 中性 chip 点题 / 标题 / 一句副墨的「为什么值得做」/ 关联痛点 chip /
 * 步骤路径（唯一的一处进度，也是全屏唯一的赭金）+ 唯一的实心 CTA「继续做」。
 * 一屏只有一种进度表达：进度条与百分比已删（和「已完成 n/m 步」重复）。
 * 「···」 菜单里是低频动作（放弃 / 删除），确认弹窗逻辑与改版前完全一致。
 */
function HeroTask({
  task,
  path,
  highlighted,
  onAbandon,
  onDelete,
}: {
  task: Task
  path?: TaskPath
  highlighted: boolean
  onAbandon: (task: Task) => void
  onDelete: (task: Task) => void
}) {
  return (
    <Panel
      data-print="card"
      className={cn('gap-6 p-7 md:p-8', highlighted && 'ring-1 ring-primary/30')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          {/* 点题 chip：中性浅底 + 墨点。全屏唯一的赭金留给下面的进度路径 */}
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-surface-inset px-3 py-1.5 text-body-sm font-medium text-on-surface-variant">
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            今天先做这一件
          </span>
          <h2 className="text-headline-lg text-balance text-primary">{task.title}</h2>
          {/* 为什么值得做：不再单独占一块浅底，降级成标题下的一行副墨说明（14px，最低档）。
              允许两行：68ch 的一句话在窄屏会被切成半句，读起来像乱码 */}
          {task.value_note ? (
            <p className="line-clamp-2 max-w-[68ch] text-body-sm text-on-surface-variant">
              {task.value_note}
            </p>
          ) : null}
          {/* 关联痛点：与 hero chip 同一套中性浅底（赭金不在这里花） */}
          {task.pain_point ? (
            <span className="mt-0.5 inline-flex w-fit max-w-full items-center gap-1.5 rounded-full bg-surface-inset px-3 py-1 text-body-sm text-on-surface-variant">
              <Tag className="size-3.5 shrink-0" aria-hidden />
              关联痛点：{task.pain_point}
            </span>
          ) : null}
        </div>
        <OngoingMenu task={task} onAbandon={onAbandon} onDelete={onDelete} />
      </div>

      {/* 位置 + 行动：左边是「走到哪一步」，右边是唯一的主 CTA（与主页焦点舞台同一套摆法）。
          进度只说一次 —— 步骤路径（图形）＋「已完成 n/m 步」（读数）；原来那根 40% 进度条已删。 */}
      <div className="flex flex-col gap-5 border-t border-surface-container-low pt-5 md:flex-row md:items-end md:justify-between">
        {path && path.total > 0 ? (
          <StepPath
            total={path.total}
            done={path.done}
            currentTitle={path.current}
            difficulty={task.difficulty}
            estimatedDays={task.estimated_days}
          />
        ) : (
          <p className="max-w-lg text-body-sm text-on-surface-variant">
            这条路的步骤还在拆解，先按任务说明做，做完在详情页里打个卡。
          </p>
        )}

        <Button
          variant="warm"
          size="lg"
          asChild
          className="motion-press w-full shrink-0 gap-1.5 md:w-auto"
        >
          <Link to={toTaskDetail(task.id)}>
            继续做
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </Panel>
  )
}

/**
 * 步骤路径：已走过的点填浅桃勾，当前步填主墨（一眼看出「你在这一步」），
 * 之后是中性灰待办；连线按进度着色，琥珀**只走到当前步为止**。
 * 与首页焦点舞台的 StepPath 同一套语言，但**不带脉冲环、连线也不生长**：
 * 这一屏的进度只有它一处（进度条已删），所以它自己也不动。
 * 底下一组信息：「现在做」+ 当前步名（17px，这张卡的行动焦点），
 * 再下一行是难度 / 预计（14px），右侧是「已完成 n/m 步」读数。
 */
function StepPath({
  total,
  done,
  currentTitle,
  difficulty,
  estimatedDays,
}: {
  total: number
  done: number
  currentTitle: string | null
  /** 成本读数降一档排在当前步下面（14px；不再和当前步挤同一行） */
  difficulty?: string | null
  estimatedDays?: number | null
}) {
  const currentIndex = Math.min(done, total - 1)
  const fill = total > 1 ? currentIndex / (total - 1) : 1

  return (
    <div
      className="flex w-full min-w-0 max-w-lg flex-col gap-2.5"
      role="progressbar"
      aria-label="任务步骤进度"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
    >
      <div className="relative flex items-center justify-between">
        {/* 轨道：整条浅灰细线，左右缩进到圆点圆心（移动端圆点 24px，缩进跟着收） */}
        <span aria-hidden className="absolute inset-x-3 inset-y-0 flex items-center sm:inset-x-3.5">
          <span className="h-px w-full bg-outline-variant/60" />
        </span>
        {/* 已走过的连线：全屏唯一的赭金，只走到当前步为止（静态，不再生长） */}
        <span aria-hidden className="absolute inset-x-3 inset-y-0 flex items-center sm:inset-x-3.5">
          <span className="h-px bg-secondary" style={{ width: fill * 100 + '%' }} />
        </span>
        {Array.from({ length: total }, (_, index) => {
          const status = index < done ? 'done' : index === done ? 'current' : 'todo'
          return (
            <span
              key={index}
              className={cn(
                'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-label-md font-semibold tabular-nums sm:size-7',
                status === 'done' && 'bg-secondary-fixed text-on-secondary-fixed',
                status === 'current' && 'bg-primary text-on-primary',
                status === 'todo' && 'bg-surface-container text-on-surface-variant',
              )}
            >
              {status === 'done' ? (
                <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
              ) : (
                index + 1
              )}
            </span>
          )
        })}
      </div>

      {/* 一条人话：这张卡里最该被看见的是「现在做哪一步」，抬到 17px；
          难度 / 预计 / 步数读数退到 14px，窄了各自换行，不挤在同一行里 */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-caption tracking-wide text-caption-foreground">
            <Footprints className="size-3.5 shrink-0" aria-hidden />
            现在做
          </span>
          {/* 当前步允许两行：截成半句的步骤名等于没说 */}
          <span className="line-clamp-2 text-headline-sm text-primary">
            {currentTitle ?? '这一件已经全部做完了'}
          </span>
          {difficulty || estimatedDays ? (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-on-surface-variant">
              {difficulty ? (
                <span>
                  难度 <span className="font-medium text-primary">{difficulty}</span>
                </span>
              ) : null}
              {difficulty && estimatedDays ? <span aria-hidden>·</span> : null}
              {estimatedDays ? (
                <span>
                  预计 <span className="font-medium text-primary">{estimatedDays}</span> 天
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-body-sm tabular-nums text-on-surface-variant">
          {done === 0 ? '还没开始' : '已完成 ' + done + '/' + total + ' 步'}
        </span>
      </div>
    </div>
  )
}

/**
 * 其余任务的一行：inset 浅底块（全页唯一的行外观）。
 * 进行中的给「继续」+ 「···」 菜单；已完成 / 已放弃的给「查看」+ 直接删除。
 */
function TaskRow({
  task,
  tone,
  highlighted = false,
  onAbandon,
  onDelete,
}: {
  task: Task
  tone: 'ongoing' | 'done' | 'abandoned'
  highlighted?: boolean
  onAbandon?: (task: Task) => void
  onDelete: (task: Task) => void
}) {
  const percent = taskProgress(task)
  const meta =
    tone === 'done' ? '已完成' : tone === 'abandoned' ? '停在 ' + percent + '%' : percent + '%'

  return (
    <Panel
      inset
      className={cn(
        /* 76px = 25(标题) + 2(gap) + 22(元信息) + 上下 12px；字号阶改了要重算，
           否则 `overflow-hidden` 会把最后一行切掉 */
        'h-[76px] overflow-hidden py-3',
        highlighted && 'ring-1 ring-primary/30',
      )}
    >
      <div className="flex items-center gap-2.5 sm:gap-3">
        {tone === 'ongoing' ? (
          <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
        ) : tone === 'done' ? (
          <Check className="size-4 shrink-0 text-settled" aria-hidden />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-outline-variant" aria-hidden />
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body-md font-medium text-primary">{task.title}</span>
          {/* 限一行（标题 + 元信息各占一行 = 44px），保证每条都是同一个框高，两栏才对得齐。
              日期是装饰（caption），390px 放不下就整条收掉；痛点与进度是信息，留在行内 */}
          <div className="flex min-w-0 items-center gap-2 text-body-sm text-on-surface-variant">
            {task.pain_point ? <span className="min-w-0 truncate">{task.pain_point}</span> : null}
            <span className="shrink-0 tabular-nums">{meta}</span>
            <span className="hidden shrink-0 text-caption sm:inline">{formatRelative(task.updated_at)}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="sm" asChild className="motion-press">
            <Link to={toTaskDetail(task.id)}>{tone === 'ongoing' ? '继续' : '查看'}</Link>
          </Button>
          {tone === 'ongoing' && onAbandon ? (
            <OngoingMenu task={task} onAbandon={onAbandon} onDelete={onDelete} />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              aria-label={'删除「' + task.title + '」'}
              className="motion-press size-8 px-0 text-on-surface-variant hover:text-attention"
              onClick={() => onDelete(task)}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </Panel>
  )
}

/** 分组小标题：区块标题 + 计数（计数为 0 时不显示，免得出现「手上的其它任务 0」）+ 右侧说明或操作 */
function SectionHead({
  title,
  count,
  note,
  action,
}: {
  title: string
  count: number
  note: string
  /** 有操作（如「展开 / 收起」）时，用它替换右侧那句说明，免得标题行换行或增高 */
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-headline-md text-primary">{title}</h2>
        {count > 0 ? (
          <span className="rounded-full bg-surface-container px-2 py-0.5 text-caption font-medium tabular-nums text-on-surface-variant">
            {count}
          </span>
        ) : null}
      </div>
      {action ?? <span className="text-body-sm text-on-surface-variant">{note}</span>}
    </div>
  )
}

/**
 * 「走过的路」的每日一句：占**一个框**那么大（与任务行等高，卡内浅底），
 * 按「当年第几天」取模轮换 —— 每天自动换一条，不用手动维护。
 * 底色用中性浅底而不是浅赭：这一屏的赭金只给主角卡的进度。
 * 文案只做鼓励，不吹成绩、不替用户宣布结果（与全站口径一致）。
 */
const DAILY_QUOTES = [
  '你走的每一步，都算数。',
  '完成比完美更重要，先走完这一件。',
  '慢一点没关系，方向对就一直往前。',
  '今天多做的一小步，是明天的底气。',
  '不积跬步，无以至千里。',
  '停下来看看，这些都是你亲自走出来的路。',
  '你已经比昨天更靠近想去的地方了。',
  '把手上这件做完，就是最好的开始。',
]

function DailyQuote() {
  const quote = useMemo(() => {
    const now = new Date()
    const startOfYear = new Date(now.getFullYear(), 0, 0)
    const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86_400_000)
    return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length]
  }, [])

  return (
    <div className="flex h-[76px] shrink-0 items-center gap-3 rounded-lg bg-surface-inset px-3.5 py-2.5 text-on-surface">
      <Sparkles className="size-5 shrink-0 text-on-surface-variant" aria-hidden />
      <p className="line-clamp-2 text-headline-sm">{quote}</p>
    </div>
  )
}

/** 某一栏没有内容时的真话提示：与列表行同一种 inset 外观（不是错误，不用空态框） */
function SupportLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <Panel inset>
      <div className="flex items-center gap-2.5 text-body-sm text-on-surface-variant">
        <span className="flex shrink-0 items-center" aria-hidden>
          {icon}
        </span>
        {text}
      </div>
    </Panel>
  )
}

/** 进行中卡片右上角的 「···」 菜单：放弃 / 删除（低频、破坏性动作收在这里） */
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
          aria-label={'「' + task.title + '」的更多操作'}
          className="motion-press size-8 shrink-0 px-0 text-on-surface-variant"
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
