import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  FileDown,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

import { resumeApi } from '@/api/resume'
import { EmptyState } from '@/components/EmptyState'
import { Reveal, staggerDelay } from '@/components/Motion'
import { PageShell } from '@/components/PageShell'
import { Panel } from '@/components/Panel'
import { Stat, StatGroup } from '@/components/StatGroup'
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
import { Progress } from '@/components/ui/progress'
import { missingSections, ResumeSheet, sheetEmpty } from '@/pages/resume/ResumeSheet'
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
  splitMultiple,
  wirePath,
  writeEmptyEntry,
  type FormData as ResumeFormData,
  type FormValue,
} from '@/pages/resume/resumeForm'
import { isLegacyResumeData, asText, normalizeResumeData } from '@/pages/resume/resumeShape'
import { useProfileStore } from '@/store/profileStore'
import { formatRelative } from '@/utils/format'
import { canSavePdf, saveResumePdf } from '@/utils/resumeExport'
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
  /** 桌面端导出 PDF 进行中（浏览器走打印窗口，是同步阻塞的，不占这个状态） */
  const [exporting, setExporting] = useState(false)
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

  /**
   * 打印时**页头整块不印**（标题「我的简历」+ 描述 + 操作组）：它是页面外壳，不是简历内容。
   *
   * 为什么用 JS 打标记而不是写类名：PageHeader / PageShell 都是全站共用件（本轮不许改），
   * 而 Tailwind 的 `print:` 变体在本项目**没有生成规则** —— 实测 dev server 吐出的 CSS 里
   * `print:hidden` 一条都没有（`[&>header]:print:hidden` 这种写法也不会生成），
   * 所以类名写法点了也是白点。而 `data-print="hide"` 是**项目自己的**打印机制：
   * print.css 里那条 `[data-print='hide'] { display: none !important }` 在打印时生效。
   *
   * 只标记 `<PageShell> → <PageHeader>` 那个 header。
   * ⚠️ 不能写 `:scope > header`：PageShell 的根 div 与 PageHeader 之间还夹着一层
   * `flex flex-col gap-6` 包装 div（实测 `shellFound=true` 但 `directChildOfShell=false`，
   * 直接子选择器一个都选不中）。用后代选择器取**第一个** header 即可 —— 文档纸里
   * 自己的 `<header>`（简历抬头）在 `.resume-sheet` 里，后面的兄弟子树，不会误伤。
   */
  useEffect(() => {
    const shell = document.querySelector('[data-print="main"]')
    const header = shell?.querySelector('header')
    if (!header) return
    header.setAttribute('data-print', 'hide')
    return () => header.removeAttribute('data-print')
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
        {/* 加载骨架：条数与下面真实的卡片节奏一致（一段一张卡），不做"凭空多三张"的假骨架 */}
        <div className="flex flex-col gap-4">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
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

  /**
   * 展示态要排的内容。
   *
   * 2026-10 收口：这里原来是 `preview ?? lastDataRef.current` —— 渲染期读 ref，
   * oxlint `react(refs)` 会逐处报"渲染期读 ref"（原来 1 条、改版后这一段被多处引用，
   * 同一条被记了 3 次）。核实过：`lastDataRef` 的每一次写入都**同一时刻**调了 `setPreview`
   * （reload / applyResult / handleSave 三处，写的都是同一个值），所以渲染期回落到 ref
   * 是取不到任何额外东西的死分支。ref 仍然保留 —— 它给 `goEdit` 在事件里用。
   *
   * ⚠️ 这里也**不能**改成 useMemo：本行位于两个提前 return（加载中 / 模板失败）之后，
   * 加 Hook 会直接踩 rules-of-hooks（实测 oxlint 报 "called conditionally"）。
   */
  const previewData = preview
  /**
   * 整份简历缺哪几段（导引栏用）。与文档渲染同一份判空逻辑：**文档里没印出来的模块，
   * 只有这里会说出来** —— 正式简历上不留「这一节还没填」这种开发占位文案。
   */
  const missing = previewData ? missingSections(previewData) : []
  /**
   * 整张纸一个字都印不出来（抬头空 + 六段全空）→ 给空态，不印一张空纸。
   * ⚠️ 口径是"抬头也算内容"：只填了姓名 / 学校时**照常印纸**（抬头就是那一段），
   * 空的模块直接不出现 —— 不能因为"六段都空"就当整份为空。
   */
  const isEmptySheet = !previewData || sheetEmpty(previewData)
  const hasSavedResume = Boolean(resume)
  /**
   * 「最近保存」只认后端给的 `resume.updated_at`。
   * `formatRelative` 认不出来的时间串会返回「—」，那时等同没有时间，不做假。
   */
  const savedAt = asText(resume?.updated_at).trim()
  const relativeSaved = savedAt ? formatRelative(savedAt) : ''
  const saveLine = relativeSaved === '—' ? '' : relativeSaved
  /** 完整度：**本地按已填字段数算的**，没有后端字段，所以如实写成「已填 x/y 项」 */
  const { filled, total } = countFilled(sections, form)
  const percent = total ? Math.round((filled / total) * 100) : 0
  /**
   * 右列「下一步」用的缺项，按**当前这一侧**算：填写态读表单的实时内容，
   * 展示态读文档那份。不共用一份：填写态里 previewData 可能还是上一次保存的旧内容，
   * 拿它说"缺什么"就不准了（会把已经写好的说成还没写）。
   */
  const formMissing = view === 'form' ? missingSections(buildResumeData(sections, form)) : []
  const heroMissing = view === 'preview' ? missing : formMissing
  /*
   * 主角卡的**同一个**实心主按钮，在两种态里指向「这一屏该做的那件事」：
   * - 展示态：回填写继续改；
   * - 填写态但已经写过一点：直接润色（这页真正的主行动）；
   * - 填写态还是一片空白：滚到表单起点开始写。
   * 全页只有这一个实心按钮；底部吸底条里那个是它的弱化副本（见 FormView）。
   * 刻意不用 useCallback：本行在提前 return（加载中 / 模板失败）之后，加 Hook 会踩 rules-of-hooks。
   */
  const scrollToFormStart = () => {
    document.getElementById('resume-form-start')?.scrollIntoView({ block: 'start' })
  }
  const heroCta =
    view === 'preview'
      ? { label: '继续完善', run: goEdit }
      : hasContent
        ? { label: '让 AI 帮我改得更像简历', run: handlePolish }
        : { label: '开始填写', run: scrollToFormStart }

  /**
   * 导出这一屏的简历。
   *
   * - **桌面端**：主进程 `printToPDF` + 系统「另存为」，直接拿到一个矢量 PDF 文件；
   *   文件名默认带姓名与日期（见 utils/resumeExport.ts）。
   * - **浏览器**：没有落盘能力，退回原来的系统打印窗口，用户在窗口里选「另存为 PDF」。
   * - 导出的是 `previewData`（**屏幕上这一份**，含还没保存的润色结果），所见即所得；
   *   整张纸为空时按钮是禁用的，这里再挡一次。
   * - 用户取消保存（canceled）不是失败：什么都不提示，别把"我不想导了"说成出错。
   */
  const exportName = asText(previewData?.basic?.name).trim()
  const handleExport = async () => {
    if (!previewData || isEmptySheet || exporting) return
    if (!canSavePdf()) {
      window.print()
      return
    }
    setExporting(true)
    try {
      const result = await saveResumePdf(exportName)
      if (!result || result.canceled) return
      if (result.error) {
        toast.error(`导出没成功：${result.error}`)
        return
      }
      toast.success('简历已导出为 PDF。', { description: result.filePath })
    } finally {
      if (aliveRef.current) setExporting(false)
    }
  }

  return (
    <PageShell
      title="我的简历"
      description="我把简历要问的每一项都当成一个问题问出来。你写什么，我只帮你改得更像简历。"
      breadcrumb="简历"
      /*
       * 整页收成 820（= 简历纸自己的版心宽度）：这一页没有值得占半屏的侧栏，
       * 原来的两列 7/5 把纸挤到只剩 597px。收窄靠这一个类名，页面内部单列排。
       * ⚠️ twMerge 后者覆盖前者，所以这里的 max-w 会顶掉 PageShell 自带的 1040。
       */
      className="max-w-[820px]"
      actions={
        /*
         * 页头右侧只放**次要**动作，且只在展示态出现：
         * 「导出 PDF」让用户把成果带走（桌面端直接落盘，浏览器退回打印窗口），
         * 「回到填写」与主角卡的「继续完善」同路（都回填写态）。
         * 整页唯一的实心主按钮留给主角卡（见 CompletenessHero）——主次与任务列表一致。
         */
        view === 'preview' ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleExport()}
              disabled={exporting || isEmptySheet}
              title={isEmptySheet ? '简历还是空的，先写一点内容再导出' : undefined}
              className="gap-1.5"
            >
              <FileDown className="size-4" />
              {exporting ? '正在导出…' : canSavePdf() ? '导出 PDF' : '打印 / 导出'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={goEdit}
              className="gap-1.5 text-on-surface-variant"
            >
              回到填写
            </Button>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-6">
        {/*
         * 头部信息行：这份简历存过没有 —— 只认后端给的 resume.updated_at，不编时间。
         * 字号 13px 走 body-sm，颜色次要色（保存时间是辅助信息，不该和标题一样响）。
         */}
        <Reveal fade>
          <p data-print="hide" className="flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
            {hasSavedResume && saveLine ? (
              <span className="inline-block size-1.5 rounded-full bg-secondary" aria-hidden />
            ) : null}
            {hasSavedResume && saveLine ? `最近保存：${saveLine}` : '这份简历还没保存到服务器'}
          </p>
        </Reveal>

        {loadError.mine ? (
          /* 提示块统一成卡内浅底（inset），不再各写一套「圆角边框白卡」 */
          <Reveal fade>
            <Panel inset className="flex-row flex-wrap items-center justify-between gap-2">
              <p className="text-body-sm text-on-surface-variant">
                你以前保存过的简历这次没读出来，下面看到的可能是空的。
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void reload()}
                className="motion-press gap-1.5"
              >
                <RefreshCw className="size-3" />
                重新加载
              </Button>
            </Panel>
          </Reveal>
        ) : null}

        {/* 旧结构简历：内容已经尽力搬进新表单了，说清哪来的、少的是什么 */}
        {legacyData ? (
          <Reveal fade delay={70}>
            <Panel inset className="gap-1">
              <p className="text-body-md text-on-surface">
                这份简历是很早以前存下的旧格式，我把能认出来的内容搬到了新格式里。
              </p>
              <p className="text-body-sm text-on-surface-variant">
                姓名、学校这些能看到；旧格式里没有的项（比如项目的情境 / 任务 / 行动 / 结果）是空的，点「回到填写」补上就行。保存一次就会换成新格式。
              </p>
            </Panel>
          </Reveal>
        ) : null}

        {/*
         * 主角卡 = 页面唯一的主角（一屏一个）：整页唯一的实心主按钮、唯一的一段"完成度"叙事。
         * 大块进场走 rise-in-lg（640ms），数字与进度条在卡内各自就位。
         * 三个数字走 StatGroup；琥珀只给其中一个（填充率），其余走主墨。
         */}
        <Reveal lg>
          <CompletenessHero
            percent={percent}
            filled={filled}
            total={total}
            missing={heroMissing}
            ctaLabel={heroCta.label}
            onCta={heroCta.run}
          />
        </Reveal>

        {view === 'form' ? (
          /*
           * 填写态：**单列整宽**。
           * 右列那张「下一步」卡已经整块删除 —— 它说的（已填 x/y、缺哪几段）主角卡
           * 已经在顶上说过一遍，而它自己占掉 5/12，把表单和简历纸一路挤窄。
           * 缺什么由主角卡那句话交代（见 completenessLine）。
           */
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
          /*
           * 展示态 = 简历工作台：左 7 是文档纸，右 5 是「下一步」导引。
           * 这一层还挂着打印铺满纸张的类名与回填写时的滚动锚点，名字一个字都不能改。
           * 窄屏（<lg）自动单列：导引栏落到文档下方，绝不把文档压成窄条。
           */
          <div
            id="resume-view-top"
            className="resume-page flex flex-col gap-4"
          >
            <div className="flex min-w-0 flex-col gap-4">
              {polishing ? (
                /* 状态条：与页面其它提示块同一种内嵌浅底外观，只多一条 AI 竖条 */
                <Reveal fade>
                  <Panel
                    inset
                    data-print="hide"
                    className="ai-inset flex-row items-start gap-2.5"
                  >
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-secondary" />
                    <div className="flex flex-col gap-1">
                      <p className="text-body-md text-primary">
                        正在把你的内容改写成简历口吻，要一会儿。
                      </p>
                      <p className="text-body-sm text-on-surface-variant">
                        下面这份是先按你写的内容原样排出来的。改好之后我在这儿原地换成润色版，你不用管它。
                      </p>
                    </div>
                  </Panel>
                </Reveal>
              ) : null}

              {polishError ? (
                <Reveal fade>
                  <Panel inset data-print="hide" className="ai-inset">
                    <p className="text-body-md text-primary">润色这次没成功：{polishError}</p>
                    <p className="text-body-sm text-on-surface-variant">
                      下面这份是按你写的内容原样排出来的，一个字都没丢。可以再点一次，或者先「编辑」回去把内容存下来。
                    </p>
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runPolish()}
                        className="motion-press gap-1.5"
                      >
                        <Sparkles className="size-4" />
                        再润色一次
                      </Button>
                    </div>
                  </Panel>
                </Reveal>
              ) : null}

              {isEmptySheet ? (
                /*
                 * 整份为空：纸上没东西可写，就不印一张空纸（也绝不印
                 * 「这一节还没填，先空着」这种开发占位文案）。给一个克制的空态 + 去填写。
                 */
                <EmptyState
                  className="mx-auto w-full max-w-[820px]"
                  title="这份简历还是空的。"
                  description="下面每一项都是简历会问到的问题，想到多少写多少，写半句也行。"
                  action={
                    <Button variant="outline" size="sm" onClick={goEdit} className="motion-press">
                      去填写
                    </Button>
                  }
                />
              ) : (
                /* 简历纸是**打印内容**，画面上的进场一律不给它加（打印会错乱），只静止上屏 */
                <ResumeSheet data={previewData} />
              )}

              {/*
               * 「还可以再补一补（可选）」：纸下面一条浅底块。
               *
               * 为什么是这里而不是侧栏：侧栏要占掉半屏宽，而这句是**可选建议**，
               * 不该有那个分量。为什么**不带按钮**：没有项目 / 校园经历的人本来就写不出来，
               * 给一个「去填项目经历」只会把他往墙上逼（原来那张卡就是这么干的）。
               * 没有缺项时整块不出现 —— 不留一句空话。
               * data-print='hide'：打印的是简历本身，这条建议不该印到纸上。
               */}
              {missing.length ? (
                <Panel inset data-print="hide" className="gap-1.5">
                  <p className="text-headline-sm text-primary">还可以再补一补（可选）</p>
                  <p className="text-body-sm text-on-surface-variant">
                    简历里还没写到：{missing.join(' / ')}。没有这些也没关系 —— 我按你写过的内容排，
                    一个字都不会替你编；面试时按岗位挑你别的经历讲也一样。
                  </p>
                </Panel>
              ) : null}
            </div>
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
     *
     * 2026-10 收口（第二版）：完整度已经升成页面顶部的主角卡，这里不再重复一块；
     * 每段一张 Panel（默认 20px 内边距、无描边），可重复段的每条用 Panel inset。
     * 字段一个都没删、也没藏。
     */
    <div data-print="hide" className="flex flex-col gap-4">
      {/* 空态：还没写过任何内容时给一句诚实的说明 + 「从第一个问题开始」 */}
      {!hasContent && !savedOnce ? (
        <EmptyState
          className="gap-2"
          title="还一个字都没写。"
          description="我不会替你编经历：下面每一项都是简历会问到的问题，想到多少写多少，写半句也行；空着的项目会一直空着。"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                document.getElementById('resume-form-start')?.scrollIntoView({ block: 'start' })
              }
              className="motion-press"
            >
              从第一个问题开始
            </Button>
          }
        />
      ) : null}

      <div id="resume-form-start" className="flex flex-col gap-3">
        {sections.map((section, index) => (
          /*
           * 每段一张 Panel（默认白卡、20px 内边距）；可重复段每条再套一层 Panel inset。
           * 进场只错开头几项（staggerDelay 自带上限 7），不让长表单一起抖。
           */
          <Reveal key={section.key} delay={staggerDelay(index)}>
            <Panel as="section" className="gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="flex flex-wrap items-center gap-2 text-headline-md text-primary">
                  {section.label}
                  <span className="rounded-full bg-surface-container px-2 py-0.5 text-caption font-normal text-on-surface-variant">
                    {section.fields.length} 项
                  </span>
                </h2>
                {section.repeatable ? (
                  <p className="text-body-sm text-on-surface-variant">
                    这一段可以写多条，每一条都是简历上独立的一条。
                  </p>
                ) : section.key === 'skills' ? (
                  /* 原来这段说明挤在底部吸底条里（一大片灰字）；挪到技能栏旁边，写的人才看得到 */
                  <p className="text-body-sm text-on-surface-variant">
                    写关键词就行（一个一行）；润色时我会把它们展开成简历上的说法，不会加你没写过的技术、也不会加数字。
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
            </Panel>
          </Reveal>
        ))}
      </div>

      {/*
       * 表单底部动作条。
       *
       * **不再吸底**：原来写的是 `sticky bottom-4`，于是一整条 82px 高的卡浮在视口最下面，
       * 一路盖住当时滚到那儿的表单行（截图里正好压在「基本信息」的第一行上）。
       * 它本来就是"滚到表单底部也够得着"的弱化副本（整页唯一的实心主按钮在顶部主角卡里），
       * 所以改成普通块、跟在表单最后：任何一行都不会再被压住。
       */}
      <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5">
        {/* 窄屏也不让两个按钮换行：两个都挤成一行才不至于把首屏内容挡住一半 */}
        <div className="flex flex-nowrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={busy}
            className="motion-press gap-1.5"
          >
            <Save className="size-4" />
            {saving ? '保存中…' : '保存'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onPolish}
            disabled={!hasContent || busy}
            className="motion-press gap-1.5"
            title={hasContent ? undefined : '先写一点内容，我才能帮你改'}
          >
            <Sparkles className="size-4" />
            {polishing ? '正在润色…' : '让 AI 帮我改得更像简历'}
          </Button>
        </div>
        <p className="text-body-sm text-on-surface-variant">
          润色只改写你写过的内容，不会替你编经历；空着的项目不会自己长出来。
        </p>
      </div>
    </div>
  )
}

/* --------------------------------- 主角卡 / 导引卡 --------------------------------- */

/**
 * 主角卡：简历完整度。整页最大的一张 Panel，也是**全页唯一**带实心主按钮的地方。
 * 那个按钮的文案与去向由页面按状态决定（见 heroCta）：展示态回填写，填写态有内容就润色，
 * 还空着就滚到表单起点 —— 主角卡永远指向「这一屏该做的那件事」。
 *
 * 三个数字都是真的：`filled/total` 来自 countFilled（本地按已填字段数算），
 * 缺什么来自与文档同一份模块分析 —— **文档里没印出来的模块，只有这里会说出来**。
 * 不编任何额外统计（项目数、得分、HR 视角之类的一律没有）。
 *
 * data-print='hide'：打印的是简历本身，这张卡是页面外壳，不该印到纸上。
 */
function CompletenessHero({
  percent,
  filled,
  total,
  missing,
  ctaLabel,
  onCta,
}: {
  percent: number
  filled: number
  total: number
  missing: string[]
  ctaLabel: string
  onCta: () => void
}) {
  return (
    <Panel data-print="hide" className="gap-5">
      <div className="flex flex-col gap-2">
        {/* 栏目名退成 eyebrow；主角是下面这句结论 + 进度 + 那个百分比数字 */}
        <span className="flex items-center gap-2 text-caption tracking-wide text-caption-foreground">
          <Gauge className="size-4" aria-hidden />
          简历完整度
        </span>
        <h2 className="max-w-[46ch] text-headline-md text-primary">
          {completenessLine(percent, missing)}
        </h2>
      </div>

      {/* 本页唯一的进度条（主卡规格 6px）；值上屏时从左长出来一次 */}
      <Progress value={percent} className="grow-x h-1.5 bg-surface-container" />

      {/* 琥珀只给一个数字（填充率），其余走主墨 */}
      <StatGroup columns={3}>
        <Stat value={percent} unit="%" label="已经写好" size="display" accent />
        <Stat value={filled} label="写好的项" />
        <Stat value={total - filled} label="还空着的项" />
      </StatGroup>

      <div>
        <Button variant="warm" size="lg" onClick={onCta} className="motion-press gap-1.5">
          {ctaLabel}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </Panel>
  )
}

/**
 * 完整度的一句话人话。三种口径各说各的，不把"都写完了"套到空简历上。
 * `missing` 是当前那一侧的缺项（填写态读表单、展示态读文档）。
 *
 * ⚠️ 中间那一档**不许点名某个板块**：原来写的是「补上「项目经历」，这份简历会更有说服力」，
 * 而"没有项目经历"的人本来就写不出来 —— 那句会变成一句他没法执行的指令。
 * 现在只说"写过的都算数、没写的想到再补"，缺哪几段由文档下面那条**可选**建议去说。
 */
function completenessLine(percent: number, missing: string[]): string {
  if (percent <= 0) return '还是一片空白。想到多少写多少，写半句也行，我不会替你编经历。'
  if (!missing.length) return '每一段都有着落了。接下来把它改得更像简历，投出去会更稳。'
  return `已经填了 ${percent}%。写过的都算数，没写的想到再补；没有的那几段不用硬凑。`
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
  /**
   * 这一条是空白的吗（所有字段都没写过）。
   *
   * 空条目默认**收起来**：可重复段一共有三段（教育 / 项目 / 校园），每段都预铺一条空条目，
   * 三条空条目一次性就把 21 个空输入框摊在屏幕上 —— 这正是整页 4200px、真正要写的字
   * 反而被压到最下面的原因。收起来不是藏字段：点一下「开始填这一条」，
   * 同样的 7 个问题（接口下发的原文，一个不少）立刻原地展开。
   * 只要有一条里写过一个字，它就永远展开、不会再收起来（不打断已经动笔的人）。
   */
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const entryHasContent = (index: number) =>
    section.fields.some((field) => !isEmptyValue(form[formKey(section, index, field)]))

  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }, (_, index) => {
        const open = expanded[index] === true || entryHasContent(index)
        return (
          /*
           * 可重复段的一条 = 一个 Panel inset（卡内浅底块，替代原来的 bg-muted/40 临时底色）。
           * 内边距收到 10px、块间距 8px：一条 8 个字段时这里能省下几十像素，
           * 而浅底本身的边界已经足够表达"这是一条"。
           */
          <Panel key={index} inset className="gap-2 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {/* 浅底上的小字必须用 on-surface-variant：caption-foreground 是暖棕灰，只配做装饰，不承载条目信息 */}
              <span className="text-body-sm text-on-surface-variant">
                {section.label} 第 {index + 1} 条
              </span>
              <div className="flex items-center gap-1">
                {!open ? (
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={busy}
                    onClick={() => setExpanded((prev) => ({ ...prev, [index]: true }))}
                    className="motion-press gap-1"
                  >
                    开始填这一条
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => onRemoveEntry(section, index)}
                  className="motion-press gap-1 text-on-surface-variant"
                >
                  <Trash2 className="size-3" />
                  删掉这条
                </Button>
              </div>
            </div>
            {open ? (
              <FieldList
                section={section}
                index={index}
                form={form}
                touched={touched}
                busy={busy}
                onField={onField}
                onMultiple={onMultiple}
              />
            ) : (
              <p className="text-body-sm text-on-surface-variant">
                这一条还是空的。点「开始填这一条」，{section.fields.length} 个问题会展开在这里。
              </p>
            )}
          </Panel>
        )
      })}
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onAddEntry(section)}
          className="motion-press gap-1.5"
        >
          <Plus className="size-4" />
          再加一条
        </Button>
      </div>
    </div>
  )
}

/**
 * 「可以并排」的短字段：一行放两个，**字段一个都没少**，只是不再每人独占一整行。
 *
 * 为什么只挑这几个：这一页 27 个问题本来就长（简历要问的都得问），
 * 而「年级 / 专业 / 学校」这种答案只有两三个字的项独占一行纯属浪费纵向空间。
 * 长回答字段（STAR、亮点、自我评价、技能）**一律不并排** —— 它们是用户真正要写字的地方，
 * 窄一半只会更难写。
 */
const PAIRED_FIELDS: Record<string, string[]> = {
  basic: ['grade', 'major', 'school'],
  target: ['direction', 'city'],
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
  const paired = PAIRED_FIELDS[section.key]
  /** 已经并排渲染过的字段 key（跳过它们，避免重复渲染） */
  const pairedDone = new Set<string>()

  const renderField = (field: ResumeField) => {
    const key = formKey(section, index, field)
    const id = `resume-${key.replace(/\./g, '-')}`
    const value = form[key]
    // 问题文案只认接口给的 question；接口没给才退回字段名
    const question = field.question?.trim() || field.label
    const long = isLongField(section, field)
    // 必填 + 用户在这个键上写过又擦掉了 → aria-invalid（不给刚打开的页面标红）
    const invalid = field.required === true && isEmptyValue(value) && (touched[key] ?? 0) > 0
    /*
     * 性别：渲染成**两个并排的按钮**（男 / 女），而不是文本输入框。
     *
     * 它**依然是模板下发的字段**（key = basic.gender），这里只是换一种"怎么填"：
     * 模板多问/少问一个性别字段时，这段自动跟着生效/失效，前端不留第二份字段清单。
     * 选中判据用 includes 而不是相等：AI 或用户可能写成「男生」「女生」，逐字相等会漏。
     */
    if (section.key === 'basic' && field.key === 'gender') {
      const current = asText(value)
      return (
        <div key={key} className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-body-md font-normal text-on-surface">{question}</Label>
            {field.required ? (
              <span className="rounded-full bg-surface-container px-1.5 py-0.5 text-caption text-on-surface-variant">
                必填
              </span>
            ) : null}
          </div>
          <div role="group" aria-label={question} className="flex flex-wrap items-center gap-2">
            {(['男', '女'] as const).map((option) => {
              const active = current.includes(option)
              return (
                <Button
                  key={option}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  aria-pressed={active}
                  onClick={() => onField(key, option)}
                  /* 选中态走实心主色（twMerge 会正确覆盖 outline 的底色与文字色） */
                  className={
                    active
                      ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover'
                      : undefined
                  }
                >
                  {option}
                </Button>
              )
            })}
          </div>
        </div>
      )
    }
    return (
      /* 字段块：问题 + 输入框，间距 4px；字段与字段之间 8px（原来是 16px） */
      <div key={key} className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* 问题文案只认接口给的 question；字号统一 14px，和字段值同一档 */}
          <Label htmlFor={id} className="text-body-md font-normal text-on-surface">
            {question}
          </Label>
          {field.required ? (
            <span className="rounded-full bg-surface-container px-1.5 py-0.5 text-caption text-on-surface-variant">
              必填
            </span>
          ) : null}
        </div>
        {field.lines ? (
          /*
           * 「一项一行」的字段（技能）：它经润色后是一句带顿号逗号的能力表述，
           * 用顿号分隔的单行输入框会把一句话切成好几项假技能，所以换成多行输入框。
           *
           * ⚠️ 这里存的是**原始多行文本**，不是 `splitLines()` 切好的数组：
           * 每次按键都 split→join 会把行尾换行"收敛"掉，用户按回车换不到下一行，
           * 接着写的第二个技能就叠在同一行（见 resumeForm.writeField 的说明）。
           * 提交时由 `buildResumeData` 统一按换行切开。
           */
          <Textarea
            id={id}
            rows={3}
            disabled={busy}
            aria-invalid={invalid || undefined}
            placeholder={field.example ?? ''}
            value={joinLines(value)}
            onChange={(event) => onField(key, event.target.value)}
          />
        ) : long ? (
          <Textarea
            id={id}
            rows={2}
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
  }

  return (
    <div className="flex flex-col gap-2">
      {section.fields.map((field) => {
        if (pairedDone.has(field.key)) return null
        const key = formKey(section, index, field)
        if (!paired?.includes(field.key)) return renderField(field)

        /*
         * 一段连续的短字段两个一行（sm 起两列，窄屏自动退回一列）。
         * 用户真写长了输入框也不会变形 —— 输入框本身是撑满格子的。
         */
        const pair: ResumeField[] = []
        const start = section.fields.indexOf(field)
        for (let i = start; i < section.fields.length; i += 1) {
          const next = section.fields[i]
          if (!paired.includes(next.key)) break
          pair.push(next)
          pairedDone.add(next.key)
        }
        return (
          <div key={key} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {pair.map((item) => renderField(item))}
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
    <Panel className="items-center gap-3 text-center">
      <p className="text-headline-sm text-primary">{title}</p>
      <p className="max-w-md text-body-sm text-on-surface-variant">{description}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="motion-press gap-1.5">
        <RefreshCw className="size-4" />
        重新加载
      </Button>
    </Panel>
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

/**
 * 已填 / 总项数（**纯本地统计**，没有后端字段）。
 *
 * 口径：每个字段算出它的 form key，值非空就算填了；可重复段按当前条目数展开。
 * 界面上如实写成「已填 x/y 项」，不叫"简历评分"、也不假装是 AI 判断的。
 */
function countFilled(
  sections: ResumeSection[],
  form: ResumeFormData,
): { filled: number; total: number } {
  let filled = 0
  let total = 0
  for (const section of sections) {
    const count = section.repeatable ? sectionEntryCount(section, form) : 1
    for (let index = 0; index < count; index += 1) {
      for (const field of section.fields) {
        total += 1
        if (!isEmptyValue(form[formKey(section, index, field)])) filled += 1
      }
    }
  }
  return { filled, total }
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
