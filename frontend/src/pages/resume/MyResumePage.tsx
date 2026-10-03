import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { resumeApi } from '@/api/resume'
import { PageShell } from '@/components/PageShell'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ResumePreview } from '@/pages/resume/ResumePreview'
import {
  buildResumeData,
  formFromResumeData,
  formHasContent,
  formKey,
  isEmptyValue,
  joinLines,
  joinMultiple,
  readSections,
  resumeHasContent,
  sectionEntryCount,
  splitLines,
  splitMultiple,
  wirePath,
  writeEmptyEntry,
  type FormData as ResumeFormData,
  type FormValue,
} from '@/pages/resume/resumeForm'
import { isLegacyResumeData, asText, normalizeResumeData } from '@/pages/resume/resumeShape'
import { useProfileStore } from '@/store/profileStore'
import type { ResumeData, ResumeField, ResumeResponse, ResumeSection } from '@/types'

/**
 * 我的简历（/resume）——「我问什么，你答什么，我只帮你改得更像简历」
 *
 * 流程：模板把每个字段当成一个问题问出来 → 用户填 → 「润色」→ 展示成一份像简历的东西
 *       → 还能编辑 / 保存 / 打印。
 *
 * 「润色」这一步的动作顺序是刻意的：**点下去先切到展示态**（用用户已经写好的内容
 * 先排出一份完整简历），AI 回来了再原地换成润色版。不让用户对着填写页干等 ——
 * 润色要调 AI，十几秒里页面一动不动，看起来就像"点了没反应"。
 * 润色失败同样留在展示态：内容一个字不丢，给一句原因 + 「再润色一次」。
 *
 * 几条刻意的设计：
 * - **问题文案只有接口一个出处**（GET /resume/template 的 sections[].fields[].question）：
 *   前端不硬编码第二份字段清单，接口多问一个问题，表单就多一个输入框。
 * - **预填**来自 GET /resume/mine（没有简历时后端返回 data=null，是正常空态，不是失败）；
 *   `null` 与「请求失败」在界面上是两套东西：空态 vs 失败态 + 重试。
 * - 模板拉不到 / mine 拉不到都**不白屏**：给可读的失败态 + 「重新加载」。
 * - 润色只发用户真写过的内容（空字段不发），AI 不会替他编。
 * - star 的键是 `star.situation` 这类点号路径，表单按点号路径读写，
 *   到展示态才拼回后端的嵌套结构（见 resumeForm.ts）。
 * - **parsed_data 进门先过形状收敛层**（`normalizeResumeData`，见 resumeShape.ts）：
 *   库里那份可能是「上传 PDF → 解析」那版旧功能写下的旧结构（basics / education 是对象 /
 *   projects 是字符串），甚至是 null / 字符串。收敛层保证任何形状都不抛异常，
 *   并尽力把旧结构搬到新结构的对应位置上，用户能看见自己以前写的名字和学校。
 */

type ViewMode = 'form' | 'preview'
type FieldValue = FormValue

interface LoadError {
  template: boolean
  mine: boolean
}

export default function MyResumePage() {
  const bumpVersion = useProfileStore((s) => s.bumpVersion)

  const [sections, setSections] = useState<ResumeSection[]>([])
  const [resume, setResume] = useState<ResumeResponse | null>(null)
  const [form, setForm] = useState<ResumeFormData>({})
  /** 每个键被改过几次：0 表示还没交互（不标红），>0 才按"擦掉了必填"标红 */
  const [touched, setTouched] = useState<Record<string, number>>({})
  const [view, setView] = useState<ViewMode>('form')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<LoadError>({ template: false, mine: false })
  const [polishing, setPolishing] = useState(false)
  /** 润色失败的原因（展示态里那条卡片用）：失败也不把用户从简历上赶回填写页 */
  const [polishError, setPolishError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** 用户手改过表单 → 再点润色要先确认（润色会覆盖这些手改） */
  const [dirty, setDirty] = useState(false)
  const [confirmPolishOpen, setConfirmPolishOpen] = useState(false)
  /** 展示态渲染用的内容：来自润色结果或已保存的简历 */
  const [preview, setPreview] = useState<ResumeData | null>(null)
  /** 上一次提交给后端的结构：编辑时用它预填，避免把界面上的临时态当成已存内容 */
  const lastDataRef = useRef<ResumeData | null>(null)
  /** 卸载后不再 setState（润色要调 AI，可能比较慢） */
  const aliveRef = useRef(true)
  /**
   * 表单被改过几次。润色要走十几秒，期间用户可能点「编辑」又动手写；
   * 拿润色前后的这个数一比，就知道润色结果该不该盖回表单（盖了就是把人刚写的字弄丢）。
   */
  const editSeqRef = useRef(0)
  /** 下一次切到展示态要不要把简历滚到眼前（只有点润色才要，进页面时不要） */
  const scrollPreviewRef = useRef(false)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /** 按模板重铺表单：空模板 + 已保存内容（含模板之外多出来的键） */
  const resetForm = useCallback((nextSections: ResumeSection[], data: unknown) => {
    const nextForm = formFromResumeData(nextSections, data)
    setForm(nextForm)
    setTouched(zeroTouched(nextSections, nextForm))
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    const [templateResult, mineResult] = await Promise.allSettled([
      resumeApi.template(),
      resumeApi.mine(),
    ])
    if (!aliveRef.current) return

    const nextSections =
      templateResult.status === 'fulfilled' ? readSections(templateResult.value) : []
    // data=null（还没简历）与"请求失败"在这里就分开了：前者是 null，后者是 rejected
    const nextResume = mineResult.status === 'fulfilled' ? (mineResult.value ?? null) : null
    // 收敛：旧结构 → 新结构；形状不对 → 空值。表单预填与展示态都用它
    const nextData = nextResume?.parsed_data ? normalizeResumeData(nextResume.parsed_data) : null

    setSections(nextSections)
    setResume(nextResume)
    resetForm(nextSections, nextData)
    lastDataRef.current = nextData
    setPreview(nextData)
    setView(nextResume && resumeHasContent(nextResume) ? 'preview' : 'form')
    setDirty(false)
    setLoadError({
      // 拿到了模板但 sections 是空的，同样算"这次没拿到"：要给失败态，而不是空表单
      template: templateResult.status === 'rejected' || nextSections.length === 0,
      mine: mineResult.status === 'rejected',
    })
    setLoading(false)
  }, [resetForm])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * 切到展示态时把简历滚到眼前。只在「点润色」这条路上滚一次（scrollPreviewRef），
   * 打开页面时不动滚动条。不滚的话：用户停在长表单最底下的「润色」按钮那儿，
   * 内容换成一份更短的简历后，他看到的是简历下半截甚至一片空白 —— 像点了没反应。
   */
  useEffect(() => {
    if (view !== 'preview' || !scrollPreviewRef.current) return
    scrollPreviewRef.current = false
    document.getElementById('resume-view-top')?.scrollIntoView({ block: 'start' })
  }, [view])

  const hasContent = useMemo(() => formHasContent(form), [form])

  /** 库里那份是不是「上传 PDF → 解析」那版旧功能写下的旧结构（只用于给一句轻提示） */
  const legacyData = useMemo(() => isLegacyResumeData(resume?.parsed_data), [resume])

  const setField = useCallback((key: string, value: FieldValue) => {
    editSeqRef.current += 1
    setForm((prev) => ({ ...prev, [key]: value }))
    setTouched((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }))
    setDirty(true)
  }, [])

  /** multiple 字段用逗号 / 顿号分隔的单个输入框（比标签输入简单可靠） */
  const setMultipleField = useCallback(
    (key: string, text: string) => setField(key, splitMultiple(text)),
    [setField],
  )

  const addEntry = useCallback(
    (section: ResumeSection) => {
      const index = sectionEntryCount(section, form)
      editSeqRef.current += 1
      setForm((prev) => writeEmptyEntry(prev, section, index))
      setDirty(true)
    },
    [form],
  )

  /**
   * 删掉第 index 条：它自己的键丢掉，**后面的键整体前移一格**。
   * 不前移会留下空洞 —— 界面上"第 2 条"会显示成原来第 3 条的内容。
   */
  const removeEntry = useCallback((section: ResumeSection, index: number) => {
    const prefix = `${section.key}.`
    setForm((prev) => {
      const next: ResumeFormData = {}
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(prefix)) {
          next[key] = value
          continue
        }
        const rest = key.slice(prefix.length)
        const dot = rest.indexOf('.')
        const current = Number(dot === -1 ? rest : rest.slice(0, dot))
        if (!Number.isInteger(current)) {
          next[key] = value
          continue
        }
        if (current === index) continue
        const shifted = current > index ? current - 1 : current
        next[`${prefix}${shifted}${dot === -1 ? '' : rest.slice(dot)}`] = value
      }
      // 至少留一条：删到 0 条就再也没有"从哪加回来"的入口
      return sectionEntryCount(section, next) > 0 ? next : writeEmptyEntry(next, section, 0)
    })
    editSeqRef.current += 1
    setDirty(true)
  }, [])

  const goEdit = useCallback(() => {
    // 手改过就不拿旧数据盖回去：展示态里那份很可能就是用户此刻写的内容排出来的，
    // 表单里也还留着它，直接回填写态就行（盖一次就是白写一遍）。
    if (!dirty) resetForm(sections, lastDataRef.current ?? preview)
    setView('form')
  }, [dirty, preview, resetForm, sections])

  /**
   * 润色结果落地。`keepForm=true` 只用在一种情况：润色这十几秒里用户又动手写了新内容。
   * 那时展示态照样换成润色版（结果不白跑），但表单不盖回去（人刚写的字不弄丢）。
   */
  const applyResult = useCallback(
    (result: ResumeResponse, message?: string, keepForm = false) => {
      setResume(result)
      const nextData = result.parsed_data ? normalizeResumeData(result.parsed_data) : null
      lastDataRef.current = nextData
      setPreview(nextData)
      if (!keepForm) {
        resetForm(sections, nextData)
        setDirty(false)
      }
      setView('preview')
      if (message) toast.success(message)
    },
    [resetForm, sections],
  )

  const runPolish = useCallback(async () => {
    const parsed_data = buildResumeData(sections, form)
    const seqAtStart = editSeqRef.current

    setPolishing(true)
    setPolishError(null)
    /*
     * 先把用户**已经写好的内容**排成一份完整简历给他看 —— 这一步不等 AI。
     * 所以点「润色」的反馈是"立刻看到整份简历 + 顶上写着正在润色"，
     * 而不是对着填写页干等十几秒、以为按钮坏了。
     */
    setPreview(parsed_data)
    scrollPreviewRef.current = true
    setView('preview')

    try {
      // 信封 message 是后端给的一句人话（含「还有 N 项没填」），必须展示给用户
      const envelope = await resumeApi.polish({
        parsed_data,
        target_job: resume?.target_job ?? null,
      })
      if (!aliveRef.current) return
      applyResult(
        envelope.data,
        envelope.message?.trim() || '已润色。',
        editSeqRef.current !== seqAtStart,
      )
    } catch (error) {
      // 失败也不把用户赶回填写页：展示态里那份就是他自己写的内容，一个字都没丢
      if (aliveRef.current) setPolishError(polishErrorText(error))
    } finally {
      if (aliveRef.current) setPolishing(false)
    }
  }, [applyResult, form, resume?.target_job, sections])

  const handlePolish = useCallback(() => {
    // 已经手改过（保存过 / 润色后又编辑过）→ 先问一句，因为润色会覆盖这些改动
    if (dirty && resume) {
      setConfirmPolishOpen(true)
      return
    }
    void runPolish()
  }, [dirty, resume, runPolish])

  const handleSave = useCallback(async () => {
    setSaving(true)
    const parsed_data = buildResumeData(sections, form)
    try {
      const result = await resumeApi.saveMine({
        title: resume?.title ?? null,
        target_job: resume?.target_job ?? null,
        parsed_data,
      })
      if (!aliveRef.current) return
      setResume(result)
      // 后端可能把旧结构原样还回来（老页面写进去的），同样先收敛再上屏
      const nextData = result.parsed_data ? normalizeResumeData(result.parsed_data) : parsed_data
      lastDataRef.current = nextData
      setPreview(nextData)
      setDirty(false)
      // 4.2：简历入库会回流画像（完整度变了），bump 一次让首页 / 画像页重新拉
      bumpVersion()
      toast.success('已保存。以后打开这一页，填过的内容都在。')
    } catch {
      if (aliveRef.current) toast.error('保存没成功，内容还在这一页上，可以再点一次「保存」。')
    } finally {
      if (aliveRef.current) setSaving(false)
    }
  }, [bumpVersion, form, resume?.target_job, resume?.title, sections])

  /* ------------------------------- 加载 / 失败 ------------------------------- */

  if (loading) {
    return (
      <PageShell title="我的简历" description="我问你答，你写什么我就改什么。" breadcrumb="简历">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-28 rounded-xl" />
        </div>
      </PageShell>
    )
  }

  if (loadError.template) {
    return (
      <PageShell title="我的简历" breadcrumb="简历">
        <FailureCard
          title="这次没拿到简历模板。"
          description="拿不到模板就问不出问题，所以先不给你一张猜出来的空表单。过一会儿再试一次就好。"
          onRetry={() => void reload()}
        />
      </PageShell>
    )
  }

  const previewData = preview ?? lastDataRef.current

  return (
    <PageShell
      title="我的简历"
      description="我把简历要问的每一项都当成一个问题问出来。你写什么，我只帮你改得更像简历。"
      breadcrumb="简历"
      actions={
        view === 'preview' ? (
          <Button variant="outline" size="sm" onClick={goEdit} className="gap-1.5">
            回到填写
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        {loadError.mine ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card px-4 py-3">
            <p className="text-sm text-muted-foreground">
              你以前保存过的简历这次没读出来，下面看到的可能是空的。
            </p>
            <Button variant="outline" size="xs" onClick={() => void reload()} className="gap-1.5">
              <RefreshCw className="size-3" />
              重新加载
            </Button>
          </div>
        ) : null}

        {/* 旧结构简历：内容已经尽力搬进新表单了，说清哪来的、少的是什么 */}
        {legacyData ? (
          <div className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3">
            <p className="text-sm text-foreground">
              这份简历是很早以前存下的旧格式，我把能认出来的内容搬到了新格式里。
            </p>
            <p className="text-xs text-muted-foreground">
              姓名、学校这些能看到；旧格式里没有的项（比如项目的情境 / 任务 / 行动 / 结果）是空的，点「回到填写」补上就行。保存一次就会换成新格式。
            </p>
          </div>
        ) : null}

        {view === 'form' ? (
          <FormView
            sections={sections}
            form={form}
            touched={touched}
            hasContent={hasContent}
            polishing={polishing}
            saving={saving}
            savedOnce={Boolean(resume)}
            onField={setField}
            onMultiple={setMultipleField}
            onAddEntry={addEntry}
            onRemoveEntry={removeEntry}
            onPolish={handlePolish}
            onSave={() => void handleSave()}
          />
        ) : previewData ? (
          /* 展示态：滚动的落点（点润色后要滚到这里，见上面的 useEffect） */
          <div id="resume-view-top" className="flex flex-col gap-4">
            {polishing ? (
              <div
                data-print="hide"
                className="flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3"
              >
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-foreground">正在把你的内容改写成简历口吻，要一会儿。</p>
                  <p className="text-xs text-muted-foreground">
                    下面这份是先按你写的内容原样排出来的。改好之后我在这儿原地换成润色版，你不用管它。
                  </p>
                </div>
              </div>
            ) : null}

            {polishError ? (
              <div data-print="hide" className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3">
                <p className="text-sm text-foreground">润色这次没成功：{polishError}</p>
                <p className="text-xs text-muted-foreground">
                  下面这份是按你写的内容原样排出来的，一个字都没丢。可以再点一次，或者先「编辑」回去把内容存下来。
                </p>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runPolish()}
                    className="gap-1.5"
                  >
                    <Sparkles className="size-4" />
                    再润色一次
                  </Button>
                </div>
              </div>
            ) : null}

            <ResumePreview data={previewData} resume={resume} onEdit={goEdit} />
          </div>
        ) : (
          <FailureCard
            title="这次没有可以展示的内容。"
            description="点「重新加载」，或者回到填写把想写的写进去，我再帮你改。"
            onRetry={goEdit}
          />
        )}
      </div>

      {/* 二次确认：润色会覆盖手改过的内容 */}
      <AlertDialog open={confirmPolishOpen} onOpenChange={setConfirmPolishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>润色会用你现在填的内容，覆盖已经存下的那一版。</AlertDialogTitle>
            <AlertDialogDescription>
              你手动改过的句子会被重写成简历口吻，怎么改由我来定，所以原来的字句不一定原样保留。
              那一版要是还想留着，先点「取消」，导出或打印一份，再回来润色。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={polishing}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={polishing}
              onClick={(event) => {
                event.preventDefault()
                setConfirmPolishOpen(false)
                void runPolish()
              }}
            >
              覆盖并润色
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  )
}

/* --------------------------------- 填写态 --------------------------------- */

interface FormViewProps {
  sections: ResumeSection[]
  form: ResumeFormData
  touched: Record<string, number>
  hasContent: boolean
  polishing: boolean
  saving: boolean
  savedOnce: boolean
  onField: (key: string, value: FieldValue) => void
  onMultiple: (key: string, text: string) => void
  onAddEntry: (section: ResumeSection) => void
  onRemoveEntry: (section: ResumeSection, index: number) => void
  onPolish: () => void
  onSave: () => void
}

function FormView({
  sections,
  form,
  touched,
  hasContent,
  polishing,
  saving,
  savedOnce,
  onField,
  onMultiple,
  onAddEntry,
  onRemoveEntry,
  onPolish,
  onSave,
}: FormViewProps) {
  const busy = polishing || saving

  return (
    /*
     * 整块填写态标 data-print='hide'：打印的是简历（展示态），
     * 不该把"问题 + 输入框"的空白行印出来。
     */
    <div data-print="hide" className="flex flex-col gap-6">
      {/* 空态：还没写过任何内容时给一句诚实的说明 + 「开始填写」 */}
      {!hasContent && !savedOnce ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-8 text-center">
          <p className="text-sm text-foreground">
            我不会替你编经历：你写什么，我只帮你改得更像简历。空着的项目会一直空着。
          </p>
          <p className="text-xs text-muted-foreground">
            下面每一项都是简历会问到的问题，想到多少写多少，写半句也行。
          </p>
          <Button
            variant="warm"
            size="sm"
            onClick={() =>
              document.getElementById('resume-form-start')?.scrollIntoView({ block: 'start' })
            }
          >
            开始填写
          </Button>
        </div>
      ) : null}

      <div id="resume-form-start" className="flex flex-col gap-5">
        {sections.map((section) => (
          <section
            key={section.key}
            className="flex flex-col gap-4 rounded-xl border bg-card px-5 py-5"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-foreground">{section.label}</h2>
              {section.repeatable ? (
                <p className="text-xs text-muted-foreground">
                  这一段可以写多条，每一条都是简历上独立的一条。
                </p>
              ) : null}
            </div>

            {section.repeatable ? (
              <Entries
                section={section}
                form={form}
                touched={touched}
                busy={busy}
                onField={onField}
                onMultiple={onMultiple}
                onAddEntry={onAddEntry}
                onRemoveEntry={onRemoveEntry}
              />
            ) : (
              <FieldList
                section={section}
                index={0}
                form={form}
                touched={touched}
                busy={busy}
                onField={onField}
                onMultiple={onMultiple}
              />
            )}
          </section>
        ))}
      </div>

      {/* 动作区：润色（主）/ 保存 */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="warm"
            onClick={onPolish}
            disabled={!hasContent || busy}
            className="gap-1.5"
            title={hasContent ? undefined : '先写一点内容，我才能帮你改'}
          >
            <Sparkles className="size-4" />
            {polishing ? '正在润色…' : '润色'}
          </Button>
          <Button variant="outline" onClick={onSave} disabled={busy} className="gap-1.5">
            <Save className="size-4" />
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          润色只改写你写过的内容，不会替你编经历。技能那一栏会把关键词展开成简历上的说法
          （比如「Java」写成「熟悉 Java 基础语法、面向对象编程…」），但不会加你没写过的技术、也不会加数字。
        </p>
      </div>
    </div>
  )
}

/** repeatable section：一条条经历 + 「再加一条」「删掉这条」 */
function Entries({
  section,
  form,
  touched,
  busy,
  onField,
  onMultiple,
  onAddEntry,
  onRemoveEntry,
}: {
  section: ResumeSection
  form: ResumeFormData
  touched: Record<string, number>
  busy: boolean
  onField: (key: string, value: FieldValue) => void
  onMultiple: (key: string, text: string) => void
  onAddEntry: (section: ResumeSection) => void
  onRemoveEntry: (section: ResumeSection, index: number) => void
}) {
  const count = sectionEntryCount(section, form)
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-4 rounded-lg border bg-background px-4 py-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {section.label} 第 {index + 1} 条
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => onRemoveEntry(section, index)}
              className="gap-1 text-muted-foreground"
            >
              <Trash2 className="size-3" />
              删掉这条
            </Button>
          </div>
          <FieldList
            section={section}
            index={index}
            form={form}
            touched={touched}
            busy={busy}
            onField={onField}
            onMultiple={onMultiple}
          />
        </div>
      ))}
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onAddEntry(section)}
          className="gap-1.5"
        >
          <Plus className="size-4" />
          再加一条
        </Button>
      </div>
    </div>
  )
}

/** 一组字段：每个字段 = 接口下发的一句问题 + 输入框（必填只加一个轻量标记） */
function FieldList({
  section,
  index,
  form,
  touched,
  busy,
  onField,
  onMultiple,
}: {
  section: ResumeSection
  index: number
  form: ResumeFormData
  touched: Record<string, number>
  busy: boolean
  onField: (key: string, value: FieldValue) => void
  onMultiple: (key: string, text: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {section.fields.map((field) => {
        const key = formKey(section, index, field)
        const id = `resume-${key.replace(/\./g, '-')}`
        const value = form[key]
        // 问题文案只认接口给的 question；接口没给才退回字段名
        const question = field.question?.trim() || field.label
        const long = isLongField(section, field)
        // 必填 + 用户在这个键上写过又擦掉了 → aria-invalid（不给刚打开的页面标红）
        const invalid = field.required === true && isEmptyValue(value) && (touched[key] ?? 0) > 0
        return (
          <div key={key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={id} className="text-sm font-normal text-foreground">
                {question}
              </Label>
              {field.required ? (
                <span className="text-xs text-muted-foreground">必填</span>
              ) : null}
            </div>
            {field.lines ? (
              /*
               * 「一项一行」的字段（技能）：它经润色后是一句带顿号逗号的能力表述，
               * 用顿号分隔的单行输入框会把一句话切成好几项假技能，所以换成多行输入框、
               * 只按换行切（splitLines）。
               */
              <Textarea
                id={id}
                rows={4}
                disabled={busy}
                aria-invalid={invalid || undefined}
                placeholder={field.example ?? ''}
                value={joinLines(value)}
                onChange={(event) => onField(key, splitLines(event.target.value))}
              />
            ) : long ? (
              <Textarea
                id={id}
                rows={3}
                disabled={busy}
                aria-invalid={invalid || undefined}
                placeholder={field.example ?? ''}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => onField(key, event.target.value)}
              />
            ) : field.multiple ? (
              <Input
                id={id}
                disabled={busy}
                aria-invalid={invalid || undefined}
                placeholder={field.example ?? ''}
                value={joinMultiple(value)}
                onChange={(event) => onMultiple(key, event.target.value)}
              />
            ) : (
              <Input
                id={id}
                disabled={busy}
                aria-invalid={invalid || undefined}
                placeholder={field.example ?? ''}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => onField(key, event.target.value)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function FailureCard({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-10 text-center">
      <p className="text-sm text-foreground">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
        <RefreshCw className="size-4" />
        重新加载
      </Button>
    </div>
  )
}

/* --------------------------------- 小工具 --------------------------------- */

/** 长回答的字段用多行输入框：STAR 四段、教育亮点、自我评价这类 */
function isLongField(section: ResumeSection, field: ResumeField): boolean {
  const path = wirePath(section.key, field.key) ?? field.key.split('.').filter(Boolean)
  const last = path[path.length - 1] ?? ''
  if (path[0] === 'star') return true
  if (section.key === 'skills') return false
  return ['highlights', 'text', 'items'].includes(last)
}

/** 每个键的"改过几次"从 0 开始（键不存在 = 没交互过，不标红。新加的条目也走这条） */
function zeroTouched(sections: ResumeSection[], form: ResumeFormData): Record<string, number> {
  const next: Record<string, number> = {}
  for (const section of sections) {
    const count = section.repeatable ? sectionEntryCount(section, form) : 1
    for (let index = 0; index < count; index += 1) {
      for (const field of section.fields) next[formKey(section, index, field)] = 0
    }
  }
  return next
}

function polishErrorText(error: unknown): string {
  const apiError = error as { serverMessage?: unknown } | null
  // 后端给的那句人话也要过收敛层：不是字符串就当没有，别在 .trim() 上崩
  const detail = asText(apiError?.serverMessage).trim()
  if (detail) return detail
  /*
   * 这里返回的是「原因」，界面上的标题已经写了「润色这次没成功：」——
   * 所以这句不能再以「润色这次没成功」开头（否则会印刷成
   * "润色这次没成功：润色这次没成功，…"）。拿不到后端消息通常是网络断了、
   * 服务正在重启这类**没有响应体**的失败。
   */
  return '多半是网络或 AI 服务临时不稳，也可能是后端刚重启过（你写的内容一个字都没丢）。'
}
