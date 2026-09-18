import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { FileText, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageShell } from '@/components/PageShell'
import { toResumeEdit, toResumeReport } from '@/constants/routes'
import { useResumeStore } from '@/store/resumeStore'
import { formatRelative } from '@/utils/format'

/**
 * 简历列表（设计说明书 2.1 /resume，M2）
 *
 * 数据走 resumeStore（4.1），页面不再自己持有列表加载逻辑。
 * 后端路径是 GET /resume（**单数**）、上传是 POST /resume/upload；
 * 字段：title / target_job / ats_score / completeness / updated_at / file_path。
 */
export default function ResumeListPage() {
  const { list, loading, fetchList, upload } = useResumeStore()
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const onDrop = useCallback(
    (files: File[]) => {
      const file = files[0]
      if (!file) return
      setUploading(true)
      void upload(file)
        .then((ok) => {
          if (ok) {
            toast.success('上传成功，已经解析入库')
            return fetchList()
          }
          toast.error('上传失败，可以换成引导式生成')
          return undefined
        })
        .finally(() => setUploading(false))
    },
    [fetchList, upload],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    maxSize: 10 * 1024 * 1024,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
  })

  return (
    <PageShell
      title="我的简历"
      description="可以上传现成的，也可以让我带你 5 步生成一份。"
      breadcrumb="简历"
      actions={
        /* 列表为空时主按钮让位给空态里的那个，保证整屏只有一个 bg-primary */
        <Button variant={list.length ? 'warm' : 'outline'} size="sm" asChild className="gap-1.5">
          <Link to="/resume/create">
            <Plus className="size-4" />
            新建简历
          </Link>
        </Button>
      }
    >
      <div
        {...getRootProps()}
        className={
          isDragActive
            ? 'flex flex-col items-center gap-2 rounded-xl border border-dashed border-primary bg-primary-soft px-6 py-8 text-center'
            : 'flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center'
        }
      >
        <input {...getInputProps()} />
        <Upload className="size-5 text-muted-foreground" />
        <p className="text-sm text-foreground">
          {uploading ? '正在上传解析…' : '把简历拖到这里，或点击选择文件'}
        </p>
        <p className="text-xs text-muted-foreground">支持 PDF / DOC / DOCX，最大 10MB</p>
      </div>

      {loading && !list.length ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : list.length ? (
        <div className="flex flex-col gap-3">
          {list.map((resume) => (
            <Card key={resume.id} data-print="card" className="gap-3 py-4">
              <CardHeader className="flex-row items-start justify-between gap-3 px-4">
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base">{resume.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    目标岗位：{resume.target_job ?? '未填写'} · 更新于{' '}
                    {formatRelative(resume.updated_at)}
                  </p>
                </div>
                {typeof resume.ats_score === 'number' ? (
                  <Badge variant="outline" className="shrink-0 rounded-full font-numeric">
                    ATS {Math.round(resume.ats_score)}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-wrap justify-end gap-2 px-4">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={toResumeEdit(resume.id)}>编辑</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to={toResumeReport(resume.id)}>优化报告</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="还没有简历，我带你 5 步生成一份"
          description="不用从空白文档开始，我问你答，最后拼成一份能投的简历。"
          action={
            <Button variant="warm" asChild>
              <Link to="/resume/create">开始生成</Link>
            </Button>
          }
        />
      )}
    </PageShell>
  )
}
