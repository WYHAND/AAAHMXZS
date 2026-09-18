/**
 * 前端埋点统一入口（9 工程约定 + 4.3）
 *
 * 事件名固定为 test_skip / task_abandon / advice_ignore / daily_answer / chat_round。
 * 上报实现由 api/events.ts 注入（POST /events，后端只写结构化日志、不持久化）；
 * 未注入时静默降级为 no-op，埋点失败绝不影响业务。
 * 关键词：前端只上报事件名与必要 payload，不做画像推断。
 */

import type { TrackEventName } from '@/types'

type TrackFn = (event: TrackEventName, payload?: Record<string, unknown>) => void

let sender: TrackFn | null = null

/** 由 api/events.ts 注入上报实现，避免 utils 反向依赖 api 层 */
export function registerTracker(fn: TrackFn): void {
  sender = fn
}

export function track(
  event: TrackEventName,
  payload?: Record<string, unknown>,
): void {
  sender?.(event, payload)
}
