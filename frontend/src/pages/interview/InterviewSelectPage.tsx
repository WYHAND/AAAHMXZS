import { useState } from 'react'
import type { ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, Cpu, FolderKanban, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import {
  DEFAULT_INTERVIEW_MODE,
  DEFAULT_INTERVIEW_SCENE,
  INTERVIEW_MODES,
  INTERVIEW_SCENES,
} from '@/constants/interview'
import { RESUME_TARGET_JOB_MAX } from '@/constants/form'
import { useInterviewStore } from '@/store/interviewStore'
import { cn } from '@/lib/utils'

/**
 * 面试配置（设计说明书 2.1 /interview，M2）
 *
 * Fix A：后端没有 GET /interview/options —— 模式与场景改为前端常量
 * （constants/interview.ts，取值与后端 InterviewStartRequest 的枚举一致）。
 * 提交到 POST /interview/start，body { mode, scene, target_job }。
 * interviewId 由 store 落到 sessionStorage，供 /interview/session 使用。
 *
 * 2026-10 收口之一：三张等高 `Card` 合成一张 `<Panel>` 的三个小节，一屏一个主角。
 *
 * 2026-10 收口之二（本次，取 Stitch `_2/code.html` 的**结构**、不取它的冷蓝白配色）：
 * - 页头下方加**轻量四步流程指示**（真名取自真实路由与页面标题，只标"当前阶段"，
 *   不写完成比例、不画彩色时间轴）；
 * - 三个小节拆成**三块独立面板**（1px 描边分层、卡内 16px、卡间 12px、区块间 24px），
 *   目标岗位 / 强度 / 场景 各自成块，不再挤在一张卡里；
 * - 选项卡选中态重做：**白底 + border-primary + bg-primary-soft/40 + 左上 6px 琥珀点
 *   + ring-1 ring-primary/25**（旧写法"深墨粗边 + 大面积灰底"在这一版里被替换掉），
 *   并且 `aria-pressed` 同步 —— 选中态不只靠颜色；
 * - 底部把「配置概要」与唯一主按钮**收进同一块面板**，按钮不再漂浮在页面右下角。
 *
 * 稿子里没有真数据的东西一律不做：时长估计（约 10-15 分钟）、「推荐/主力」标签、
 * 隐私录制提示、论坛面/编码设计等我们后端不支持的场景。
 */
export default function InterviewSelectPage() {
  const navigate = useNavigate()
  const startInterview = useInterviewStore((s) => s.start)
  const [mode, setMode] = useState<string>(DEFAULT_INTERVIEW_MODE)
  const [scene, setScene] = useState<string>(DEFAULT_INTERVIEW_SCENE)
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
  const jobText = targetJob.trim() || '按你的简历出题'
  const modeLabel = INTERVIEW_MODES.find((m) => m.value === mode)?.label ?? mode
  const sceneLabel = INTERVIEW_SCENES.find((s) => s.value === scene)?.label ?? scene

  return (
    <PageShell
      title="模拟面试"
      description="先在安全的地方把话说一遍，真面试时才不慌。"
      breadcrumb="模拟面试"
    >
      <InterviewFlowStrip />

      <section aria-labelledby="target-job-title" className="flex flex-col gap-3">
        <Panel className="!p-4 gap-3 border border-border shadow-none">
          <SectionHeading
            id="target-job-title"
            title="目标岗位"
            desc="越具体，问题越像真的（可留空，我会按你的简历出题）"
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="target_job" className="text-body-sm text-on-surface-variant">
              岗位名称
            </Label>
            <Input
              id="target_job"
              value={targetJob}
              maxLength={RESUME_TARGET_JOB_MAX}
              onChange={(e) => setTargetJob(e.target.value)}
              placeholder="比如：前端开发工程师"
              className="h-11 text-body-md"
            />
          </div>
        </Panel>
      </section>

      <section aria-labelledby="intensity-title" className="flex flex-col gap-3">
        <SectionHeading
          id="intensity-title"
          title="面试强度"
          desc="先小测试找感觉，再上全真"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {INTERVIEW_MODES.map((item) => (
            <OptionCard
              key={item.value}
              active={mode === item.value}
              title={item.label}
              desc={item.desc}
              onClick={() => setMode(item.value)}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="scene-title" className="flex flex-col gap-3">
        <SectionHeading
          id="scene-title"
          title="面试场景"
          desc="不同场景问的东西完全不一样"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {INTERVIEW_SCENES.map((item) => (
            <OptionCard
              key={item.value}
              active={scene === item.value}
              title={item.label}
              desc={item.desc}
              icon={SCENE_ICON[item.value]}
              onClick={() => setScene(item.value)}
            />
          ))}
        </div>
      </section>

      {/* 结束区：概要 + 唯一主按钮在**同一块**面板里，按钮不再单独漂在页面右下角 */}
      <Panel className="!p-4 border border-border shadow-none">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-caption text-caption-foreground">当前配置概要</span>
            <p className="text-body-md text-primary">
              已选：{jobText} · {modeLabel} · {sceneLabel}
            </p>
          </div>
          <Button
            variant="warm"
            size="lg"
            className="w-full shrink-0 sm:w-auto"
            onClick={() => void start()}
            disabled={starting}
          >
            {starting ? '准备中…' : '下一步：准备设备'}
            <ArrowRight aria-hidden />
          </Button>
        </div>
      </Panel>
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
                   text-outline-variant(#c5c6cd) 在画布上只有 1.62:1，被对比度巡检抓出，
                   改用 caption-foreground(#6b7280 → 4.5:1)。只换颜色，结构不动。 */
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
                    className="grid size-4 shrink-0 place-items-center rounded-full border border-border bg-surface-container-low text-[10px] leading-none text-on-surface-variant"
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

/** 小节标题：16/600 主墨 + 一句 13px 说明（全页统一，不各写一份） */
function SectionHeading({
  id,
  title,
  desc,
}: {
  id: string
  title: string
  desc: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="text-headline-sm text-primary">
        {title}
      </h2>
      <p className="text-body-sm text-on-surface-variant">{desc}</p>
    </div>
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
 * 选中态：白底 + `border-primary` + `bg-primary-soft/40` + 左上角 6px 琥珀点
 * + `ring-1 ring-primary/25`；`aria-pressed` 与视觉同步 —— 状态不只靠颜色。
 * 未选中：白底 + `border-border`，hover 抬边（`hover:border-primary/40`）。
 * 键盘焦点用 `focus-visible` 环，与 hover 区分得开。
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
        'flex min-h-[68px] flex-col gap-1 rounded-xl border bg-card p-4 text-left transition-colors',
        'outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'border-primary bg-primary-soft/40 ring-1 ring-primary/25'
          : 'border-border hover:border-primary/40',
      )}
    >
      <span className="flex items-center gap-2">
        {/* 状态点：选中才出现，占真实宽度（不用绝对定位，避免压到标题首字） */}
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            active ? 'bg-secondary' : 'bg-transparent',
          )}
          aria-hidden
        />
        {Icon ? <Icon className="size-4 shrink-0 text-on-surface-variant" /> : null}
        <span className="text-headline-sm text-primary">{title}</span>
      </span>
      <span className="text-body-sm text-on-surface-variant">{desc}</span>
    </button>
  )
}
