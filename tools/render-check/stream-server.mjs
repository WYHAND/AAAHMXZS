/**
 * stream-server.mjs — 场景 C 专用的「真流式」后端替身
 *
 * 为什么不用 page.route：page.route().fulfill() 只能一次性给出完整 body，
 * 浏览器侧一定是一次读到全部 delta，无法证明「逐字/逐块」到达。
 * 这里起一个真实 HTTP 服务（跨源 localhost:4174），把 SSE 按 delta 逐块写出去，
 * 用 http://localhost:4174/api/v1 重新构建前端后，前端通过 CORS 真实地流式读取。
 */

import { createServer } from 'node:http'

const PORT = Number(process.env.STREAM_PORT ?? 4174)
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
}

/** 需要的 fixture 很少：够 /chat 页渲染 + 守卫放行即可 */
const user = {
  id: '11111111-2222-4333-8444-555555555555',
  username: '林小满',
  school: '华中科技大学',
  major: '软件工程',
  grade: '大三',
  created_at: '2026-08-02T10:12:00+08:00',
}

const profile = {
  id: '22222222-3333-4444-8555-666666666666',
  user_id: user.id,
  clarity_score: 68,
  action_score: 54,
  resume_score: 41,
  total_score: 54,
  stage: 'prepare',
  updated_at: '2026-09-18T09:24:31+08:00',
  tested: true,
  summary: '你是个喜欢自己动手折腾的人：会写代码，也一直在琢磨技术怎么变成产品。',
  tags: [],
  user,
}

const conversation = {
  id: 'c1',
  user_id: user.id,
  title: '投了几家没回音',
  created_at: '2026-09-17T20:11:00+08:00',
  updated_at: '2026-09-18T09:24:31+08:00',
  message_count: 0,
  conclusion: null,
  followup_direction: null,
  followup_round: 0,
}

const DELTAS = [
  '你提到的「投了几家没回音」，',
  '通常不是能力问题，',
  '而是简历里的项目描述没有给出可验证的结果。',
]

const ENVELOPE = (data) => JSON.stringify({ code: 0, message: 'success', data })

function envelope(data, status = 200) {
  return { status, body: JSON.stringify({ code: 0, message: 'success', data }) }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const p = url.pathname.replace(/^\/api\/v1/, '')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  console.log(`[stream-server] ${req.method} ${p}`)

  /* ------------------------------- SSE ------------------------------- */
  if (req.method === 'POST' && /^\/chat\/conversations\/[^/]+\/stream$/.test(p)) {
    let body = ''
    for await (const chunk of req) body += chunk
    console.log(`[stream-server]   body=${body}`)

    res.writeHead(200, {
      ...CORS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    })

    const write = (event, payload) =>
      new Promise((resolve) => {
        res.write(`event: ${event}\ndata: ${payload}\n\n`, () => resolve())
      })

    await write(
      'start',
      ENVELOPE({
        type: 'start',
        conversation_id: 'c1',
        followup_round: 0,
        followup_direction: '项目经历',
      }),
    )
    await new Promise((r) => setTimeout(r, 600))

    let round = 0
    for (const delta of DELTAS) {
      round += 1
      await write(
        'delta',
        ENVELOPE({
          type: 'delta',
          content: delta,
          conversation_id: 'c1',
          followup_round: round,
          followup_direction: '项目经历',
        }),
      )
      await new Promise((r) => setTimeout(r, 700))
    }

    await write(
      'tag',
      ENVELOPE({
        type: 'tag',
        conversation_id: 'c1',
        data: {
          tags: [
            {
              id: 't1000000-0000-4000-8000-000000000009',
              user_id: user.id,
              dimension: '痛点',
              label: '简历无量化结果',
              weight: 0.77,
              source: 'chat',
              extra: null,
              updated_at: '2026-09-18T09:24:31+08:00',
            },
          ],
        },
      }),
    )

    await write(
      'done',
      ENVELOPE({
        type: 'done',
        conversation_id: 'c1',
        message_id: 'a-9001',
        followup_round: 2,
        followup_direction: '项目经历',
        conclusion_ready: true,
      }),
    )

    await write('end', '[DONE]')
    res.end()
    return
  }

  /* ---------------------------- 普通 JSON ---------------------------- */
  const routes = [
    ['GET', '/auth/me', () => user],
    ['GET', '/profile', () => profile],
    ['GET', '/chat/conversations', () => [conversation]],
    ['GET', /^\/chat\/conversations\/[^/]+\/messages$/, () => []],
    ['POST', '/chat/conversations', () => conversation],
    ['POST', '/events', () => null],
  ]

  for (const [method, matcher, fn] of routes) {
    const ok =
      req.method === method &&
      (typeof matcher === 'string' ? p === matcher : matcher.test(p))
    if (!ok) continue
    const { status, body } = envelope(fn())
    res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8' })
    return res.end(body)
  }

  console.log(`[stream-server]   UNMOCKED -> ${req.method} ${p}`)
  const { status, body } = envelope(null)
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[stream-server] listening on http://127.0.0.1:${PORT}`)
})
