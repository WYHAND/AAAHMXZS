import { useMemo } from 'react'

import { PixelAvatar, resolveAvatarVariant } from '@/components/PixelAvatar'
import {
  asParagraph,
  asText,
  asTextList,
  normalizeResumeData,
} from '@/pages/resume/resumeShape'
import type { ResumeData, ResumeExperienceItem, ResumeStar } from '@/types'

/**
 * ResumeSheet —— 简历文档纸（展示态的唯一实现）。
 *
 * 2026-10 视觉改版（这一版）：纸从"圆角白卡"改成**一张有版面的简历纸** ——
 * - **纸顶标题带**：左侧一块深墨斜块「个人简历」+ 右侧小字记号 + 一条赭金细线做底
 *   （金只用于这条线、飘带上那枚小方块，不做大面积铺色）；
 * - **模块标题**改成**直角飘带**（深墨块 + 右侧斜切 + 一枚赭金小方块），不是圆角卡片；
 * - **右上角照片位**：直角双线框，里面是 `PixelAvatar` 画的像素人物，
 *   男生 / 女生两套按 `basic.gender` 自动选（含「女」即女生版）；屏幕上每 4.6s 眨一次眼，
 *   打印时由 print.css 停掉；
 * - **全纸零圆角**：靠 2px 墨线边框 + 硬投影（`8px 8px 0`）把纸"立"起来。
 *
 * 判空仍然沿用上一版的四条硬规矩（一条都没放松）：
 * 1. **空模块在文档里直接不渲染**（`analyzeSheet`）。正式简历上不会出现
 *    「这一节还没填，先空着」这种开发占位文案 —— 缺哪一段由**文档外**的导引栏来说，
 *    文档本身保持干净。整份为空时由页面给空态（`isEmpty`），不是在这里印一行占位；
 * 2. 经历里的四段一律中文小标题（情境 / 任务 / 行动 / 结果），
 *    **绝不出现 situation / task / action / result 这类英文字段名**；
 * 3. 空的字段不显示、不占位；
 * 4. **形状不由我们说了算**：库里可能躺着「上传 PDF → 解析」那版旧功能写下的旧结构，
 *    甚至 null / 字符串。`analyzeSheet` 第一件事就是过 `normalizeResumeData`
 *    （形状收敛层），之后所有渲染只碰收敛后的值。
 *
 * ⚠️ 打印依赖的类名**一个字都不能改**（styles/print.css 靠它们排版）：
 * `resume-page`（铺满纸张）、`resume-sheet`（去阴影描边铺满）、
 * `resume-section-title` + 里面**唯一那个** `<span>`（打印时换成主色 0.6pt 细线；
 * 所以飘带必须是 `<h3>`，赭金小方块只能用 CSS `::before` 画，不能加第二个 `<span>`）、
 * `resume-entry`（一段经历不许被撕成两页）。
 * ⚠️ `data-print="card"` / 纸外的 `data-print="hide"` / `data-print="main"` 都别动。
 *
 * ⚠️ `article` 上**不要加 flex / flex-col / gap-***：print.css 对 `.resume-sheet` 有
 * `gap: 12pt !important`，自带 flex gap 会在纸上凭空多一道缝。内边距放在 `.resume-body`
 * 一层，打印时由 print.css 清零。
 */

const STAR_LABELS: Array<{ key: keyof ResumeStar; label: string }> = [
  { key: 'situation', label: '情境' },
  { key: 'task', label: '任务' },
  { key: 'action', label: '行动' },
  { key: 'result', label: '结果' },
]

export interface SheetAnalysis {
  /** 收敛后的简历结构（渲染只碰它） */
  view: ResumeData
  /** 文档里真正会印出来的模块 */
  sections: SheetSection[]
  /** **文档里没有**的模块（导引栏用它说"缺什么"，这就是"提醒放在文档外"） */
  missing: SheetSection[]
  /** 抬头有姓名等实质内容 */
  hasHeadline: boolean
  /** 整份简历一个模块都没有 → 由页面给空态 */
  isEmpty: boolean
}

export type SheetSection =
  | 'target'
  | 'education'
  | 'skills'
  | 'projects'
  | 'campus'
  | 'self_evaluation'

const SECTION_LABELS: Record<SheetSection, string> = {
  target: '求职意向',
  education: '教育背景',
  skills: '技能',
  projects: '项目经历',
  campus: '校园与实践经历',
  self_evaluation: '自我评价',
}

const SECTION_ORDER: SheetSection[] = [
  'target',
  'education',
  'skills',
  'projects',
  'campus',
  'self_evaluation',
]

/**
 * 收敛 + 判空，一次算清：文档要印哪几段、哪几段是空的。
 *
 * 判空口径与渲染完全一致（同一份收敛结果），所以"分析说空"与"渲染没印"不可能对不上。
 * 不导出：它随文档一起走（`ResumeSheet` 内部用、页面要的是下面那个 `missingSections`）。
 *
 * ⚠️ `hasHeadline` 的口径**不许动**：它是姓名 / 学校 / 专业 / 年级 / 联系方式，
 * **不包含 gender** —— 只选了性别时这份简历在口径上仍然是空的（页面给空态），
 * 这是刻意的：性别一项撑不起一张纸，也不该改变"整份为空"的判断。
 */
function analyzeSheet(data: unknown): SheetAnalysis {
  const view = normalizeResumeData(data)

  const filled: Record<SheetSection, boolean> = {
    target: Boolean(asText(view.target.direction).trim() || asText(view.target.city).trim()),
    education: view.education.length > 0,
    skills: view.skills.length > 0,
    projects: view.projects.length > 0,
    campus: view.campus.length > 0,
    self_evaluation: Boolean(asParagraph(view.self_evaluation).trim()),
  }

  const sections = SECTION_ORDER.filter((key) => filled[key])

  return {
    view,
    sections,
    missing: SECTION_ORDER.filter((key) => !filled[key]),
    hasHeadline: headlineHasContent(view),
    isEmpty: !headlineHasContent(view) && sections.length === 0,
  }
}

/** 抬头（姓名 / 学校 / 专业 / 年级 / 联系方式）里有没有一个字 */
function headlineHasContent(view: ResumeData): boolean {
  return [
    view.basic.name,
    view.basic.school,
    view.basic.major,
    view.basic.grade,
    view.basic.contact,
  ].some((value) => asText(value).trim())
}

export interface ResumeSheetProps {
  data: unknown
  /** 版面附加类（页面用它做列内的收尾微调） */
  className?: string
}

/**
 * 文档里**没有**印出来的模块名（中文，按文档顺序）。
 *
 * 给导引栏用：文档本身不留「这一节还没填」的占位文案，缺什么由文档外来说。
 * 判空与文档渲染是同一份 `analyzeSheet`，所以导引栏说的和纸上印的不可能对不上。
 *
 * ⚠️ 这是本文件**唯一**的非组件导出（oxlint `only-export-components` 会为它记一条
 * fast-refresh 告警 —— 那条规则的影响面只是 HMR，且它全项目已有 20 多条同类告警）。
 * 值得留着：页面与文档必须共用同一份判空，两处各写一份迟早对不上。
 */
export function missingSections(data: unknown): string[] {
  return analyzeSheet(data).missing.map((key) => SECTION_LABELS[key])
}

/**
 * 这张纸**一个字都印不出来**吗（抬头空 + 六个模块全空）。
 *
 * 页面据此给空态。注意口径：**抬头有姓名 / 学校就算有内容** —— 那时照常印纸，
 * 空模块直接不出现（不是"整份为空"）。
 */
export function sheetEmpty(data: unknown): boolean {
  return analyzeSheet(data).isEmpty
}

/**
 * 一份简历文档。整份为空时**不渲染这张纸**：由页面给空态（这里不印占位文案）。
 *
 * 标题 / 保存时间 / 操作按钮**都不在这里** —— 它们是页面的头部与导引栏的事。
 * 纸张上只有简历本身（这也是打印时唯一该出现的东西）。
 */
export function ResumeSheet({ data, className }: ResumeSheetProps) {
  const sheet = useMemo(() => analyzeSheet(data), [data])
  if (sheet.isEmpty) return null

  const { view } = sheet
  const name = asText(view.basic.name).trim()
  // 性别是展示字段（决定照片位画男生还是女生）；它不进 hasHeadline，也不撑起一个模块
  const gender = asText(view.basic.gender).trim()
  const avatarVariant = resolveAvatarVariant(gender)
  const contact = asText(view.basic.contact).trim()
  const direction = asText(view.target.direction).trim()
  const city = asText(view.target.city).trim()

  return (
    <article
      data-print="card"
      className={[
        // 纸：**零圆角** —— 2px 墨线边框 + 8px 硬投影把纸"立"起来（代替原来的圆角白卡）
        'resume-sheet w-full max-w-[820px] border-2 border-primary bg-card text-on-surface shadow-[8px_8px_0_0_var(--outline-variant)]',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      {/* 纸顶标题带：深墨斜块 + 赭金细线 */}
      <div className="resume-titleband">
        <h1 className="resume-titleblock">个人简历</h1>
        <span className="resume-titleband-mark" aria-hidden>
          RESUME
        </span>
      </div>

      {/* 纸的内容：⚠️ 内边距放在这一层，打印时由 print.css 清零 */}
      <div className="resume-body flex flex-col gap-7 px-6 py-7 sm:px-10 sm:py-9">
        {/*
         * 基本信息：字段表（姓名 / 性别 / 学校 / 专业 / 年级 / 联系方式）+ 右上照片位。
         * 整段只在抬头有实质内容时出现 —— 抬头空、只有别的模块有内容时，
         * 这里不印一个"只有照片和标题"的空模块（空模块照旧整段不出现）。
         */}
        {sheet.hasHeadline ? (
          <Section title="基本信息">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_128px]">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
                <InfoField label="姓　名" value={name} />
                <InfoField label="性　别" value={gender} />
                <InfoField label="学　校" value={asText(view.basic.school)} />
                <InfoField label="专　业" value={asText(view.basic.major)} />
                <InfoField label="年　级" value={asText(view.basic.grade)} />
                <InfoField label="联系方式" value={contact} wide />
              </dl>
              <figure
                className={[
                  'resume-photo',
                  avatarVariant === 'female' ? 'resume-photo--female' : '',
                ]
                  .join(' ')
                  .trim()}
              >
                <PixelAvatar variant={avatarVariant} className="h-full w-full" />
              </figure>
            </div>
          </Section>
        ) : null}

        {sheet.sections.map((key) => (
          <Section key={key} title={SECTION_LABELS[key]}>
            {key === 'target' ? <TargetLine direction={direction} city={city} /> : null}
            {key === 'education' ? <EducationList items={view.education} /> : null}
            {key === 'skills' ? <Skills items={view.skills} /> : null}
            {key === 'projects' ? <ExperienceList items={view.projects} /> : null}
            {key === 'campus' ? <ExperienceList items={view.campus} /> : null}
            {key === 'self_evaluation' ? <Evaluation text={asParagraph(view.self_evaluation)} /> : null}
          </Section>
        ))}
      </div>
    </article>
  )
}

/**
 * 模块：直角飘带标题（`resume-ribbon`）+ 一条发丝线。
 *
 * ⚠️ `resume-section-title` 与里面**唯一那个** `<span>` 都不许改名/换结构：
 * 打印样式正是靠 `.resume-section-title span` 把这条线换成主色 0.6pt。
 * 飘带里的赭金小方块走 CSS `::before`（见 resume.css），**不能**再往这里塞第二个 `<span>`。
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="resume-section-title flex items-center gap-3">
        <h3 className="resume-ribbon text-headline-sm">{title}</h3>
        {/* ⚠️ 这条 <span> 是打印时的那条分隔线（print.css 靠 .resume-section-title span 选中它），不能删、不能加第二个 */}
        <span className="block h-px flex-1 bg-border" aria-hidden />
      </div>
      {children}
    </section>
  )
}

/**
 * 基本信息里的一个字段：标签 + 值。
 *
 * ⚠️ 空值直接返回 `null`（不占位、不印「未填写」）：纸上只印用户真写过的字段。
 */
function InfoField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  const text = value.trim()
  if (!text) return null
  return (
    <div className={['flex items-baseline gap-3', wide ? 'sm:col-span-2' : ''].join(' ').trim()}>
      <dt className="shrink-0 text-body-md tracking-[0.34em] text-caption-foreground">{label}</dt>
      <dd className="min-w-0 text-body-md font-semibold break-all text-primary">{text}</dd>
    </div>
  )
}

/**
 * 求职意向：想投的方向 + 期望城市（14/600，一行）。
 *
 * ⚠️ 抬头那一块已经整块删掉（姓名 / 学校 / 专业 / 年级 / 联系方式都进了「基本信息」字段表），
 * 所以城市只能在这里出现 —— 否则同一张纸上会出现两处同样的信息，或者城市干脆丢了。
 * 两者都空时这个模块本来就不会出现（见 analyzeSheet 的 `target` 判空）。
 */
function TargetLine({ direction, city }: { direction: string; city: string }) {
  const parts: string[] = []
  if (direction) parts.push(direction)
  if (city) parts.push(`期望城市：${city}`)
  return <p className="text-body-md font-semibold text-primary">{parts.join(' ｜ ')}</p>
}

/** 教育背景：学校 · 专业 + 期间（等宽 14px）+ 亮点 */
function EducationList({ items }: { items: ResumeData['education'] }) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => {
        const period = asText(item.period).trim()
        const title =
          [asText(item.school).trim(), asText(item.major).trim()].filter(Boolean).join(' · ') ||
          '教育经历'
        return (
          <div key={index} className="resume-entry flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-body-md font-semibold text-primary">{title}</span>
              {period ? (
                /* 期间：等宽数字 + body-sm。文档字号自成一套，这里比正文（15）小一档，
                   但仍是"承载信息"的档位（方案 A 的 14 是信息最低档，不降到 13 的装饰档） */
                <span className="font-numeric text-body-sm text-caption-foreground">{period}</span>
              ) : null}
            </div>
            <Bullets items={item.highlights} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * 技能：两种形态。
 *
 * 用户在表单里写的是关键词（Vue / TypeScript / Excel），润色会把它们展开成一句能力表述
 * （"熟悉 Vue 声明式 UI 与状态管理…"）。短词条拼一行最省地方；展开成句子的必须一条一行 ——
 * 它自己就带顿号逗号，再拼一行会连成一坨、读不出边界。判断逻辑 `skillsAreKeywords` 沿用原实现。
 */
function Skills({ items }: { items: string[] }) {
  if (skillsAreKeywords(items)) {
    return (
      <ul className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((skill, index) => (
          <li key={index} className="flex items-center gap-2 text-body-md text-primary">
            {index > 0 ? <SquareDot className="mt-0" /> : null}
            <span>{skill}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((skill, index) => (
        <li key={index} className="flex items-start gap-2 text-body-md leading-[1.7] text-primary">
          <SquareDot />
          <span className="min-w-0">{skill}</span>
        </li>
      ))}
    </ul>
  )
}

/** 项目 / 校园经历：名称 · 角色 + 期间 + STAR 四段（中文小标题） */
function ExperienceList({ items }: { items: ResumeExperienceItem[] }) {
  return (
    <div className="flex flex-col gap-5">
      {items.map((item, index) => {
        const period = asText(item.period).trim()
        const role = asText(item.role).trim()
        const title =
          [asText(item.name).trim(), role].filter(Boolean).join(' · ') || '一段经历'
        return (
          <div key={index} className="resume-entry flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-body-md font-semibold text-primary">{title}</span>
              {period ? (
                <span className="font-numeric text-body-sm text-caption-foreground">{period}</span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              {STAR_LABELS.map(({ key, label }) => {
                // 收敛后再取：star 是对象、四段都是字符串，空的那段直接不显示
                const body = asText(item.star?.[key]).trim()
                if (!body) return null
                return (
                  <p key={key} className="text-body-md leading-[1.7] text-primary">
                    <span className="font-semibold">{label}：</span>
                    <span className="whitespace-pre-line">{body}</span>
                  </p>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** 自我评价：一段话（保留用户写的换行） */
function Evaluation({ text }: { text: string }) {
  return (
    <p className="text-body-md leading-[1.7] whitespace-pre-line text-primary">{text}</p>
  )
}

/**
 * 列表符号：**直角小方块**（配合"零圆角"的版面语汇，不用圆点 `rounded-full`）。
 * 首行文字的视觉中线约在 10px 处，方块 4px 高 → 上边距 ~10px。
 */
function SquareDot({ className }: { className?: string }) {
  return (
    <span
      className={['h-1 w-1 shrink-0 bg-primary', className ?? 'mt-2.5'].join(' ').trim()}
      aria-hidden
    />
  )
}

function Bullets({ items }: { items?: string[] }) {
  // 亮点字段混进非字符串元素时会被 asTextList 过滤掉，不会渲染出 [object Object]
  const filled = asTextList(items)
  if (!filled.length) return null
  return (
    <ul className="flex flex-col gap-1">
      {filled.map((item, index) => (
        <li
          key={index}
          className="flex items-start gap-2 text-body-md leading-[1.7] text-on-surface"
        >
          <SquareDot />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 技能是"短词条"还是"展开后的句子"。
 *
 * 短词条（≤12 字且无句读）拼一行最好看；只要有一条是展开后的句子，就一条一行。
 */
function skillsAreKeywords(skills: string[]): boolean {
  return skills.every((skill) => skill.length <= 12 && !/[，。；、,.;]/.test(skill))
}

export default ResumeSheet
