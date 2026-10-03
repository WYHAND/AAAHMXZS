import { useMemo } from 'react'
import { Pencil, Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  asParagraph,
  asText,
  asTextList,
  normalizeResumeData,
} from '@/pages/resume/resumeShape'
import type { ResumeData, ResumeExperienceItem, ResumeResponse, ResumeStar } from '@/types'
import { formatRelative } from '@/utils/format'

/**
 * 展示态：把润色后的 parsed_data 渲染成**一份像简历的东西**。
 *
 * 三条硬规矩：
 * 1. 单栏、白底卡片、章节标题带一条细线；姓名/年级/专业/学校/联系方式在顶部；
 * 2. 经历里的四段一律用中文小标题（情境 / 任务 / 行动 / 结果），
 *    **绝不出现 situation / task / action / result 这类英文字段名**；
 * 3. 空的字段**不显示**（不占位、不留空格子）；整节都空时折叠成一行
 *    「这一节还没填，先空着」—— 用户看得见"哪里还没写"，但不会被一排空框淹掉。
 *
 * 第 4 条（这条是被线上崩出来的）：**这份数据是历史数据，形状不由我们说了算**。
 * 库里可能躺着「上传 PDF → 解析」那版旧功能写下的旧结构，甚至 `null` / 字符串。
 * 所以进来第一件事是过 `normalizeResumeData`（形状收敛层）：
 * 收敛之后 `education` / `projects` / `campus` 一定是数组、`skills` 一定是字符串数组，
 * 下面所有渲染都只碰收敛后的值 —— 再也不会出现
 * `(data.education ?? []).every is not a function` 这种整页崩。
 *
 * 这里只读不写：所有内容都来自用户自己填（+ 润色改写）的 parsed_data。
 */

interface ResumePreviewProps {
  data: ResumeData
  resume: ResumeResponse | null
  onEdit: () => void
}

const STAR_LABELS: Array<{ key: keyof ResumeStar; label: string }> = [
  { key: 'situation', label: '情境' },
  { key: 'task', label: '任务' },
  { key: 'action', label: '行动' },
  { key: 'result', label: '结果' },
]

export function ResumePreview({ data, resume, onEdit }: ResumePreviewProps) {
  // 形状收敛：任何形状的 parsed_data 到这里都变成一份「结构完整」的简历
  const view = useMemo(() => normalizeResumeData(data), [data])

  const { basic, target } = view
  /** 顶部一行：年级 / 专业 / 学校 / 联系方式（空的不显示） */
  const headline = [basic.grade, basic.major, basic.school].map(asText).filter(Boolean)
  const contact = asText(basic.contact).trim()
  const name = asText(basic.name).trim()

  const targetText = `${target.direction}${target.city}`.trim()
  const selfEvaluation = asParagraph(view.self_evaluation).trim()
  /** 保存时间也要收敛：万一后端给的不是字符串，宁可显示"还没保存"也不让它抛异常 */
  const updatedAt = asText(resume?.updated_at).trim()

  return (
    <div className="resume-page mx-auto flex w-full max-w-3xl flex-col gap-4">
      {/* 展示态的两个动作：编辑 / 打印导出。打印时靠全局 [data-print='hide'] 隐藏 */}
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {updatedAt
            ? `这份简历上次保存于 ${formatRelative(updatedAt)}。`
            : '这份简历还没保存到服务器。'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
            <Pencil className="size-4" />
            编辑
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
            <Printer className="size-4" />
            打印 / 导出
          </Button>
        </div>
      </div>

      <article
        data-print="card"
        className="resume-sheet flex flex-col gap-5 rounded-xl border bg-card px-6 py-7 text-card-foreground shadow-card sm:px-8"
      >
        {/* 抬头 */}
        <div className="flex flex-col gap-1.5">
          <h2 className="text-2xl font-semibold text-foreground">{name || '我的简历'}</h2>
          {headline.length ? (
            <p className="text-sm text-muted-foreground">{headline.join(' · ')}</p>
          ) : null}
          {contact ? <p className="text-sm text-muted-foreground">{contact}</p> : null}
        </div>

        {/* 求职意向 */}
        <Section title="求职意向" empty={!targetText} emptyText="求职意向还没填，先空着。">
          <div className="flex flex-col gap-0.5 text-sm">
            {asText(target.direction).trim() ? (
              <p className="font-medium text-foreground">{asText(target.direction).trim()}</p>
            ) : null}
            {asText(target.city).trim() ? (
              <p className="text-muted-foreground">期望城市：{asText(target.city).trim()}</p>
            ) : null}
          </div>
        </Section>

        {/* 教育背景 */}
        <Section
          title="教育背景"
          empty={view.education.length === 0}
          emptyText="教育背景还没填，先空着。"
        >
          <div className="flex flex-col gap-3">
            {view.education.map((item, index) => {
              const period = asText(item.period).trim()
              return (
                <div key={index} className="resume-entry flex flex-col gap-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-sm font-medium text-foreground">
                      {[asText(item.school).trim(), asText(item.major).trim()]
                        .filter(Boolean)
                        .join(' · ') || '教育经历'}
                    </span>
                    {period ? (
                      <span className="font-numeric text-xs text-muted-foreground">{period}</span>
                    ) : null}
                  </div>
                  <Bullets items={item.highlights} />
                </div>
              )
            })}
          </div>
        </Section>

        {/* 技能 */}
        <Section
          title="技能"
          empty={view.skills.length === 0}
          emptyText="技能还没填，先空着。"
        >
          {skillsAreKeywords(view.skills) ? (
            /* 短词条（Java、Vue、Excel）拼一行最省地方 */
            <p className="text-sm text-foreground">{view.skills.join('、')}</p>
          ) : (
            /*
             * 展开成句子的技能（"熟悉 Java 基础语法、面向对象编程…"）：
             * 一句话里本来就带顿号，再用顿号拼会连成一坨、读不出边界，所以一条一行。
             */
            <ul className="flex flex-col gap-1.5">
              {view.skills.map((skill, index) => (
                <li key={index} className="flex gap-2 text-sm text-foreground">
                  <span className="text-muted-foreground" aria-hidden>
                    ·
                  </span>
                  <span>{skill}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 项目经历 */}
        <Section
          title="项目经历"
          empty={view.projects.length === 0}
          emptyText="项目经历还没填，先空着。"
        >
          <ExperienceList items={view.projects} />
        </Section>

        {/* 校园与实践经历 */}
        <Section
          title="校园与实践经历"
          empty={view.campus.length === 0}
          emptyText="校园与实践经历还没填，先空着。"
        >
          <ExperienceList items={view.campus} />
        </Section>

        {/* 自我评价 */}
        <Section
          title="自我评价"
          empty={!selfEvaluation}
          emptyText="自我评价还没写，先空着。"
        >
          <p className="text-sm whitespace-pre-line text-foreground">{selfEvaluation}</p>
        </Section>
      </article>
    </div>
  )
}

/** 章节：标题 + 一条细线；整节为空时只留一行很轻的说明 */
function Section({
  title,
  empty,
  emptyText,
  children,
}: {
  title: string
  empty: boolean
  emptyText: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="resume-section-title flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-wide text-foreground">{title}</h3>
        <span className="block h-px w-full bg-border" aria-hidden />
      </div>
      {empty ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
    </section>
  )
}

/** 项目 / 校园经历：名称 · 角色 · 时间 + STAR 四段（中文小标题） */
function ExperienceList({ items }: { items: ResumeExperienceItem[] }) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((item, index) => {
        const period = asText(item.period).trim()
        const role = asText(item.role).trim()
        return (
          <div key={index} className="resume-entry flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium text-foreground">
                {[asText(item.name).trim(), role].filter(Boolean).join(' · ') || '一段经历'}
              </span>
              {period ? (
                <span className="font-numeric text-xs text-muted-foreground">{period}</span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              {STAR_LABELS.map(({ key, label }) => {
                // 收敛后再取：star 是对象、四段都是字符串，空的那段直接不显示
                const body = asText(item.star?.[key]).trim()
                if (!body) return null
                return (
                  <p key={key} className="text-sm text-foreground">
                    <span className="font-medium">{label}：</span>
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

function Bullets({ items }: { items?: string[] }) {
  // 亮点字段混进非字符串元素时会被 asTextList 过滤掉，不会渲染出 [object Object]
  const filled = asTextList(items)
  if (!filled.length) return null
  return (
    <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm text-muted-foreground">
      {filled.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )
}

/**
 * 技能是"短词条"还是"展开后的句子"。
 *
 * 用户在表单里写的是关键词（Java / Vue / Excel），润色会把它们展开成一句能力表述
 * （"熟悉 Java 基础语法、面向对象编程（封装、继承、多态）、集合框架、异常处理、IO 流。…"）。
 * 短词条拼一行最好看；展开成句子的那种必须一条一行 —— 它自己就带顿号，
 * 再拼一行会连成一坨。
 */
function skillsAreKeywords(skills: string[]): boolean {
  return skills.every((skill) => skill.length <= 12 && !/[，。；、,.;]/.test(skill))
}
