/**
 * fix-backticks.mjs — 一次性修：把某个源文件里**代码/注释中的反引号**去掉。
 * 为什么：JSX 的 { } 表达式里出现反引号时，oxc 会把它当模板字符串起点，
 * 报 "Expected `,` or `]` but found Identifier"，整站白屏 + Vite 错误浮层。
 * 用法：node tools/render-check/fix-backticks.mjs frontend/src/router/index.tsx
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('用法: node tools/render-check/fix-backticks.mjs <文件路径>')
  process.exit(2)
}
const src = readFileSync(file, 'utf8')
const BT = String.fromCharCode(96) // `
const lines = src.split(/\r?\n/)
let hits = 0
const out = lines.map((line, i) => {
  if (!line.includes(BT)) return line
  hits++
  console.log(`line ${i + 1}: ${line.trim().slice(0, 100)}`)
  return line.split(BT).join('')
})
writeFileSync(file, out.join('\n'), 'utf8')
console.log(hits ? `已去掉 ${hits} 行里的反引号 -> ${file}` : `没有反引号 -> ${file}`)
