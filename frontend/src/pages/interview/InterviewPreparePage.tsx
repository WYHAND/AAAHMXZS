import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Headphones, Mic, Wifi } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import { Reveal, staggerDelay } from '@/components/Motion'
import { INTERVIEW_MODES } from '@/constants/interview'
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
 * - 右 5 列补一张「这场面试会怎么进行」，题量 / 怎么问 / 多久三条全部取自真实常量
 *   （constants/interview.ts 的 count 与场景说明、session 页真实的「结束即出复盘」），不编时长数字；
 * - 「返回选择」是弱化动作，退到页面底部一行（ghost / size="sm"）。
 * - 进场与交互反馈只用 index.css 的统一动效语汇（Reveal / motion-press），不写新 keyframes。
 *
 * 2026-10-20 修剪（用户明确点名的三处）：
 * 1. 右栏三条说明**各压到一行**（`会怎么问` 原来折成 4 行）：删掉复述场景清单的长句，
 *    每条形如 `题量：小测试 3 题 / 全真模拟 6 题`；因为压成一行，右卡不再需要
 *    "下面每一条都来自真实的面试设置"这种解释自己的话，一并不写。
 *    行高骤减后右卡比左卡矮，所以右列 `lg:self-start` —— 宁可让它是张小卡，
 *    也不要被 grid 拉到左卡高度、上半截有字下半截全是白的。
 * 2. 主按钮**不再整块变灰**：禁用时文案是「还差 N 项」（N = 3 - 已勾选数），
 *    全部勾上变成「我准备好了」并恢复可用；禁用态保留正文色 + 浅底
 *    （`disabled:bg-surface-container` + `disabled:text-on-surface` + `disabled:opacity-100`），
 *    不用基类里的 `disabled:opacity-50` —— 那样看着像"另一个按钮"，而不是"还差一步"。
 * 3. 标题下那句「点一下就勾选，没有真实设备检测。」去掉：勾选框自己会说话。
 *
 * 勾选行本身不画边框，收进「Panel inset」；**选中也不再铺白底**。
 * 本来选中是 `bg-card`（白），但列表是 `padded={false}`、行贴着浅底块的边，
 * 而全站圆角现在是 18px —— 相邻两行白块的大圆角一挤，行与行的接缝处就掐出
 * 一个尖角楔形（实测截图里像两块被啃了一口的白饼）。所以状态只由
 * **实心墨圆 + 白勾**表达：20px、17:1，比一块白底更清楚，也不依赖颜色。
 * 勾选圈的勾用「text-primary-foreground」（纯白）：原来写「text-background」
 * （画布色）会随 token 漂移；也不用 `text-white`，文字色一律走 token。
 *
 * ⚠️ 2026-10-20 实测：勾选圈原来是 `border-success bg-success text-white`，但在当前
 * 浅色主题的 :root 里 **`--success` 没有定义**（只剩 .dark 里的那一份），
 * 于是 `bg-success` / `border-success` 全部解析成透明、白勾落在白行上 —— 勾选后
 * 只有"整行变白"这一个变化，勾本身看不见。换成本主题里一定有值的 `--primary`（主墨）。
 */
export default function InterviewPreparePage() {
  const navigate = useNavigate()
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const checkedCount = CHECKS.filter((item) => checked[item.key]).length
  const allChecked = checkedCount === CHECKS.length
  const hasSession = Boolean(storage.session.get<string | null>(STORAGE_KEY.interviewId, null))

  /* 题量取自 constants/interview.ts 的 count，与后端 MODE_QUESTION_COUNT 一致（3 / 6）。
     这里原先手写过「小测试 3-5 题」，是**假数字** —— 后端只保留 3 题，
     所以改成从常量派生，页面里不再出现手写题数；换成 " / " 分隔是为了塞进一行。
     也只说真实常量写明的部分，不额外堆一个"约 xx 分钟"的假数。 */
  const modeLine = INTERVIEW_MODES.map((item) => `${item.label} ${item.count} 题`).join(' / ')
  // 拼在 return 之前，避免反引号模板串出现在 JSX 的 {} 表达式里（oxc 会误判）
  const ctaLabel = allChecked ? '我准备好了' : '还差 ' + (CHECKS.length - checkedCount) + ' 项'

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
            <h2 className="text-headline-sm text-primary">开始前确认</h2>

            <Panel inset padded={false} className="flex-1 gap-1">
              {CHECKS.map((item, index) => {
                const active = Boolean(checked[item.key])
                return (
                  <Reveal key={item.key} fade delay={staggerDelay(index)}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                      className="motion-press flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-container"
                    >
                      <span
                        className={cn(
                          'flex size-5 shrink-0 items-center justify-center rounded-full border',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-outline-variant',
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
                /*
                 * 禁用态**不是**灰色实心块，而是"浅底 + 正文色"：
                 * 基类里那条 `disabled:opacity-50` 会把整块压成半透明的灰，
                 * 看着像另一个按钮；这里用 disabled:opacity-100 把它顶掉，
                 * 底色换 --surface-container（#efeeeb），文字留 --on-surface。
                 * 文案本身已经是「还差 N 项」，所以不需要再靠降低对比度表达禁用。
                 */
                className="motion-press w-full shrink-0 disabled:bg-surface-container disabled:text-on-surface disabled:opacity-100 sm:w-auto"
                disabled={!allChecked}
                onClick={() => navigate('/interview/session')}
              >
                {ctaLabel}
              </Button>
            </div>
          </Panel>
        </Reveal>

        {/*
          支撑（右 5 列）：这场面试会怎么进行，每一条都来自真实常量，不编数据。
          2026-10-20：三条压成一行后右卡明显比左卡矮，`lg:self-start` 让它是张
          "小卡"，而不是被 grid 拉到左卡高度、上半截有字下半截一片白。
        */}
        <Reveal delay={140} className="flex min-w-0 flex-col lg:col-span-5 lg:self-start">
          <Panel data-print="card" className="gap-4">
            <h2 className="text-headline-sm text-primary">这场面试会怎么进行</h2>
            <dl className="flex flex-col gap-2 border-t border-border pt-3">
              <SpecLine label="题量" value={modeLine} />
              <SpecLine label="会怎么问" value="按你选的场景出题，会追问" />
              <SpecLine label="大概多久" value="由题量决定，结束后出复盘" />
            </dl>
          </Panel>
        </Reveal>
      </div>

      {/* 没有场次时给一条**行内提示**，不套第二张卡 */}
      {!hasSession ? (
        <Reveal delay={220}>
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

/**
 * 一条"会怎么进行"：**一行内** label：value（12px 副墨标签 / 13px 正文值）。
 *
 * 原先是「32px 图标圈 + 12px 标签上一行 + 14px 正文下一行」，右卡在 1025px 下
 * 只有 281px 宽、文字列净宽约 200px，于是 `会怎么问` 折成 4 行、`大概多久` 折成 2 行 ——
 * 三条说明被读成一整段。图标圈去掉（它只占宽度、不带信息），标签与值同行，
 * 每条一句话、一行放得下。
 */
function SpecLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="shrink-0 text-caption text-on-surface-variant">{label}：</span>
      <span className="min-w-0 text-body-sm text-on-surface">{value}</span>
    </div>
  )
}
