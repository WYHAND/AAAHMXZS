import { contextBridge, ipcRenderer } from 'electron'

/**
 * preload（手册 9.3）：用 contextBridge **安全地**把桌面能力暴露给渲染进程。
 *
 * 现在只暴露系统通知 —— 手册 9.5 的"每日一问弹窗 / 任务提醒"要在渲染进程里触发，
 * 渲染进程没有 Node 权限，必须走这里。其余能力（托盘、退出）都在主进程里，不需要暴露。
 */
contextBridge.exposeInMainWorld('electronAPI', {
  /** 弹一条系统通知；返回是否真的弹出来了（Windows 上被系统静音时为 false） */
  notify: (title: string, body: string) =>
    ipcRenderer.invoke('notify', title, body) as Promise<boolean>,
  /** 是否是桌面端（前端可按需降级，例如不做浏览器打印而是调桌面打印） */
  isDesktop: true,
})
