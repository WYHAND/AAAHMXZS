/**
 * check-syntax.mjs — 直接问 dev server 要某个源模块，看它能不能被转换（parse）。
 * 用法：node tools/render-check/check-syntax.mjs /src/router/index.tsx
 */
const base = process.env.RC_BASE_URL ?? 'http://localhost:5199'
const targets = process.argv.slice(2)
if (!targets.length) targets.push('/src/router/index.tsx')

for (const t of targets) {
  const url = base + t
  try {
    const res = await fetch(url)
    const body = await res.text()
    if (res.ok) {
      console.log(`OK   ${t}  (${body.length} bytes)`)
    } else {
      console.log(`FAIL ${t}  HTTP ${res.status}`)
      console.log(body.slice(0, 900))
    }
  } catch (err) {
    console.log(`ERR  ${t}  ${String(err.message)}`)
  }
}
