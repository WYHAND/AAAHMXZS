import {
  asRecord,
  asRowList,
  asText,
  asTextList,
  isPlainObject,
  normalizeResumeData,
} from '@/pages/resume/resumeShape'
import type { ResumeData, ResumeField, ResumeResponse, ResumeSection } from '@/types'

/**
 * 「我的简历」表单的数据层（纯函数，无 React）。
 *
 * 两套结构必须分清：
 * 1. **后端契约结构** `ResumeData`（parsed_data）：固定键名，
 *    star 是一层嵌套对象（{ situation, task, action, result }）；
 * 2. **表单结构** `FormData`：**模板里每个字段一个扁平键**，重复经历的键形如
 *    `education.0.school`、`projects.1.star.situation`。
 *
 * 为什么要第 2 套：问题文案（question）完全由接口下发，前端不硬编码字段清单，
 * 所以表单不能长成一张写死的 state 对象；用「模板 key → 值」的扁平表，
 * 接口明天多问一个问题，表单明天就多一个输入框，前端一行都不用改。
 *
 * 但**展示态**（ResumePreview）渲染的是「一份简历」，它需要的正是后端那套结构，
 * 所以这里同时负责两套结构之间的双向转换：
 *   template + ResumeData → FormData（预填）
 *   FormData → ResumeData（提交给润色 / 保存）
 */

/** 键一律用字符串；空值一律是 ''（multiple 字段用 []）—— 便于判空与受控输入 */
export type FormValue = string | string[]
export type FormData = Record<string, FormValue>

/* --------------------------------- 读模板 --------------------------------- */

/**
 * 形状判定与收敛统一在 resumeShape.ts（`isPlainObject` / `asRecord` / `asText` / `asTextList`）：
 * 这里所有对 parsed_data 的读取都不许直接信任类型，先收敛再取值。
 */

/** 模板可能没下发 sections（老后端 / 契约漂移）→ 当空模板，页面给失败态而不是崩 */
export function readSections(template: unknown): ResumeSection[] {
  const source = asRecord(template)
  const sections = source.sections
  if (!Array.isArray(sections)) return []
  return sections.filter(isPlainObject).map((section, index) => {
    const fields = Array.isArray(section.fields) ? section.fields.filter(isPlainObject) : []
    return {
      key: typeof section.key === 'string' && section.key ? section.key : `section_${index}`,
      label: typeof section.label === 'string' ? section.label : '未命名章节',
      repeatable: section.repeatable === true,
      fields: fields
        .filter((field) => typeof field.key === 'string' && field.key.length > 0)
        .map((field) => ({
          key: field.key as string,
          label: typeof field.label === 'string' ? field.label : (field.key as string),
          question: typeof field.question === 'string' ? field.question : null,
          example: typeof field.example === 'string' ? field.example : null,
          required: field.required === true,
          multiple: field.multiple === true,
          lines: field.lines === true,
        })),
    }
  })
}

/** 字段的 key 可能是 `star.situation` 这种带点的路径（相对 section / 相对单条经历） */
export function fieldPaths(field: ResumeField): string[] {
  return field.key
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
}

/** 表单键：repeatable 的 section 带条目下标前缀 */
export function formKey(section: ResumeSection, index: number, field: ResumeField): string {
  const path = fieldPaths(field).join('.')
  return section.repeatable ? `${section.key}.${index}.${path}` : `${section.key}.${path}`
}

/** 表单键 → 本轮提交给后端的固定结构（只认契约里的七个 section） */
const WIRE_PATHS: Record<string, Record<string, string[]>> = {
  basic: {
    name: ['name'],
    gender: ['gender'],
    grade: ['grade'],
    major: ['major'],
    school: ['school'],
    contact: ['contact'],
  },
  target: { direction: ['direction'], city: ['city'] },
  skills: {
    items: ['items'],
    // 契约里 skills 是**扁平字符串数组**：模板就算把它写成一个对象，
    // 也只认 items / list / skills 这几个键，其余行按标签处理
    list: ['items'],
    skills: ['items'],
  },
  self_evaluation: { text: ['text'], items: ['text'], content: ['text'] },
  education: {
    school: ['school'],
    major: ['major'],
    period: ['period'],
    highlights: ['highlights'],
  },
  projects: {
    name: ['name'],
    role: ['role'],
    period: ['period'],
    'star.situation': ['star', 'situation'],
    'star.task': ['star', 'task'],
    'star.action': ['star', 'action'],
    'star.result': ['star', 'result'],
  },
  campus: {
    name: ['name'],
    role: ['role'],
    period: ['period'],
    'star.situation': ['star', 'situation'],
    'star.task': ['star', 'task'],
    'star.action': ['star', 'action'],
    'star.result': ['star', 'result'],
  },
}

/** 模板 key 在契约结构里的落点；返回 null 表示这个 section 不在契约里（展示态再兜） */
export function wirePath(sectionKey: string, fieldKey: string): string[] | null {
  const normalized = fieldKey
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('.')
  // 教育经历的亮点是「相对单条经历」的数组，但它不在上面那张表里（表只收点号路径）
  if (sectionKey === 'education' && normalized === 'highlights') return ['highlights']
  return WIRE_PATHS[sectionKey]?.[normalized] ?? null
}

/* ------------------------------- 空表单 / 预填 ------------------------------- */

export function emptyValue(field: ResumeField): FormValue {
  return field.multiple ? [] : ''
}

function writeFields(
  target: FormData,
  section: ResumeSection,
  index: number,
  values: Record<string, unknown>,
): void {
  for (const field of section.fields) {
    writeField(target, section, index, field, values[field.key])
  }
}

/** 单个字段的受控值：multiple → 字符串数组；其余 → 字符串（模板说是什么类型就用什么类型） */
function writeField(
  target: FormData,
  section: ResumeSection,
  index: number,
  field: ResumeField,
  raw: unknown,
): void {
  const key = formKey(section, index, field)
  // 两种形状都过收敛层：非数组 → []，非字符串 → ''（绝不产出 [object Object]）
  target[key] = field.multiple ? asTextList(raw) : asText(raw)
}

/**
 * 按模板铺一张空表单（repeatable 的 section 至少给一条，否则用户看不到从哪填起）。
 * repeatable 没有条目时也给一条空条目。
 */
export function buildEmptyForm(sections: ResumeSection[]): FormData {
  const form: FormData = {}
  for (const section of sections) {
    const count = section.repeatable ? 1 : 0
    if (section.repeatable) {
      for (let i = 0; i < count; i += 1) writeFields(form, section, i, {})
    } else {
      writeFields(form, section, 0, {})
    }
  }
  return form
}

/** 把一个 section 摊平（新增一条空经历时用） */
export function writeEmptyEntry(
  form: FormData,
  section: ResumeSection,
  index: number,
): FormData {
  const next: FormData = { ...form }
  writeFields(next, section, index, {})
  return next
}

/**
 * 用已保存的 parsed_data 预填表单。
 *
 * 三件事：
 * 1. **旧结构先搬过来**：整份数据先过 `normalizeResumeData`（形状收敛层），
 *    契约字段一律从收敛后的结构读 —— 旧结构（basics / education 对象 /
 *    projects 字符串）于是能填进新表单，形状不对的也不会抛异常；
 * 2. 模板字段按**契约路径**读值（模板说 `star.situation` → 读 row.star.situation）；
 * 3. 顺手把契约外的字段也摊平进表单（`coerceUnknown`，读的是**原始数据**），
 *    这样"后端多给了一段内容"只会多出一个输入框，不会在保存时被静默丢掉。
 */
export function formFromResumeData(sections: ResumeSection[], data: unknown): FormData {
  const form = buildEmptyForm(sections)
  if (!isPlainObject(data)) return form

  // 收敛后的契约结构：旧结构在这里已经被搬到新位置上
  const wire = normalizeResumeData(data) as unknown as Record<string, unknown>

  for (const section of sections) {
    const value = wire[section.key]
    /** 原始值：只用来搬运模板之外的键，读的时候仍然要收敛 */
    const rawValue = data[section.key]

    const writeRow = (row: Record<string, unknown>, index: number) => {
      for (const field of section.fields) {
        // 契约路径（wirePath）就是后端结构里的读法：star.situation → row.star.situation
        writeField(form, section, index, field, readPath(row, wirePath(section.key, field.key) ?? fieldPaths(field)))
      }
    }

    // skills 在后端是**裸字符串数组**，不是对象：整段当标签列表摊平
    if (section.key === 'skills' && Array.isArray(value)) {
      const items = asTextList(value)
      for (const field of section.fields) {
        const key = formKey(section, 0, field)
        form[key] = field.multiple ? items : items.join('、')
      }
      continue
    }

    if (section.repeatable) {
      // asRowList：单个对象也当一条（旧结构 education 是对象），字符串包成一条
      const rows = asRowList(value)
      const rawRows = asRowList(rawValue)
      const known = new Set(
        section.fields.map(
          (field) => wirePath(section.key, field.key)?.join('.') ?? fieldPaths(field).join('.'),
        ),
      )
      rows.forEach((row, index) => {
        writeRow(row, index)
        // 模板之外多出来的键：原样带着（保存时不至于丢）
        for (const [key, raw] of Object.entries(coerceUnknown(rawRows[index] ?? {}, known))) {
          form[`${section.key}.${index}.${key}`] = raw
        }
      })
      continue
    }

    const row = asRecord(value)
    writeRow(row, 0)
    const known = new Set(
      section.fields.map(
        (field) => wirePath(section.key, field.key)?.join('.') ?? fieldPaths(field).join('.'),
      ),
    )
    for (const [key, raw] of Object.entries(coerceUnknown(asRecord(rawValue), known))) {
      form[`${section.key}.0.${key}`] = raw
    }
  }
  return form
}

function readPath(row: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = row
  for (const part of path) {
    if (!isPlainObject(current)) return undefined
    current = current[part]
  }
  return current
}

/**
 * 契约外的值 → 表单值。嵌套对象摊成点号键（star.foo → "star.foo"），
 * 数组取非空字符串项，其余转字符串。
 */
function coerceUnknown(
  row: Record<string, unknown>,
  known: Set<string>,
  prefix = '',
): Record<string, FormValue> {
  const out: Record<string, FormValue> = {}
  for (const [key, value] of Object.entries(row)) {
    if (prefix === '' && known.has(key)) continue
    if (isPlainObject(value)) {
      Object.assign(out, coerceUnknown(value, known, `${prefix}${key}.`))
    } else if (Array.isArray(value)) {
      const items = asTextList(value)
      if (items.length) out[`${prefix}${key}`] = items
    } else {
      const text = asText(value)
      if (text.trim()) out[`${prefix}${key}`] = text
    }
  }
  return out
}

/* --------------------------------- 判空 / 序列化 --------------------------------- */

export function isEmptyValue(value: FormValue | undefined): boolean {
  // 收敛后再判空：数组里混进非字符串也不会在 .trim() 上抛异常
  if (Array.isArray(value)) return asTextList(value).length === 0
  return !asText(value).trim()
}

/** 表单里有没有用户写过的东西（决定「润色」能不能点） */
export function formHasContent(form: FormData): boolean {
  return Object.values(form).some((value) => !isEmptyValue(value))
}

export function splitMultiple(text: string): string[] {
  return text
    .split(/[,，、;；\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** multiple 输入框里显示的文本（存的是数组，显示时逗号分隔） */
export function joinMultiple(value: FormValue | undefined): string {
  return Array.isArray(value) ? asTextList(value).join('、') : asText(value)
}

/**
 * `lines: true` 的多值字段（技能）：**一项一行**，只按换行切。
 *
 * 为什么不复用 `splitMultiple`：技能经润色展开后是一句**带顿号逗号**的话
 * （"熟悉 Java 基础语法、面向对象编程、集合框架…"），按顿号切会把一句话
 * 拆成好几项假技能。
 */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** `lines` 字段在输入框里显示的文本（每一项一行） */
export function joinLines(value: FormValue | undefined): string {
  return Array.isArray(value) ? asTextList(value).join('\n') : asText(value)
}

/**
 * 表单 → 发给润色 / 保存的结构。
 *
 * 只发**用户真的写过**的内容：空字符串 / 空数组不发，
 * 免得 AI 把空字段当成"需要补全的地方"自己编出来。
 * 模板里契约外的字段按它自己的点号键原样带上（后端只认契约键，多给无害），
 * 这样"模板多问了一个问题"也不会在保存时被丢掉。
 */
export function buildResumeData(sections: ResumeSection[], form: FormData): ResumeData {
  const data: Record<string, unknown> = {}
  for (const section of sections) {
    if (section.repeatable) {
      const rows: Record<string, unknown>[] = []
      const count = sectionEntryCount(section, form)
      for (let index = 0; index < count; index += 1) {
        const row = collectEntry(section, form, index)
        if (Object.keys(row).length) rows.push(row)
      }
      data[section.key] = rows
    } else {
      const row = collectEntry(section, form, 0)
      if (section.key === 'skills') {
        // 契约里 skills 是裸数组：取 multiple 字段的值拼起来
        const merged: string[] = []
        for (const field of section.fields) {
          const path = wirePath(section.key, field.key)
          if (path?.[0] !== 'items') continue
          const value = form[formKey(section, 0, field)]
          if (Array.isArray(value)) merged.push(...asTextList(value))
          else {
            const single = asText(value)
            if (single.trim()) merged.push(...(field.lines ? splitLines(single) : splitMultiple(single)))
          }
        }
        if (merged.length) data[section.key] = merged
        continue
      }
      if (Object.keys(row).length) data[section.key] = row
    }
  }
  return data as unknown as ResumeData
}

/** 一个 section 在表单里当前有几条（repeatable） */
export function sectionEntryCount(section: ResumeSection, form: FormData): number {
  const prefix = `${section.key}.`
  let max = 0
  for (const key of Object.keys(form)) {
    if (!key.startsWith(prefix)) continue
    const index = Number(key.slice(prefix.length).split('.')[0])
    if (Number.isInteger(index)) max = Math.max(max, index + 1)
  }
  // 一条都没有时仍保留一条空条目，避免「删到 0 条就再也加不回来」
  return Math.max(max, section.repeatable ? 1 : 0)
}

/** 把一条经历按契约路径收集成对象；空值不写进去 */
function collectEntry(
  section: ResumeSection,
  form: FormData,
  index: number,
): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const field of section.fields) {
    // 契约路径优先；模板里契约外的字段按它自己的点号键原样带上
    const path = wirePath(section.key, field.key) ?? fieldPaths(field)
    if (!path.length) continue
    const value = form[formKey(section, index, field)]
    if (isEmptyValue(value)) continue
    // 收敛后再写回契约结构：数组里混进非字符串也不会在 .trim() 上抛异常
    const cleaned: unknown = Array.isArray(value) ? asTextList(value) : asText(value).trim()
    writeWire(row, path, cleaned)
  }
  return row
}

function writeWire(row: Record<string, unknown>, path: string[], value: unknown): void {
  let current = row
  for (const part of path.slice(0, -1)) {
    const next = current[part]
    if (!isPlainObject(next)) {
      const created: Record<string, unknown> = {}
      current[part] = created
      current = created
    } else {
      current = next
    }
  }
  const last = path[path.length - 1]
  if (last) current[last] = value
}

/* --------------------------------- 展示态判空 --------------------------------- */

/** 有过润色结果就按「一份简历」渲染；这里给展示态用的判空口径 */
export function resumeDataHasContent(data: unknown): boolean {
  if (!isPlainObject(data)) return false
  const isEmpty = (value: unknown): boolean => {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return !value.trim()
    if (typeof value === 'number') return false
    if (Array.isArray(value)) return value.length === 0
    if (isPlainObject(value)) return Object.values(value).every(isEmpty)
    return true
  }
  return Object.values(data).some((value) => !isEmpty(value))
}

/** GET /resume/mine 拿回来的那份里，能不能渲染出东西 */
export function resumeHasContent(resume: ResumeResponse | null): boolean {
  return resumeDataHasContent(resume?.parsed_data)
}
