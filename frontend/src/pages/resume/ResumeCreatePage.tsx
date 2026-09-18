import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

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
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { resumeApi } from '@/api/resume'
import { toResumeReport } from '@/constants/routes'
import { useProfileStore } from '@/store/profileStore'

const STEPS = [
  { title: '基本信息', hint: '只要面试官真的会看的那几项' },
  { title: '教育经历', hint: '学校、专业、时间，成绩好就写' },
  { title: '项目 / 实践', hint: '写清你做了什么、做成什么样' },
  { title: '技能与证书', hint: '只写能聊得下去的' },
  { title: '目标岗位', hint: '决定关键词匹配怎么算' },
] as const

const schema = z.object({
  name: z.string().min(1, { error: '请填写姓名' }),
  phone: z.string().min(6, { error: '请填写联系电话' }),
  email: z.union([z.literal(''), z.email({ error: '邮箱格式不正确' })]),
  school: z.string(),
  major: z.string(),
  education: z.string(),
  project: z.string(),
  skills: z.string(),
  target_job: z.string().min(1, { error: '请填写目标岗位' }),
})

type ResumeForm = z.infer<typeof schema>

/**
 * 引导式新建（设计说明书 2.1 /resume/create，M2）
 *
 * 后端 ResumeCreate：{ title, target_job, parsed_data }，
 * 所以五步表单结果按后端约定的 parsed_data 结构打包：
 *   basics / education / experience / projects / skills
 */
export default function ResumeCreatePage() {
  const navigate = useNavigate()
  const bumpVersion = useProfileStore((s) => s.bumpVersion)
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm<ResumeForm>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      phone: '',
      email: '',
      school: '',
      major: '',
      education: '',
      project: '',
      skills: '',
      target_job: '',
    },
  })

  const FIELDS_BY_STEP: (keyof ResumeForm)[][] = [
    ['name', 'phone', 'email'],
    ['school', 'major', 'education'],
    ['project'],
    ['skills'],
    ['target_job'],
  ]

  const next = async () => {
    const ok = await trigger(FIELDS_BY_STEP[step])
    if (!ok) {
      toast.error('这一步还有没填好的地方')
      return
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true)
    try {
      const created = await resumeApi.create({
        title: `${values.target_job || '我的'}-简历`,
        target_job: values.target_job,
        // 后端约定：结构化简历内容放 parsed_data
        parsed_data: {
          basics: { name: values.name, phone: values.phone, email: values.email },
          education: {
            school: values.school,
            major: values.major,
            detail: values.education,
          },
          projects: values.project,
          skills: values.skills,
        },
      })
      // 4.2：简历入库会回流画像
      bumpVersion()
      toast.success('已保存，去生成优化报告吧')
      if (created?.id) {
        navigate(toResumeReport(created.id), { replace: true })
      } else {
        navigate('/resume', { replace: true })
      }
    } catch {
      toast.error('保存失败，先别关页面，稍后重试')
    } finally {
      setSubmitting(false)
    }
  })

  const percent = Math.round(((step + 1) / STEPS.length) * 100)

  return (
    <PageShell
      title="新建简历"
      description="我问你答，5 步之后给你一份能投的简历。"
      breadcrumb="新建简历"
      actions={
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <a href="/resume">
            <ArrowLeft className="size-4" />
            返回列表
          </a>
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            第 {step + 1} / {STEPS.length} 步 · {STEPS[step].title}
          </span>
          <span className="font-numeric">{percent}%</span>
        </div>
        <Progress value={percent} className="h-1.5" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Card data-print="card">
          <CardHeader className="gap-1">
            <CardTitle className="text-base">{STEPS[step].title}</CardTitle>
            <CardDescription>{STEPS[step].hint}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {step === 0 ? (
              <>
                <Field label="姓名" error={errors.name?.message}>
                  <Input {...register('name')} placeholder="你的名字" />
                </Field>
                <Field label="联系电话" error={errors.phone?.message}>
                  <Input {...register('phone')} placeholder="HR 能打通的号码" />
                </Field>
                <Field label="邮箱（可选）" error={errors.email?.message}>
                  <Input {...register('email')} placeholder="常用邮箱" />
                </Field>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <Field label="学校" error={errors.school?.message}>
                  <Input {...register('school')} placeholder="学校名称" />
                </Field>
                <Field label="专业" error={errors.major?.message}>
                  <Input {...register('major')} placeholder="专业名称" />
                </Field>
                <Field label="在校时间与成绩" error={errors.education?.message}>
                  <Textarea
                    rows={3}
                    {...register('education')}
                    placeholder="2022.09-2026.06 · 专业前 20%"
                  />
                </Field>
              </>
            ) : null}

            {step === 2 ? (
              <Field label="项目 / 实践经历" error={errors.project?.message}>
                <Textarea
                  rows={6}
                  {...register('project')}
                  placeholder="做了什么 + 怎么做的 + 结果（尽量带数字）"
                />
              </Field>
            ) : null}

            {step === 3 ? (
              <Field label="技能与证书" error={errors.skills?.message}>
                <Textarea rows={4} {...register('skills')} placeholder="只写面试时敢被追问的" />
              </Field>
            ) : null}

            {step === 4 ? (
              <Field label="目标岗位" error={errors.target_job?.message}>
                <Input {...register('target_job')} placeholder="比如：产品经理" />
              </Field>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="gap-1.5"
          >
            <ArrowLeft className="size-4" />
            上一步
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void next()}
              className="gap-1.5"
            >
              下一步
              <ArrowRight className="size-4" />
            </Button>
          ) : (
            /* 本页唯一实心主按钮 */
            <Button type="submit" variant="warm" disabled={submitting} className="gap-1.5">
              <Check className="size-4" />
              {submitting ? '保存中…' : '生成简历'}
            </Button>
          )}
        </div>
      </form>
    </PageShell>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
