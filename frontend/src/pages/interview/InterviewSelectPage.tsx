import { useState } from 'react'
import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, ClipboardList, Cpu, FolderKanban, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import { Reveal } from '@/components/Motion'
import { DEFAULT_INTERVIEW_MODE, INTERVIEW_MODES, INTERVIEW_SCENES } from '@/constants/interview'
import { RESUME_TARGET_JOB_MAX } from '@/constants/form'
import { useInterviewStore } from '@/store/interviewStore'
import { useStage } from '@/hooks/useStage'
import type { Stage } from '@/constants/stage'
import { cn } from '@/lib/utils'

/**
 * 面试配置（设计说明书 2.1 /interview，M2）
 *
 * Fix A：后端没有 GET /interview/options —— 模式与场景改为前端常量
 * （constants/interview.ts，取值与后端 InterviewStartRequest 的枚举一致）。
 * 提交到 POST /interview/start，body { mode, scene, target_job }。
 * interviewId 由 store 落到 sessionStorage，供 /interview/session 使用。
 * 行为一个字没动：仍是 POST /interview/start -> navigate('/interview/prepare')。
 *
 * 2026-10-11 结构改版（用户从两个方向里定的 A「单卡配置台」）：
 * 为什么不是继续修原来那张左卡 —— 原来左 7 / 右 5 两列，在用户日常的 **1025px**
 * 下右列只剩 286px，要塞 3 张场景卡 + 2 张模式卡，于是右列比左列高；grid 默认拉伸
 * 行高、左卡又是 `flex-1`，左卡被拉到右列高度，再由 `mt-auto` 把 CTA 钉到底 ——
 * 实测卡内最大空隙 **139px**（就在"目标岗位"提示之后）。所以"减少左侧内容"永远
 * 治不好那块空白，必须改结构。
 *
 * 现在的排布：**一屏一张卡**，卡内「左边选、右边看」：
 * - 左：面试场景 3 行 + 模拟方式 2 行（标准单选行，整行可点）；
 * - 右：一句简介（"你在练的这类题长什么样"）**不再复述左边选中的场景名**，
 *   下面两条**定义式**事实（`题量：3 题` / `出题依据：简历 · 目标岗位 · 画像`）；
 * - 底部一条操作带（浅底 + 分隔线）：一句配置摘要 + 整页唯一的实心 CTA。
 * 实测：卡内最大空隙 139px -> 0px，主 CTA 由 754px 提到 741px（1025×900 首屏内），
 * 卡片宽度 411px -> 721px（用满内容列，不再有 286px 的窄栏）。
 *
 * 选中态（场景行 / 模式行共用）：**浅底 + 左侧 3px 竖条 + 实心墨点**。
 * 原来只有 `bg-primary-soft`（#eceef1）一间浅底 + `ring-1 ring-primary/30`，
 * 选中与否几乎全靠那 1px 环，眯眼就分不出来；现在竖条第一眼、底色第二眼，
 * 另加**非颜色指示器**（右侧实心墨点）兜底灰度场景。详见 OptionRow 的注释。
 *
 * 另订正一处**假数字**：原来模式卡写「小测试 3-5 题」，而后端
 * MODE_QUESTION_COUNT 是 {小测试:3, 全真:6} 且会截断，界面上的"3-5"是假的。
 * 现在题量统一取自 constants/interview.ts 的 `count`，页面不再手写数字。
 *
 * 进场与交互反馈只用 index.css 的统一动效语汇（Reveal / motion-press），不写新 keyframes。
 */

/** 按阶段推荐哪个场景：探索期先练最好开口的 HR 面，准备期练项目面，冲刺期练技术面 */
const RECOMMENDED_SCENE: Record<Stage, string> = {
  explore: 'HR',
  prepare: '项目',
  sprint: '技术',
}

/** 场景卡左侧的辅助识别图标（16px 线性图标，不是插画） */
const SCENE_ICON: Record<string, ComponentType<{ className?: string }>> = {
  HR: Users,
  项目: FolderKanban,
  技术: Cpu,
}

export default function InterviewSelectPage() {
  const navigate = useNavigate()
  const startInterview = useInterviewStore((s) => s.start)
  const { stage, label: stageLabel } = useStage()

  const [mode, setMode] = useState<string>(DEFAULT_INTERVIEW_MODE)
  // 默认选中按阶段推荐的场景；推荐只是默认值，点别的行就换掉
  const [scene, setScene] = useState<string>(() => RECOMMENDED_SCENE[stage])
  const [targetJob, setTargetJob] = useState('')
  const [starting, setStarting] = useState(false)

  const start = async () => {
    setStarting(true)
    const interviewId = await startInterview({
      mode,
      scene,
      target_job: targetJob.trim() || null,
    })
    setStarting(false)
    if (interviewId) {
      navigate('/interview/prepare')
    } else {
      toast.error('没能创建面试，请稍后再试')
    }
  }

  // 概要条与右栏的文字全部由当前 state 派生（真数据实时联动）
  const heroScene = INTERVIEW_SCENES.find((item) => item.value === scene) ?? INTERVIEW_SCENES[0]
  const isRecommended = scene === RECOMMENDED_SCENE[stage]
  const jobText = targetJob.trim() || '按你的简历出题'
  const modeCount =
    INTERVIEW_MODES.find((item) => item.value === mode)?.count ?? INTERVIEW_MODES[0].count
  const sceneLabel = heroScene.label

  return (
    <PageShell
      title="模拟面试"
      description="选一种你最想练的场景，我来扮演面试官。"
      breadcrumb="模拟面试"
    >
      <Reveal fade>
        <InterviewFlowStrip />
      </Reveal>

      <Reveal lg>
        <Panel data-print="card" padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-0">
            {isRecommended ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-surface-container px-2.5 py-1 text-caption font-medium text-on-surface">
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                按你的阶段推荐
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full bg-surface-container px-2.5 py-1 text-caption text-on-surface-variant">
                你选的场景
              </span>
            )}
            <span className="text-caption text-caption-foreground">当前阶段：{stageLabel}</span>
          </div>

          {/* 左：选；右：看 —— 选中项的说明只在右边出现一次，选项行只留名字与图标 */}
          <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_1.05fr]">
            <div className="flex min-w-0 flex-col gap-5">
              <section aria-labelledby="scene-title" className="flex flex-col gap-2">
                <h2 id="scene-title" className="text-headline-sm text-primary">
                  面试场景
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {INTERVIEW_SCENES.map((item) => (
                    <li key={item.value}>
                      <OptionRow
                        active={scene === item.value}
                        title={item.label}
                        icon={SCENE_ICON[item.value]}
                        onClick={() => setScene(item.value)}
                      />
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="mode-title" className="flex flex-col gap-2">
                <h2 id="mode-title" className="text-headline-sm text-primary">
                  模拟方式
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {INTERVIEW_MODES.map((item) => (
                    <li key={item.value}>
                      <OptionRow
                        active={mode === item.value}
                        title={item.label}
                        desc={item.desc}
                        onClick={() => setMode(item.value)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              {/*
                浅底块只装自己那点内容（不加 flex-1、不加 justify-between）。
                它原来出过事：被当成 grid 子项拉成整行高、再用 justify-between 摊开，
                块内就撑出 89px 的空洞 —— 和原版左卡那 139px 是同一种病。

                2026-10 收口：标题不再复述左边选中的场景名（"项目面"）——
                同一句在这一屏出现三次（选项行 / 这里 / 底部摘要），这里改成
                「这场面试会怎么进行」，只承担"简介 + 两个事实"。
                「题量 / 出题依据」原来是 dt 一排、dd 一排版，读起来串成
                "题量 出题依据 / 3 题 简历·目标岗位·画像"；现在是两行定义式。
              */}
              <Panel inset className="gap-3">
                <div className="flex items-start gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-primary ring-1 ring-primary/30"
                    aria-hidden
                  >
                    <ClipboardList className="size-5" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="text-headline-sm text-primary">这场面试会怎么进行</h2>
                    <p className="text-body-sm text-on-surface-variant">{heroScene.desc}</p>
                  </div>
                </div>

                <dl className="flex flex-col gap-1 border-t border-border pt-3">
                  <FactLine label="题量" value={modeCount + ' 题'} />
                  <FactLine label="出题依据" value="简历 · 目标岗位 · 画像" />
                </dl>
              </Panel>

              {/* 目标岗位放进右栏：它是「这一场」的设置，和上面的预览同类；
                  也让左右两栏高度接近，整张卡不会被某一列顶高。 */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="target_job" className="text-body-sm text-on-surface-variant">
                  目标岗位（可留空）
                </Label>
                <Input
                  id="target_job"
                  value={targetJob}
                  maxLength={RESUME_TARGET_JOB_MAX}
                  onChange={(e) => setTargetJob(e.target.value)}
                  placeholder="比如：前端开发工程师"
                  className="h-11 text-body-md"
                />
                <p className="text-body-sm text-on-surface-variant">
                  留空也行：会按你的简历、目标岗位与画像出题。
                </p>
              </div>
            </div>
          </div>

          {/*
            小屏（<lg）把这条操作带**钉在视口底部**：移动端堆叠顺序是
            场景 -> 模拟方式 -> 预览 -> 目标岗位 -> CTA，390px 下 CTA 会落到 y≈1114，
            而首屏只有 844 —— 用户进页面看不到「开始这一场」，
            直接违反 T10 的验收要求"首屏看得到主角和主 CTA"。
            sticky bottom-0 让小屏始终看得见它；lg 及以上用 static 还原成普通排版
            （桌面本来就看得见），所以 1025/1440 的版式与定下来的方向 A 完全一致。
            ⚠️ 因此这个 Panel **不能**加 overflow-hidden：祖先一旦成为滚动容器，sticky 就失效。
          */}
          <div className="sticky bottom-0 z-10 flex flex-col gap-4 border-t border-border bg-surface-container-low p-5 sm:flex-row sm:items-center sm:justify-between lg:static">
            <p className="text-body-sm text-on-surface-variant">
              将开始：{jobText} · {modeCount} 题 · {sceneLabel}
            </p>
            <Button
              variant="warm"
              size="lg"
              className="motion-press w-full shrink-0 sm:w-auto"
              onClick={() => void start()}
              disabled={starting}
            >
              {starting ? '准备中…' : '开始这一场'}
              <ArrowRight aria-hidden />
            </Button>
          </div>
        </Panel>
      </Reveal>
    </PageShell>
  )
}

/**
 * 四步流程指示。
 *
 * 步骤名严格取自**真实路由与页面标题**（/interview -> /interview/prepare ->
 * /interview/session -> /interview/review/:id），不新增步骤、不写进度比例，
 * 也不出现"完成/进行中"这类我们无法从后端得知的状态 —— 只有第 1 步是**真的**当前页。
 *
 * 当前步与选项卡共用同一套选中语言（浅墨底 + 1px 环 + 墨点），
 * 不再叠 `border-primary`（那是"深墨粗框"的来源）。
 * 其余步用序号小圆点 + text-on-surface-variant；不使用 opacity 弱化
 * （会顺带压低文字对比度，被 probe 判成低对比）。
 */
const INTERVIEW_FLOW = ['面试配置', '准备设备', '模拟面试', '复盘报告'] as const

function InterviewFlowStrip() {
  return (
    <nav aria-label="面试流程">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {INTERVIEW_FLOW.map((label, index) => {
          const current = index === 0
          return (
            <li key={label} className="flex items-center gap-1">
              {index > 0 ? (
                /* 装饰性分隔符（aria-hidden），但**看得见**就必须达标：
                   用 caption-foreground（#6b7280 -> 4.5:1），不用只有 1.62:1 的 outline-variant。 */
                <span className="px-1 text-caption text-caption-foreground" aria-hidden>
                  /
                </span>
              ) : null}
              {current ? (
                <span
                  aria-current="step"
                  className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-body-sm font-medium text-primary ring-1 ring-primary/30"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {label}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 px-1 py-1.5 text-body-sm text-on-surface-variant">
                  <span
                    className="grid size-4 shrink-0 place-items-center rounded-full border border-outline-variant text-caption leading-none text-on-surface-variant"
                    aria-hidden
                  >
                    {index + 1}
                  </span>
                  {label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * 非颜色选中指示器：未选中是空心环，选中是环 + 实心墨点。
 * 只靠"浅底 + 描边"表达选中，在灰度或色觉障碍下分不出来；这个点不依赖颜色。
 */
function SelectionDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-full border bg-card',
        active ? 'border-primary' : 'border-outline-variant',
      )}
    >
      {active ? <span className="size-[8px] rounded-full bg-primary" /> : null}
    </span>
  )
}

/**
 * 单选项（场景 / 模拟方式共用一套视觉语言）。
 *
 * 选中态（2026-10 收口）：**浅底 + 左侧 3px 竖条 + 实心墨点**。
 * 原来只有 `bg-primary-soft`（#eceef1，在暖白卡上几乎看不出）+ `ring-1 ring-primary/30`，
 * 选中与未选中的差别全压在 1px 描边上，眯眼就看不出来；现在竖条是第一眼的信息，
 * 底色是第二眼，墨点是不依赖颜色的第三重指示。
 * - 竖条：`border-l-[3px] border-primary`，颜色只借 --primary，不新增颜色；
 * - 竖条只在 **lg 及以上**出现（`lg:border-l-[3px]`）：窄屏这一版不动，仍是
 *   "浅底 + 墨点"，不在手机上再加一道更重的边；
 * - 未选中行**也**铺同宽透明竖条（`lg:border-transparent`），这样两类行的文字左边界
 *   严丝合缝对齐，不会因为选中而整行文字右移 3px；视觉上未选中行没有边框；
 * - 环（ring）撤掉：竖条已经承担了强调，再叠一圈 1px 就是当初那条"深墨粗框"。
 */
function OptionRow({
  active,
  title,
  desc,
  icon: Icon,
  onClick,
}: {
  active: boolean
  title: string
  desc?: string
  icon?: ComponentType<{ className?: string }>
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'motion-press flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none lg:border-l-[3px]',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'bg-primary-soft lg:border-primary'
          : 'hover:bg-surface-container-low lg:border-transparent',
      )}
    >
      {Icon ? (
        <Icon
          className={cn('size-4 shrink-0', active ? 'text-primary' : 'text-on-surface-variant')}
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-md font-medium text-on-surface">{title}</span>
        {desc ? <span className="text-body-sm text-on-surface-variant">{desc}</span> : null}
      </span>
      <SelectionDot active={active} />
    </button>
  )
}

/**
 * 一行「标签：值」—— 2026-10 改成**同一行内的定义式**。
 *
 * 原来是 dt 一排、dd 一排（`flex-wrap` + `gap-x-6`），在窄栏里会折成
 * 「题量　出题依据」/「3 题　简历·目标岗位·画像」两行，两个标签挤在上、
 * 两个值对不上下面的标签，读起来像串行。
 * 现在标签 12px 副墨、值 13px 主墨，`items-baseline` 对齐，一条事实一行。
 *
 * 标签为什么用 12px 而不是更小：它不是装饰，是承载信息的文字；
 * 主墨/副墨两级已经够分层，`text-caption-foreground`（#6b7280）在卡内浅底上
 * 只有 4.37:1，达不到 WCAG 小字 4.5:1，所以用 `text-on-surface-variant`（#45474c）。
 */
function FactLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="shrink-0 text-caption text-on-surface-variant">{label}：</dt>
      <dd className="min-w-0 text-body-sm font-medium text-on-surface">{value}</dd>
    </div>
  )
}
