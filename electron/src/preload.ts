import { contextBridge, ipcRenderer } from 'electron'

/**
 * preload（手册 9.3）：用 contextBridge **安全地**把桌面能力暴露给渲染进程。
 *
 * 渲染进程没有 Node 权限，所以：
 * - 系统通知（手册 9.5 的"每日一问 / 任务提醒"）走 notify；
 * - 窗口是**无边框**的（main.ts 的 frame: false），系统不画最小化/最大化/关闭，
 *   AppLayout 顶部 44px 窗口头里那三个按钮的点击必须转到这里，否则点了没反应；
 * - 后端端口是 main.ts **运行时**挑的（8000 被占就换 8010…），前端构建时写死的
 *   API 地址不再可靠。main.ts 用 `webPreferences.additionalArguments` 把最终地址塞进
 *   这个进程的 argv，这里读出来交给渲染进程（`frontend/src/api/client.ts` 优先用它）。
 */

/** 与 main.ts 的 additionalArguments 前缀必须一致，改一边就要改另一边 */
const API_BASE_ARG_PREFIX = '--aicareer-api-base='

/**
 * 从 argv 里取后端地址。
 * 浏览器里没有这段逻辑；dev 下 argv 里也可能没有这一项 —— 返回 undefined，
 * 前端会照旧退回 `VITE_API_BASE` / 相对路径，行为不变。
 */
function readInjectedApiBase(): string | undefined {
  const arg = process.argv.find((value) => value.startsWith(API_BASE_ARG_PREFIX))
  if (!arg) return undefined
  const value = arg.slice(API_BASE_ARG_PREFIX.length)
  return value.length > 0 ? value : undefined
}

contextBridge.exposeInMainWorld('electronAPI', {
  /** 后端实际监听的 API 前缀（如 http://127.0.0.1:8010/api/v1）；未注入时为 undefined */
  apiBase: readInjectedApiBase(),
  /** 弹一条系统通知；返回是否真的弹出来了（Windows 上被系统静音时为 false） */
  notify: (title: string, body: string) =>
    ipcRenderer.invoke('notify', title, body) as Promise<boolean>,
  /** 是否是桌面端（前端可按需降级，例如不做浏览器打印而是调桌面打印） */
  isDesktop: true,
  /** 窗口控制：最小化 / 最大化与还原（同一个按钮 toggle）/ 关闭 */
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  /**
   * 简历导出 PDF（见 main.ts 的 `resume:export-pdf`）：
   * 主进程按 print.css 排版 → 弹系统「另存为」→ 落盘。
   * 返回 `{ canceled }` / `{ filePath }` / `{ error }`，取消不是失败。
   */
  exportResumePdf: (options: { fileName: string }) =>
    ipcRenderer.invoke('resume:export-pdf', options) as Promise<{
      canceled: boolean
      filePath?: string
      error?: string
    }>,
})
