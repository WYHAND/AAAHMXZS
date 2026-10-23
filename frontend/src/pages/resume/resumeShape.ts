import type {
  ResumeData,
  ResumeEducationItem,
  ResumeExperienceItem,
  ResumeStar,
} from '@/types'

/**
 * parsed_data 的「形状收敛层」（纯函数、无 React、无副作用）。
 *
 * 为什么要有这一层：parsed_data 是**历史数据**。库里那份简历可能是
 * 「上传 PDF → 解析」那版旧功能留下的旧结构（`basics` 复数、`education` 是**单个对象**、
 * `projects`/`skills` 是**一整段字符串**），也可能是 `null`、`"字符串"`、`[]` 这种
 * 彻底不对的东西 —— 写旧结构的那几个老页面（简历列表 / 引导式新建 / 编辑）已经删了，
 * 路由里没有它们，所以旧结构只可能来自**历史数据**（库里早些时候存下的那份），
 * 后端只会把它原样还回来。
 *
 * 所以：**凡是外部来的 parsed_data，进页面先过这一层**。三条约定：
 *
 * 1. **永不抛异常**：任何输入（含 null / 字符串 / 数组 / 深层缺字段）都返回一个可用值，
 *    调用方拿到的数组一定是数组、字符串一定是字符串，不需要 `?.` 和 `?? []`；
 * 2. **绝不产出 `[object Object]` 和 `undefined`**：非字符串 → `''`（数字按真值转成文本），
 *    非数组 → `[]`，渲染层不可能把对象/undefined 直接印到页面上；
 * 3. **旧形状不静默丢弃**：见 `normalizeResumeData`（把旧结构尽力搬到新结构）。
 */

/**
 * 只有「真对象」才算对象：null / 数组 / 原始值一律不是。
 * 带类型谓词，`unknown[]` 需要收窄成对象数组时用 `.filter(isPlainObject)`。
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/* ------------------------------- 最小收敛原语 ------------------------------- */

/**
 * `unknown → 对象`。不是对象（null / undefined / 数组 / 字符串 / 数字…）→ `{}`。
 * 返回值**永不为 null/undefined**，所以 `asRecord(x).name` 这种写法是安全的。
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {}
}

/**
 * `unknown → 数组`。不是数组 → `[]`（**字符串也不算数组**，不会退化成字符遍历）。
 *
 * `T` 是**调用方期望**的元素类型：本函数只保证「它是数组」，不校验元素形状，
 * 元素要再过一层 `asRecord` / `asText` / `asTextList`。
 */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * `unknown → 可渲染的文本`。
 *
 * - 字符串 → 原样返回（**不 trim**，是否去掉空白由调用方决定）；
 * - number / bigint → `String(v)`（数字是真信息，别丢）；
 * - boolean / null / undefined / 数组 / 对象 / 函数 / symbol → `''`
 *   （选 `''` 而不是 `String(v)`：布尔不是简历内容，渲染出 "true" 是噪音；
 *   而对象走 `String(v)` 会得到 `[object Object]`，绝对不许出现在页面上）。
 */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return ''
}

/**
 * `unknown → 字符串列表`（技能、教育亮点这种「一行一项」的字段）。
 *
 * - 数组 → 逐个看：**只收真的字符串**，trim 后为空丢掉；数字 / null / 对象 / 嵌套数组一律过滤掉
 *   （这类元素无法判断是内容还是坏数据，宁可少显示也不把垃圾印出来）；
 * - 单个非空字符串 → `[去掉首尾空白的它]`
 *   （旧数据把列表写成一句话，很常见；不这样处理会把整句丢掉）；
 * - 其余 → `[]`。
 */
export function asTextList(value: unknown): string[] {
  if (typeof value === 'string') {
    const single = value.trim()
    return single ? [single] : []
  }
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (text) out.push(text)
  }
  return out
}

/**
 * `unknown → 多行文本`（自我评价这种「一段话」的字段）。
 * 字符串原样；字符串数组按换行拼；对象取 text/content 这类常见键；其余 `''`。
 */
export function asParagraph(value: unknown): string {
  const direct = asText(value)
  if (direct.trim()) return direct
  const lines = asTextList(value)
  if (lines.length) return lines.join('\n')
  const record = asRecord(value)
  return asText(record.text) || asText(record.content) || asText(record.value)
}

/**
 * `unknown → 对象数组`（一条条经历）。
 *
 * - 数组 → 元素是对象就原样留下；元素是**字符串**就包成 `{ [textKey]: 字符串 }`；
 *   数字 / null / 嵌套数组丢掉；
 * - **单个对象** → `[该对象]`。这就是本轮那个坑的正面处理：旧结构
 *   `education` 是 `{school, major, detail}` 单个对象，不是数组，
 *   如果按数组遍历（`.every` / `.map`）会直接抛 `is not a function`；
 * - 单个字符串 → `[{ [textKey]: 字符串 }]`；
 * - 其余 → `[]`。
 *
 * 为什么字符串是**包成一条**而不是跳过：旧结构里 `projects: "有一个游戏创作比赛的项目"`
 * 是用户真写过的东西，跳过就等于把他的话删了；包成「只有名称的一条」既不丢内容，
 * 也不假装它有 STAR 四段（其余字段是空字符串，展示态会把空段隐藏）。
 * `textKey` 是「这条经历最像名字的那个字段」：项目/校园用 `name`，教育用 `school`。
 */
export function asRowList(value: unknown, textKey = 'name'): Record<string, unknown>[] {
  const items: unknown[] = Array.isArray(value)
    ? value
    : isPlainObject(value)
      ? [value]
      : typeof value === 'string'
        ? [value]
        : []
  const out: Record<string, unknown>[] = []
  for (const item of items) {
    if (isPlainObject(item)) {
      out.push(item)
      continue
    }
    if (typeof item === 'string' && item.trim()) out.push({ [textKey]: item.trim() })
  }
  return out
}

/* ----------------------------- 旧结构 → 新结构 ----------------------------- */

/**
 * 是不是「上传 PDF → 解析」那版旧功能存下来的结构。
 * 判据：有 `basics`（复数）而没有 `basic`（单数）。
 * 只用于给用户一句轻提示，**不影响**下面的映射与渲染。
 */
export function isLegacyResumeData(raw: unknown): boolean {
  const record = asRecord(raw)
  return Object.keys(record).length > 0 && !('basic' in record) && 'basics' in record
}

function normalizeStar(value: unknown): ResumeStar {
  const source = asRecord(value)
  // 旧数据可能把四段写成一句话（字符串）：放进「情境」，其余三段留空，不假装有内容
  const single = asText(value).trim()
  return {
    situation: asText(source.situation) || single,
    task: asText(source.task),
    action: asText(source.action),
    result: asText(source.result),
  }
}

const starHasText = (star: ResumeStar): boolean =>
  Boolean(star.situation || star.task || star.action || star.result)

const experienceIsEmpty = (item: ResumeExperienceItem): boolean =>
  Boolean(item.name || item.role || item.period) || starHasText(item.star)

function normalizeExperiences(value: unknown): ResumeExperienceItem[] {
  return asRowList(value)
    .map((row) => ({
      name: asText(row.name) || asText(row.title) || asText(row.project),
      role: asText(row.role),
      period: asText(row.period) || asText(row.time),
      star: normalizeStar(row.star),
    }))
    .filter(experienceIsEmpty)
}

function normalizeEducation(value: unknown): ResumeEducationItem[] {
  return asRowList(value, 'school')
    .map((row) => {
      const highlights = asTextList(row.highlights)
      // 旧结构的「亮点」是单个字符串字段 detail（例：detail: ""）
      if (!highlights.length) highlights.push(...asTextList(row.detail))
      return {
        school: asText(row.school),
        major: asText(row.major),
        period: asText(row.period) || asText(row.time),
        highlights,
      }
    })
    .filter(
      (item) =>
        Boolean(item.school || item.major || item.period) || item.highlights.length > 0,
    )
}

/**
 * `任意 parsed_data → 新结构 ResumeData`，**永不抛异常**。
 *
 * 这是「数据进门」的唯一入口：MyResumePage 拿到 GET /resume/mine、
 * POST /resume/polish、PUT /resume/mine 的 parsed_data 后先过它一次，
 * 预填表单和展示态都用收敛后的结果。
 *
 * 旧结构尽力映射（选 (a) 而不是「忽略旧数据」）：
 * - `basics.name → basic.name`；
 * - `basics.gender` / `basics.sex → basic.gender`；
 * - `basics.phone` / `basics.email → basic.contact`（" · " 拼起来）；
 * - `education` **对象 → 单条数组**；`education.detail → highlights`；
 * - `projects` / `skills` **字符串 → 各一条 / 一项**；
 * - 认不出来的字段（旧结构里没有对应位置的）自然丢掉 —— 展示不出错，用户自己补。
 */
export function normalizeResumeData(raw: unknown): ResumeData {
  const source = asRecord(raw)
  const basic = asRecord(source.basic)
  /** 旧结构的 basics（复数） */
  const legacy = asRecord(source.basics)
  const target = asRecord(source.target)

  const legacyContact = [asText(legacy.phone), asText(legacy.email)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ')

  return {
    basic: {
      name: asText(basic.name) || asText(legacy.name),
      gender: asText(basic.gender) || asText(legacy.gender) || asText(legacy.sex),
      grade: asText(basic.grade) || asText(legacy.grade),
      major: asText(basic.major) || asText(legacy.major),
      school: asText(basic.school) || asText(legacy.school),
      contact: asText(basic.contact).trim() || legacyContact,
    },
    target: {
      direction: asText(target.direction),
      city: asText(target.city),
    },
    education: normalizeEducation(source.education),
    skills: asTextList(source.skills),
    projects: normalizeExperiences(source.projects),
    campus: normalizeExperiences(source.campus ?? source.experiences),
    self_evaluation: asParagraph(source.self_evaluation) || asParagraph(source.summary),
  }
}
