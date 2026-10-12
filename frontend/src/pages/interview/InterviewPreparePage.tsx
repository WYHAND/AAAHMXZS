import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Headphones, Mic, Wifi } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
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
 * 2026-10 收口：三项勾选原来是白卡里三行"描边盒子"（边框套边框），
 * 现在收进 `<Panel inset>` 的行列表 —— 勾选行本身不再画边框，
 * 靠行底色的 hover 与勾选圈的实心绿表达状态。
 * 勾选圈的勾用 `text-white`（原 `text-background` —— 那是画布色，
 * token 一改就会漂移，语义上也不是"图标反白"）。
 */
export default function InterviewPreparePage() {
  const navigate = useNavigate()
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const allChecked = CHECKS.every((item) => checked[item.key])
  const hasSession = Boolean(storage.session.get<string | null>(STORAGE_KEY.interviewId, null))

  return (
    <PageShell
      title="面试准备"
      description="花 30 秒确认环境，比中途被打断划算。"
      breadcrumb="模拟面试"
      actions={
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link to="/interview">
            <ArrowLeft className="size-4" />
            返回
          </Link>
        </Button>
      }
    >
      <Panel data-print="card" className="gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-headline-sm text-primary">开始前确认</h2>
          <p className="text-body-sm text-on-surface-variant">点一下就是勾选，没有真实设备检测</p>
        </div>

        <Panel inset padded={false} className="gap-1">
          {CHECKS.map((item) => {
            const active = Boolean(checked[item.key])
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                onClick={() => setChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
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
            )
          })}
        </Panel>
      </Panel>

      {/*
        没有场次时给一条**行内提示**，不套第二张卡（原来是 <p>，现在换成同宽的浅底行）：
        EmptyState 是"整块留白"的语义，这里只是主区块下面的一句实话，不该抢主角。
      */}
      {!hasSession ? (
        <Panel inset className="flex-row items-center justify-between gap-3 py-2.5">
          <p className="text-body-sm text-on-surface-variant">
            还没有创建面试场次，先去上一步选岗位和形式。
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to="/interview">去选择</Link>
          </Button>
        </Panel>
      ) : null}

      <div className="flex justify-end">
        {/* 本页唯一实心主按钮 */}
        <Button
          variant="warm"
          size="lg"
          disabled={!allChecked}
          onClick={() => navigate('/interview/session')}
        >
          {allChecked ? '开始面试' : '先勾选上面的确认项'}
        </Button>
      </div>
    </PageShell>
  )
}
