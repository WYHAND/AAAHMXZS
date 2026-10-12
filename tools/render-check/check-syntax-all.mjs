/**
 * check-syntax-all.mjs — 把 frontend/src 下所有 ts/tsx 模块都问一遍 dev server，
 * 找出"改坏了、transform 失败"的文件（这类错误会导致整站白屏/页面崩）。
 *
 * 用法：RC_BASE_URL=http://localhost:5199 node tools/render-check/check-syntax-all.mjs
 * 退出码：有失败 = 1。
 */
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const base = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const root = path.resolve('frontend/src')

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  )

const files = walk(root).filter((f) => /\.(ts|tsx)$/.test(f))
const fails = []
let ok = 0

for (const f of files) {
  const rel = '/' + path.relative(path.resolve('frontend'), f).split(path.sep).join('/')
  try {
    const res = await fetch(base + rel)
    if (res.ok) {
      ok++
      continue
    }
    const body = await res.text()
    const m = body.match(/\[PARSE_ERROR\][^\\]*/) || body.match(/Transform failed[^\\]*/)
    fails.push({ rel, status: res.status, detail: (m ? m[0] : body.slice(0, 160)).replace(/\s+/g, ' ') })
  } catch (err) {
    fails.push({ rel, status: 'ERR', detail: String(err.message).slice(0, 120) })
  }
}

console.log(`模块总数 ${files.length}：OK ${ok}，失败 ${fails.length}`)
for (const f of fails) console.log(`FAIL ${f.rel}  [${f.status}]  ${f.detail}`)
process.exit(fails.length ? 1 : 0)
