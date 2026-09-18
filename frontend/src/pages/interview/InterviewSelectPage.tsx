import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageShell } from '@/components/PageShell'
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
 * 面试选择（设计说明书 2.1 /interview，M2）
 *
 * Fix A：后端没有 GET /interview/options —— 模式与场景改为前端常量
 * （constants/interview.ts，取值与后端 InterviewStartRequest 的枚举一致）。
 * 提交到 POST /interview/start，body { mode, scene, target_job }。
 * interviewId 由 store 落到 sessionStorage，供 /interview/session 使用。
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

  return (
    <PageShell
      title="模拟面试"
      description="先在安全的地方把话说一遍，真面试时才不慌。"
      breadcrumb="模拟面试"
    >
      <Card data-print="card">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">目标岗位</CardTitle>
          <CardDescription>越具体，问题越像真的（可留空，我会按你的简历出题）</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Label htmlFor="target_job">岗位名称</Label>
          <Input
            id="target_job"
            value={targetJob}
            maxLength={RESUME_TARGET_JOB_MAX}
            onChange={(e) => setTargetJob(e.target.value)}
            placeholder="比如：前端开发工程师"
          />
        </CardContent>
      </Card>

      <Card data-print="card">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">面试强度</CardTitle>
          <CardDescription>先小测试找感觉，再上全真</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {INTERVIEW_MODES.map((item) => (
            <OptionCard
              key={item.value}
              active={mode === item.value}
              title={item.label}
              desc={item.desc}
              onClick={() => setMode(item.value)}
            />
          ))}
        </CardContent>
      </Card>

      <Card data-print="card">
        <CardHeader className="gap-1">
          <CardTitle className="text-base">面试场景</CardTitle>
          <CardDescription>不同场景问的东西完全不一样</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {INTERVIEW_SCENES.map((item) => (
            <OptionCard
              key={item.value}
              active={scene === item.value}
              title={item.label}
              desc={item.desc}
              onClick={() => setScene(item.value)}
            />
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        {/* 本页唯一实心主按钮 */}
        <Button variant="warm" onClick={() => void start()} disabled={starting}>
          {starting ? '准备中…' : '下一步：准备设备'}
        </Button>
      </div>
    </PageShell>
  )
}

function OptionCard({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors',
        active ? 'border-primary bg-primary-soft' : 'border-border hover:bg-secondary',
      )}
    >
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs text-muted-foreground">{desc}</span>
    </button>
  )
}
