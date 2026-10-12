import { useMemo } from 'react'
import { GraduationCap, Mail, MapPin } from 'lucide-react'

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
 * 2026-10 重做（原来叫 ResumePreview，是一叠"卡片"）：
 * 它现在是**一张纸上的连贯文档**，不是几个区块卡拼起来的东西 ——
 * - 纸：白底 + 1px 描边 + 12px 圆角，**没有阴影**，宽度上限 820px、居中；
 *   顶部一条 24×2 的琥珀短条作文档标识（不是通栏色带）；
 * - 抬头：姓名 24/600；同一行右侧「求职意向：xxx / 城市」13px 次要色；
 *   联系方式（学校 · 专业 · 年级 + 邮箱）13px，配 lucide 极小图标，之间用细分隔符；
 * - 模块标题 13/600 + 一条发丝线（线只在**文档宽度内**，不横贯屏幕）+ 14px 正文；
 * - 模块顺序照真实数据：基本信息（抬头）/ 求职意向 / 教育背景 / 技能 /
 *   项目经历 / 校园与实践经历 / 自我评价。
 *
 * 四条硬规矩（沿用上一版的结论，一条都没放松）：
 * 1. **空模块在文档里直接不渲染**（`analyzeSheet`）。正式简历上不会出现
 *    「这一节还没填，先空着」这种开发占位文案 —— 缺哪一段由**文档外**的导引栏来说，
 *    文档本身保持干净。整份为空时由页面给空态（`isEmpty`），不是在这里印一行占位；
 * 2. 经历里的四段一律中文小标题（情境 / 任务 / 行动 / 结果），
 *    **绝不出现 situation / task / action / result 这类英文字段名**；
 * 3. 空的字段不显示、不占位；
 * 4. **形状不由我们说了算**：库里可能躺着「上传 PDF → 解析」那版旧功能写下的旧结构，
 *    甚至 null / 字符串。`analyzeSheet` 第一件事就是过 `normalizeResumeData`
 *    （形状收敛层），之后所有渲染只碰收敛后的值 —— 不会再有
 *    `(data.education ?? []).every is not a function` 这种整页崩。
 *
 * ⚠️ 打印依赖的类名**一个字都不能改**（styles/print.css 靠它们排版）：
 * `resume-page`（铺满纸张）、`resume-sheet`（白底黑字、去边框圆角）、
 * `resume-section-title` + 里面那个 `<span class="bg-border">`（换成主色 0.6pt 细线）、
 * `resume-entry`（一段经历不许被撕成两页）。
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
  const meta = [asText(view.basic.school), asText(view.basic.major), asText(view.basic.grade)]
    .map((part) => part.trim())
    .filter(Boolean)
  const contact = asText(view.basic.contact).trim()
  const direction = asText(view.target.direction).trim()
  const city = asText(view.target.city).trim()

  return (
    <article
      data-print="card"
      className={[
        // 纸：白底 / 1px 描边 / 12px 圆角 / **无阴影**；窄屏 24px、宽屏 48px 内边距
        'resume-sheet flex w-full max-w-[820px] flex-col gap-8 rounded-xl border border-border bg-card px-6 py-8 text-on-surface sm:px-12 sm:py-10',
        className ?? '',
      ]
        .join(' ')
        .trim()}
    >
      {/*
        文档标识：一小段琥珀短条（不是通栏色带）。
        它是**屏幕上的**标识，打印时印出来就是一截悬在纸顶的棕色小杠，所以 print 变体里关掉。
      */}
      <span className="block h-0.5 w-6 rounded-full bg-secondary print:hidden" aria-hidden />

      <header className="flex flex-col gap-4">
        <h2 className="text-headline-lg text-primary">{name || '我的简历'}</h2>

        {meta.length || contact || city ? (
          /* 联系方式块：13px + 极小图标，项与项之间是细分隔符（不画整块浅底） */
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-4 text-body-sm text-on-surface-variant">
            {meta.length ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <GraduationCap className="size-4 shrink-0" aria-hidden />
                <span>{meta.join(' · ')}</span>
              </span>
            ) : null}
            {contact ? (
              <>
                {meta.length ? (
                  <span className="text-outline-variant" aria-hidden>
                    |
                  </span>
                ) : null}
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mail className="size-4 shrink-0" aria-hidden />
                  <span className="break-all">{contact}</span>
                </span>
              </>
            ) : null}
            {city ? (
              <>
                {meta.length || contact ? (
                  <span className="text-outline-variant" aria-hidden>
                    |
                  </span>
                ) : null}
                <span className="flex min-w-0 items-center gap-1.5">
                  <MapPin className="size-4 shrink-0" aria-hidden />
                  <span>期望城市：{city}</span>
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </header>

      {sheet.sections.map((key) => (
        <Section key={key} title={SECTION_LABELS[key]}>
          {key === 'target' ? <TargetLine direction={direction} /> : null}
          {key === 'education' ? <EducationList items={view.education} /> : null}
          {key === 'skills' ? <Skills items={view.skills} /> : null}
          {key === 'projects' ? <ExperienceList items={view.projects} /> : null}
          {key === 'campus' ? <ExperienceList items={view.campus} /> : null}
          {key === 'self_evaluation' ? <Evaluation text={asParagraph(view.self_evaluation)} /> : null}
        </Section>
      ))}
    </article>
  )
}

/**
 * 模块：标题 13/600 + 一条发丝线。
 *
 * ⚠️ `resume-section-title` 与里面那个 `<span class="bg-border">` 都不许改名/换结构：
 * 打印样式正是靠 `.resume-section-title span` 把这条线换成主色 0.6pt。
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="resume-section-title flex flex-col gap-1.5">
        <h3 className="text-body-sm font-semibold tracking-wide text-primary">{title}</h3>
        <span className="block h-px w-full bg-border" aria-hidden />
      </div>
      {children}
    </section>
  )
}

/**
 * 求职意向：想投的方向（14/600，一行）。
 *
 * ⚠️ 抬头那一行原来复述过一遍「求职意向：xxx / 城市」—— 打印出来同一张纸上有两处
 * 同样的信息，而模块体本身是空的（只剩一个标题 + 一条线悬在那儿）。
 * 现在：抬头只放姓名 + 联系方式（学校 · 专业 · 年级 | 邮箱 | 期望城市），
 * 求职意向模块自己带内容，方向只在这里出现一次。
 */
function TargetLine({ direction }: { direction: string }) {
  return <p className="text-body-md font-semibold text-primary">{direction}</p>
}

/** 教育背景：学校 · 专业 + 期间（等宽 12px）+ 亮点 */
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
                /* 期间：等宽 + 12px（规范里唯一允许 12px 用 font-numeric 的地方） */
                <span className="font-numeric text-caption text-caption-foreground">{period}</span>
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
 * 用户在表单里写的是关键词（ArkTS / TypeScript / Excel），润色会把它们展开成一句能力表述
 * （"熟悉 ArkTS 声明式 UI 与状态管理…"）。短词条拼一行最省地方；展开成句子的必须一条一行 ——
 * 它自己就带顿号逗号，再拼一行会连成一坨、读不出边界。判断逻辑 `skillsAreKeywords` 沿用原实现。
 */
function Skills({ items }: { items: string[] }) {
  if (skillsAreKeywords(items)) {
    return (
      <ul className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((skill, index) => (
          <li key={index} className="flex items-center gap-2 text-body-md text-primary">
            {index > 0 ? (
              <span className="text-secondary" aria-hidden>
                ·
              </span>
            ) : null}
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
          <span className="text-secondary" aria-hidden>
            ·
          </span>
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
                <span className="font-numeric text-caption text-caption-foreground">{period}</span>
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

function Bullets({ items }: { items?: string[] }) {
  // 亮点字段混进非字符串元素时会被 asTextList 过滤掉，不会渲染出 [object Object]
  const filled = asTextList(items)
  if (!filled.length) return null
  return (
    <ul className="flex flex-col gap-1">
      {filled.map((item, index) => (
        <li
          key={index}
          className="flex items-start gap-2 text-body-md leading-[1.7] text-on-surface-variant"
        >
          <span aria-hidden>·</span>
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
