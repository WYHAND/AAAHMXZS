/**
 * ui-contract-lint.mjs —— 前端迭代 02 契约的**机械检查**。
 *
 * 为什么要它：15 个页面由不同的人（不同模型）改，靠肉眼横向比对一定会漏。
 * 把契约里"可机械判定"的那几条写成脚本，违规自己冒出来，迭代 2/3 才有抓手。
 *
 * 判据全部来自 docs/任务书/前端迭代-02-动画与版式契约.md：
 *   1. 字号阶：禁止 text-xs / text-sm 表达层级；text-display 每页最多 1 处（一页一个主角数字）
 *   2. 浅底文字：页面里不出现 text-caption-foreground（浅底上 4.37–4.6，低于 4.5）
 *   3. 唯一主 CTA：variant="warm" 每页 ≤1，且必须配 size="lg"
 *   4. 不手搓：不写 animation: / @keyframes（语汇在 index.css）；不用 transition-all
 *   5. 不手写按钮圆角覆盖：Button 上不写 rounded-xl / rounded-lg / text-[15px]
 *
 * 用法：node tools/render-check/ui-contract-lint.mjs
 * 退出码 0 = 无违规。
 */
import { readFile } from 'node:fs/promises'

const PAGES = [
  ['测评引导', 'frontend/src/pages/test/TestIntroPage.tsx'],
  ['测评答题', 'frontend/src/pages/test/TestQuestionPage.tsx'],
  ['测评结果', 'frontend/src/pages/test/TestResultPage.tsx'],
  ['任务列表', 'frontend/src/pages/task/TaskListPage.tsx'],
  ['任务详情', 'frontend/src/pages/task/TaskDetailPage.tsx'],
  ['个人画像', 'frontend/src/pages/profile/ProfilePage.tsx'],
  ['每日一问', 'frontend/src/pages/daily/DailyPage.tsx'],
  ['我的简历', 'frontend/src/pages/resume/MyResumePage.tsx'],
  ['面试选择', 'frontend/src/pages/interview/InterviewSelectPage.tsx'],
  ['面试准备', 'frontend/src/pages/interview/InterviewPreparePage.tsx'],
  ['面试答题', 'frontend/src/pages/interview/InterviewSessionPage.tsx'],
  ['面试复盘', 'frontend/src/pages/interview/InterviewReviewPage.tsx'],
  ['成长报告', 'frontend/src/pages/report/GrowthReportPage.tsx'],
  ['登录', 'frontend/src/pages/auth/LoginPage.tsx'],
  ['注册', 'frontend/src/pages/auth/RegisterPage.tsx'],
  ['404', 'frontend/src/pages/error/NotFoundPage.tsx'],
]

const count = (text, re) => (text.match(re) ?? []).length

let violations = 0
const rows = []

for (const [label, file] of PAGES) {
  let src
  try {
    src = await readFile(file, 'utf8')
  } catch {
    rows.push({ label, file, issues: ['文件不存在'] })
    violations += 1
    continue
  }
  // 去掉注释再判：注释里提到这些类名不算违规
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const issues = []
  const review = []

  const xs = count(code, /\btext-xs\b/g)
  if (xs) issues.push(`text-xs ×${xs}`)
  const sm = count(code, /\btext-sm\b/g)
  if (sm) issues.push(`text-sm ×${sm}`)
  const disp = count(code, /\btext-display(-xl)?\b/g)
  if (disp > 1) issues.push(`text-display 超过 1 处 ×${disp}`)

  const keyframes = count(code, /@keyframes|animation:/g)
  if (keyframes) issues.push(`手写 animation/@keyframes ×${keyframes}`)

  const btnRadius = count(code, /<(Button)[^>]*\brounded-(xl|lg)\b/g)
  if (btnRadius) issues.push(`Button 上手写圆角 ×${btnRadius}`)
  const btnText15 = count(code, /<(Button)[^>]*text-\[15px\]/g)
  if (btnText15) issues.push(`Button 上手写 15px ×${btnText15}`)

  // —— 以下属"需要人看"的一类：条件合法，但必须逐条确认 ——
  const cap = count(code, /\btext-caption-foreground\b/g)
  if (cap) review.push(`caption-foreground ×${cap}（确认都在白底上）`)
  const mg = count(code, /\btext-muted-foreground\b/g)
  if (mg) review.push(`text-muted-foreground ×${mg}（确认非大面积）`)
  const warm = count(code, /variant="warm"/g)
  if (warm > 1) review.push(`variant="warm" ×${warm}（确认不同分支，不同屏出现）`)
  const ta = count(code, /\btransition-all\b/g)
  if (ta) review.push(`transition-all ×${ta}`)

  const reveals = count(code, /<Reveal/g)
  rows.push({ label, file, issues, review, reveals })
  violations += issues.length
}

const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - String(s).length))
console.log('【硬违规】（必须改）')
console.log(pad('页面', 10) + pad('Reveal', 8) + '结果')
console.log('-'.repeat(70))
for (const r of rows) {
  console.log(pad(r.label, 10) + pad(r.reveals ?? '-', 8) + (r.issues.length ? '✗ ' + r.issues.join(' / ') : '✓'))
}
console.log('-'.repeat(70))
console.log('【待复核】（条件合法，但逐条看一眼）')
console.log('-'.repeat(70))
for (const r of rows) {
  if (r.review?.length) console.log(pad(r.label, 10) + r.review.join(' / '))
}
console.log('-'.repeat(70))
console.log(`硬违规 ${violations} 条；待复核 ${rows.reduce((n, r) => n + (r.review?.length ?? 0), 0)} 条（页面 ${PAGES.length} 个）`)
process.exit(violations ? 1 : 0)
