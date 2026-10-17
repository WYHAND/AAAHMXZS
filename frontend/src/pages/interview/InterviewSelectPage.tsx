import { useState } from 'react'
import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, Cpu, FolderKanban, Sparkles, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import { Reveal, staggerDelay } from '@/components/Motion'
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
 *
 * 2026-10 收口（对齐首页「一屏一个主角」）：
 * - 页头一句人话；左 7 列是**主角卡**：按当前阶段推荐一个场景 + 唯一的实心 CTA「开始这一场」；
 * - 右 5 列是**选择区**（换成别的场景 / 想要多真实），两段都是同一套可选卡片；
 * - 选中态 = 「bg-primary-soft」+「ring-1 ring-primary/30」+「border-primary」（规范 2.1：
 *   只靠浅底表达选中不合格，必须配描边环）；
 * - 琥珀只在主角卡的「为你推荐」小 chip 上出现一次 —— 不给每张卡都点暖色；
 * - 进场与交互反馈只用 index.css 的统一动效语汇（Reveal / motion-lift / motion-press），
 *   不写新 keyframes 也不做循环动画。
 *
 * 行为一个字没动：仍是「POST /interview/start」（body 相同），成功后「navigate('/interview/prepare')」；
 * 模式/场景仍取自 constants/interview.ts。**推荐只改默认选中**，属于展示层，
 * 接口调用与 store 的读写方式保持不变。
 */

/** 按阶段推荐哪个场景：探索期先练最好开口的 HR 面，准备期练项目面，冲刺期练技术面 */
const RECOMMENDED_SCENE: Record<Stage, string> = {
  explore: 'HR',
  prepare: '项目',
  sprint: '技术',
}

/** 推荐理由：跟着阶段说明（constants/stage.ts 的 STAGE_DESC 语义）说，不编数据 */
const RECOMMEND_REASON: Record<Stage, string> = {
  explore: '你还在找方向，先从最容易开口的 HR 面练，把动机和经历讲顺。',
  prepare: '方向大体定了，项目面最能练出经得起追问的经历。',
  sprint: '已经在投递节奏里，技术面最接近真实考察，练完能直接用。',
}

export default function InterviewSelectPage() {
  const navigate = useNavigate()
  const startInterview = useInterviewStore((s) => s.start)
  const { stage, label: stageLabel } = useStage()

  const [mode, setMode] = useState<string>(DEFAULT_INTERVIEW_MODE)
  // 默认选中按阶段推荐的场景；推荐只是默认值，点别的卡片就换掉
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

  // 概要条的文字全部由当前 state 派生（真数据实时联动）
  const heroScene = INTERVIEW_SCENES.find((item) => item.value === scene) ?? INTERVIEW_SCENES[0]
  const isRecommended = scene === RECOMMENDED_SCENE[stage]
  const jobText = targetJob.trim() || '按你的简历出题'
  const modeLabel = INTERVIEW_MODES.find((item) => item.value === mode)?.label ?? mode
  const sceneLabel = heroScene.label
  const HeroIcon = SCENE_ICON[heroScene.value]

  /*
   * 主角卡的注释：只有当你选的就是推荐场景时才讲「为什么推荐」；
   * 自己换过场景后，那句阶段理由就不成立了 —— 换成一句承认选择的话，不说假话。
   * （拼在 return 之前，避免反引号模板串出现在 JSX 的 {} 表达式里。）
   */
  const heroNote = isRecommended
    ? RECOMMEND_REASON[stage]
    : '已经换成' + heroScene.label + '，开始就按这个来。'

  return (
    <PageShell
      title="模拟面试"
      description="选一种你最想练的场景，我来扮演面试官。"
      breadcrumb="模拟面试"
    >
      <Reveal fade>
        <InterviewFlowStrip />
      </Reveal>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 主角（左 7 列）：当前这一场长什么样 + 整页唯一的实心 CTA */}
        <Reveal lg className="flex min-w-0 flex-col lg:col-span-7">
          <Panel data-print="card" className="flex-1 gap-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {isRecommended ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-secondary-fixed px-2.5 py-1 text-caption font-medium text-on-secondary-fixed">
                  <span className="size-1.5 shrink-0 rounded-full bg-secondary" aria-hidden />
                  为你推荐
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full bg-surface-container px-2.5 py-1 text-caption text-on-surface-variant">
                  你选的场景
                </span>
              )}
              <span className="text-caption text-on-surface-variant">当前阶段：{stageLabel}</span>
            </div>

            <div className="flex items-start gap-4">
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
                aria-hidden
              >
                {HeroIcon ? <HeroIcon className="size-5" /> : null}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-headline-sm text-primary">{heroScene.label}</h2>
                <p className="text-body-md text-on-surface-variant">{heroScene.desc}</p>
              </div>
            </div>

            <Panel inset>
              <div className="flex items-start gap-2.5">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-on-surface-variant" aria-hidden />
                <p className="text-body-sm text-on-surface-variant">{heroNote}</p>
              </div>
            </Panel>

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
              <p className="text-body-sm text-on-surface-variant">留空也行，我会直接按你的简历出题。</p>
            </div>

            <div className="mt-auto flex flex-col gap-4 border-t border-surface-container-low pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-body-sm text-on-surface-variant">
                将开始：{jobText} · {modeLabel} · {sceneLabel}
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

        {/* 选择区（右 5 列）：场景与强度用同一套可选卡片 */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-5">
          <Reveal fade delay={80}>
            <section aria-labelledby="scene-title" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 id="scene-title" className="text-headline-sm text-primary">
                  换成别的场景
                </h2>
                <p className="text-body-sm text-on-surface-variant">
                  不同场景问的东西完全不一样，选一个你最想练的。
                </p>
              </div>
              <ul className="flex flex-col gap-2.5">
                {INTERVIEW_SCENES.map((item, index) => (
                  <Reveal as="li" key={item.value} delay={staggerDelay(index)}>
                    <OptionCard
                      active={scene === item.value}
                      title={item.label}
                      desc={item.desc}
                      icon={SCENE_ICON[item.value]}
                      onClick={() => setScene(item.value)}
                    />
                  </Reveal>
                ))}
              </ul>
            </section>
          </Reveal>

          <Reveal fade delay={140}>
            <section aria-labelledby="mode-title" className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h2 id="mode-title" className="text-headline-sm text-primary">
                  想要多真实
                </h2>
                <p className="text-body-sm text-on-surface-variant">
                  先熟悉一下节奏，还是直接走一遍完整流程。
                </p>
              </div>
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {INTERVIEW_MODES.map((item, index) => (
                  <Reveal as="li" key={item.value} delay={staggerDelay(index)}>
                    <OptionCard
                      active={mode === item.value}
                      title={item.label}
                      desc={item.desc}
                      onClick={() => setMode(item.value)}
                    />
                  </Reveal>
                ))}
              </ul>
            </section>
          </Reveal>
        </div>
      </div>
    </PageShell>
  )
}

/**
 * 四步流程指示。
 *
 * 步骤名严格取自**真实路由与页面标题**（/interview → /interview/prepare →
 * /interview/session → /interview/review/:id），不新增步骤、不写进度比例，
 * 也不出现"完成/进行中"这类我们无法从后端得知的状态 —— 只有第 1 步是**真的**当前页。
 *
 * 当前步（面试配置）：白底描边胶囊 + 6px 琥珀点 + 主墨文字；
 * 其余步：序号小圆点 + text-on-surface-variant。
 * 不使用 opacity 弱化（会顺带压低文字对比度，被 probe 判成低对比）。
 */
const INTERVIEW_FLOW = ['面试配置', '准备设备', '模拟面试', '复盘报告'] as const

function InterviewFlowStrip() {
  return (
    <nav aria-label="面试流程" className="flex flex-col gap-2">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {INTERVIEW_FLOW.map((label, index) => {
          const current = index === 0
          return (
            <li key={label} className="flex items-center gap-1">
              {index > 0 ? (
                /* 装饰性分隔符（aria-hidden），但**看得见**就必须达标：
                   用 caption-foreground（#6b7280 → 4.5:1），不用只有 1.62:1 的 outline-variant。 */
                <span className="px-1 text-caption text-caption-foreground" aria-hidden>
                  /
                </span>
              ) : null}
              {current ? (
                <span
                  aria-current="step"
                  className="inline-flex items-center gap-2 rounded-full border border-primary bg-card px-3 py-1.5 text-body-sm font-medium text-primary ring-1 ring-primary/25"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-secondary" aria-hidden />
                  {label}
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 px-1 py-1.5 text-body-sm text-on-surface-variant">
                  <span
                    className="grid size-4 shrink-0 place-items-center rounded-full border border-border bg-surface-container-low text-caption leading-none text-on-surface-variant"
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

/** 场景卡左侧的辅助识别图标（16px 线性图标，不是插画） */
const SCENE_ICON: Record<string, ComponentType<{ className?: string }>> = {
  HR: Users,
  项目: FolderKanban,
  技术: Cpu,
}

/**
 * 选项卡（强度 / 场景共用同一套视觉语言）。
 *
 * 选中态：「bg-primary-soft」+「ring-1 ring-primary/30」+「border-primary」
 * —— 规范 2.1 明说"单靠浅底表达选中不合格"，描边环让它在浅色背景上清晰可辨；
 * 「aria-pressed」与视觉同步，状态不只靠颜色。
 * 未选中：白底 +「border-border」，「hover:border-primary/40」轻抬边。
 *
 * 动效：整张卡可点 → 「motion-lift」（悬浮轻抬 2px）+「motion-press」（按下轻缩）。
 * 这里不用 transition-colors（工具类会盖掉 motion-lift 的 transform 过渡），
 * 边色过渡由 motion-lift 自带的 border-color 过渡负责。
 */
function OptionCard({
  active,
  title,
  desc,
  icon: Icon,
  onClick,
}: {
  active: boolean
  title: string
  desc: string
  icon?: ComponentType<{ className?: string }>
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'motion-lift motion-press flex h-full w-full flex-col gap-1 rounded-xl border bg-card p-4 text-left',
        'outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'border-primary bg-primary-soft ring-1 ring-primary/30'
          : 'border-border hover:border-primary/40',
      )}
    >
      <span className="flex items-center gap-2">
        {Icon ? <Icon className="size-4 shrink-0 text-on-surface-variant" /> : null}
        <span className="text-headline-sm text-primary">{title}</span>
      </span>
      <span className="text-body-sm text-on-surface-variant">{desc}</span>
    </button>
  )
}
