/**
 * 埋点上报 —— 对齐后端 app/api/v1/events.py（prefix="/events"）
 *
 *   POST /events   单条或批量；后端**只写结构化日志，不持久化**
 *
 * ⚠️ 这是后端**后补实现**的模块（手册 10.2 未列）。
 * 入参两种形状都接受：
 *   { event, payload, client_ts }
 *   { events: [{ event, payload, client_ts }] }
 * 事件名不做白名单，未知事件名也照收。
 *
 * 埋点是 fire-and-forget：任何失败都静默，不能影响主流程。
 */

import { post } from '@/api/client'
import type { TrackEventName } from '@/types'
import { registerTracker } from '@/utils/track'

function send(event: TrackEventName, payload?: Record<string, unknown>): void {
  void post<null>('/events', {
    event,
    payload: payload ?? {},
    client_ts: new Date().toISOString(),
  }).catch(() => {
    /* 埋点失败静默 */
  })
}

/** 本模块靠这条副作用注册上报实现（main.tsx 里 import '@/api/events'） */
registerTracker(send)
