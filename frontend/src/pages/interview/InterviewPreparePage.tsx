import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Headphones, Mic, Wifi } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { PageShell } from '@/components/PageShell'
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
      <Card data-print="card">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">开始前确认</CardTitle>
          <CardDescription>点一下就是勾选，没有真实设备检测</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {CHECKS.map((item) => {
            const active = Boolean(checked[item.key])
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setChecked((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
                  active ? 'border-success bg-success/10' : 'border-border hover:bg-secondary',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full border',
                    active ? 'border-success bg-success text-background' : 'border-border',
                  )}
                  aria-hidden
                >
                  {active ? <Check className="size-3" /> : null}
                </span>
                <span className="flex flex-col">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    {item.icon}
                    {item.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{item.desc}</span>
                </span>
              </button>
            )
          })}
        </CardContent>
      </Card>

      {!hasSession ? (
        <p className="text-sm text-muted-foreground">
          还没有创建面试场次，先去上一步选岗位和形式。
        </p>
      ) : null}

      <div className="flex justify-end">
        {/* 本页唯一实心主按钮 */}
        <Button
          variant="warm"
          disabled={!allChecked}
          onClick={() => navigate('/interview/session')}
        >
          {allChecked ? '开始面试' : '先勾选上面的确认项'}
        </Button>
      </div>
    </PageShell>
  )
}
