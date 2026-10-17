import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Headphones, ListChecks, MessageSquare, Mic, Timer, Wifi } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import { Reveal, staggerDelay } from '@/components/Motion'
import { INTERVIEW_SCENES } from '@/constants/interview'
import { STORAGE_KEY, storage } from '@/utils/storage'
import { cn } from '@/lib/utils'

const CHECKS = [
  { key: 'mic', icon: <Mic className="size-4" />, title: '麦克风可用', desc: '语音模式下需要，文字模式可跳过' },
  { key: 'network', icon: <Wifi className="size-4" />, title: '网络稳定', desc: '断流会导致面试中断' },
  { key: 'quiet', icon: <Headphones className="size-4" />, title: '环境安静', desc: '找个能开口说话的地方' },
] as const

/**
 * 面试准备（设计说明书 2.1 /interview/prepare，M2）
 * 设备 / 场景自查清单，全部勾选后才放行「开始面试」。
 *
 * 2026-10 收口（对齐首页「一屏一个主角」）：
 * - 左 7 列是**主角卡**：清单 + 唯一实心 CTA「我准备好了」，跳转 /interview/session 的逻辑没动；
 * - 右 5 列补一张「这场面试会怎么进行」，几道题 / 怎么问 / 大概多久全部取自真实常量
 *   （constants/interview.ts 的题型与场景说明、session 页真实的「结束即出复盘」），不编时长数字；
 * - 「返回选择」是弱化动作，退到页面底部一行（ghost / size="sm"）。
 * - 进场与交互反馈只用 index.css 的统一动效语汇（Reveal / motion-press），不写新 keyframes。
 *
 * 勾选行本身不画边框，收进「Panel inset」，靠行底色 hover 与勾选圈的实心绿表达状态。
 * 勾选圈的勾用「text-white」（原「text-background」是画布色，token 一改就会漂移）。
 */
export default function InterviewPreparePage() {
  const navigate = useNavigate()
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const allChecked = CHECKS.every((item) => checked[item.key])
  const hasSession = Boolean(storage.session.get<string | null>(STORAGE_KEY.interviewId, null))

  /* 题量取自 constants/interview.ts：小测试登记的就是「3-5 题」，
     这里只说真实常量写明的部分，不额外堆一个"约 xx 分钟"的假数。 */
  const sceneNames = INTERVIEW_SCENES.map((item) => `${item.label}（${item.desc}）`).join('、')
  // 拼在 return 之前，避免反引号模板串出现在 JSX 的 {} 表达式里（oxc 会误判）
  const sceneHint = '按你选的场景来 —— ' + sceneNames

  return (
    <PageShell
      title="面试准备"
      description="开始前先看清这场面试会怎么进行，再确认环境是否就绪。"
      breadcrumb="模拟面试"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 主角（左 7 列）：开始前确认 + 整页唯一的实心 CTA */}
        <Reveal lg className="flex min-w-0 flex-col lg:col-span-7">
          <Panel data-print="card" className="flex-1 gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-headline-sm text-primary">开始前确认</h2>
              <p className="text-body-sm text-on-surface-variant">点一下就是勾选，没有真实设备检测。</p>
            </div>

            <Panel inset padded={false} className="flex-1 gap-1">
              {CHECKS.map((item, index) => {
                const active = Boolean(checked[item.key])
                return (
                  <Reveal key={item.key} fade delay={staggerDelay(index)}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                      className={cn(
                        'motion-press flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition',
                        active ? 'bg-card' : 'hover:bg-surface-container',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full border',
                          active ? 'border-success bg-success text-white' : 'border-outline-variant',
                        )}
                        aria-hidden
                      >
                        {active ? <Check className="size-3" /> : null}
                      </span>
                      <span className="flex flex-col">
                        <span className="flex items-center gap-2 text-body-md font-medium text-primary">
                          {item.icon}
                          {item.title}
                        </span>
                        <span className="text-body-sm text-on-surface-variant">{item.desc}</span>
                      </span>
                    </button>
                  </Reveal>
                )
              })}
            </Panel>

            <div className="mt-auto flex flex-col gap-4 border-t border-surface-container-low pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-body-sm text-on-surface-variant">
                {allChecked ? '都确认好了，开始吧。' : '勾选上面三项就能开始。'}
              </p>
              <Button
                variant="warm"
                size="lg"
                className="motion-press w-full shrink-0 sm:w-auto"
                disabled={!allChecked}
                onClick={() => navigate('/interview/session')}
              >
                我准备好了
              </Button>
            </div>
          </Panel>
        </Reveal>

        {/* 支撑（右 5 列）：这场面试会怎么进行，每一条都来自真实常量，不编数据 */}
        <Reveal delay={80} className="flex min-w-0 flex-col lg:col-span-5">
          <Panel data-print="card" className="flex-1 gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-headline-sm text-primary">这场面试会怎么进行</h2>
              <p className="text-body-sm text-on-surface-variant">
                下面每一条都来自真实的面试设置，不夸大也不省略。
              </p>
            </div>
            <div className="flex flex-col gap-3.5">
              <FactRow
                icon={<ListChecks className="size-4" />}
                label="几道题"
                value="小测试 3-5 题；全真模拟会把完整流程走一遍。"
              />
              <FactRow
                icon={<MessageSquare className="size-4" />}
                label="会怎么问"
                value={sceneHint}
              />
              <FactRow
                icon={<Timer className="size-4" />}
                label="大概多久"
                value="时长由题量决定；中途随时可以结束，结束后立刻出复盘。"
              />
            </div>
          </Panel>
        </Reveal>
      </div>

      {/* 没有场次时给一条**行内提示**，不套第二张卡 */}
      {!hasSession ? (
        <Reveal delay={120}>
          <Panel inset className="flex-row items-center justify-between gap-3 py-2.5">
            <p className="text-body-sm text-on-surface-variant">
              还没有创建面试场次，先去上一步选岗位和形式。
            </p>
            <Button variant="outline" size="sm" asChild className="motion-press">
              <Link to="/interview">去选择</Link>
            </Button>
          </Panel>
        </Reveal>
      ) : null}

      {/* 弱化动作：退到页面底部一行 */}
      <div className="flex justify-start">
        <Button variant="ghost" size="sm" asChild className="motion-press gap-1.5">
          <Link to="/interview">
            <ArrowLeft className="size-4" />
            返回选择
          </Link>
        </Button>
      </div>
    </PageShell>
  )
}

/** 一条"会怎么进行"：图标 + 12px 标签 + 14px 正文（正文色，不拿灰字当信息） */
function FactRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant"
        aria-hidden
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-caption text-on-surface-variant">{label}</span>
        <span className="text-body-md text-on-surface">{value}</span>
      </div>
    </div>
  )
}
