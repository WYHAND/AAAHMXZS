import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Printer, Save } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { EmptyState } from '@/components/EmptyState'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { PageShell } from '@/components/PageShell'
import { resumeApi } from '@/api/resume'
import { toResumeReport } from '@/constants/routes'
import { useResumeStore } from '@/store/resumeStore'

const schema = z.object({
  title: z.string().min(1, { error: '请填写简历名称' }).max(200),
  target_job: z.string().max(100),
  parsed: z.string(),
})

type EditForm = z.infer<typeof schema>

/**
 * 简历编辑（设计说明书 2.1 /resume/:id/edit，M2）
 *
 * 后端 ResumeUpdate：{ title, target_job, parsed_data }。
 * parsed_data 是结构化对象，这里用 JSON 文本编辑（骨架阶段不做完整表单）。
 *
 * 「下载原件」走后端**后补**的带鉴权端点 GET /resume/{id}/file（简历含 PII，
 * file_path 带 user_id 且路径可枚举，不能静态暴露）；未上传文件时按钮不显示。
 */
export default function ResumeEditPage() {
  const { id } = useParams<{ id: string }>()
  // 详情与保存都走 resumeStore（4.1），页面只负责表单与展示
  const storeResume = useResumeStore((s) => s.active)
  const storeLoading = useResumeStore((s) => s.loading)
  const fetchDetail = useResumeStore((s) => s.fetchDetail)
  const saveResume = useResumeStore((s) => s.save)
  const [saving, setSaving] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<EditForm>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', target_job: '', parsed: '' },
  })

  const load = useCallback(async () => {
    if (!id) return
    await fetchDetail(id)
  }, [fetchDetail, id])

  useEffect(() => {
    void load()
  }, [load])

  // 详情到位后回填表单（store 是唯一数据源）
  useEffect(() => {
    if (!storeResume || storeResume.id !== id) return
    reset({
      title: storeResume.title ?? '',
      target_job: storeResume.target_job ?? '',
      parsed: storeResume.parsed_data
        ? JSON.stringify(storeResume.parsed_data, null, 2)
        : '',
    })
  }, [id, reset, storeResume])

  const resume = storeResume && storeResume.id === id ? storeResume : null
  const loading = storeLoading && !resume

  const onSubmit = handleSubmit(async (values) => {
    if (!id) return
    let parsed: Record<string, unknown> | null = null
    if (values.parsed.trim()) {
      try {
        parsed = JSON.parse(values.parsed) as Record<string, unknown>
      } catch {
        toast.error('结构化内容不是合法 JSON，改好再保存')
        return
      }
    }
    setSaving(true)
    const ok = await saveResume(id, {
      title: values.title,
      target_job: values.target_job || null,
      parsed_data: parsed,
    })
    setSaving(false)
    if (ok) {
      toast.success('已保存')
    } else {
      toast.error('保存失败，内容还留在页面上')
    }
  })

  const handleDownload = async () => {
    if (!id) return
    try {
      // 带鉴权的文件下载（后端返回 FileResponse），不能用 <a href> 直链
      const blob = await resumeApi.downloadFile(id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${resume?.title ?? 'resume'}`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('下载失败，稍后再试')
    }
  }

  if (loading) {
    return (
      <PageShell title="简历编辑" breadcrumb="简历">
        <Skeleton className="h-64 rounded-xl" />
      </PageShell>
    )
  }

  if (!resume) {
    return (
      <PageShell title="简历编辑" breadcrumb="简历">
        <EmptyState
          title="这份简历打不开了"
          description="可能已经被删除，或链接不对。"
          action={
            <Button variant="warm" asChild>
              <Link to="/resume">回到简历列表</Link>
            </Button>
          }
        />
      </PageShell>
    )
  }

  return (
    <PageShell
      title="编辑简历"
      breadcrumb="简历"
      actions={
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link to="/resume">
            <ArrowLeft className="size-4" />
            返回列表
          </Link>
        </Button>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Card data-print="card">
          <CardHeader>
            <CardTitle className="text-base">基础信息</CardTitle>
            <CardDescription>名称只给自己看，用于区分不同版本</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">简历名称</Label>
              <Input id="title" {...register('title')} />
              {errors.title ? (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="target_job">目标岗位</Label>
              <Input id="target_job" {...register('target_job')} />
            </div>
            {resume.file_path ? (
              <p className="text-xs text-muted-foreground">
                已上传文件：{resume.file_path}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card data-print="card">
          <CardHeader>
            <CardTitle className="text-base">结构化内容</CardTitle>
            <CardDescription>
              对应后端 parsed_data（basics / education / projects / skills），JSON 格式
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea id="parsed" rows={12} {...register('parsed')} className="font-numeric" />
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div data-print="hide" className="flex flex-wrap gap-2">
            {resume.file_path ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDownload()}
                className="gap-1.5"
              >
                <Download className="size-4" />
                下载原件
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => window.print()}
              className="gap-1.5"
            >
              <Printer className="size-4" />
              浏览器打印
            </Button>
          </div>

          {/* 本页唯一实心主按钮 */}
          <Button type="submit" variant="warm" disabled={saving || !isDirty} className="gap-1.5">
            <Save className="size-4" />
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </form>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" asChild>
          <Link to={toResumeReport(resume.id)}>去看优化报告</Link>
        </Button>
      </div>
    </PageShell>
  )
}
