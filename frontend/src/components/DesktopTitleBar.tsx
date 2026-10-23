import { Maximize2, Minus, X } from 'lucide-react'

/**
 * 桌面端「无边框窗口」的最小窗口条（只在 Electron 里渲染）。
 *
 * 为什么需要它：主进程把窗口设成了 `frame: false`（见 electron/src/main.ts），
 * 系统不再画标题栏 —— 于是**没有拖拽区、没有最小化/最大化/关闭**。
 * AppLayout（登录后的主壳）自己那条 44px 窗口头就是标题栏；
 * 但登录 / 注册 / 404 / 面试进行中走的是 BlankLayout，那里没有任何窗口控件，
 * 用户会连窗口都拖不动、只能 Alt+F4。所以这里补一条 36px 的透明拖拽条。
 *
 * 样式刻意压到最轻：透明、无背景、悬停才显形，不抢登录卡片的视觉。
 */
export function DesktopTitleBar() {
  const desktop = (window as unknown as { electronAPI?: { isDesktop?: boolean; minimize?: () => void; maximize?: () => void; close?: () => void } }).electronAPI
  if (!desktop?.isDesktop) return null

  return (
    <div
      data-print="hide"
      className="app-drag fixed inset-x-0 top-0 z-50 flex h-9 items-center justify-end px-2"
    >
      <div className="app-no-drag flex items-center gap-1 rounded-lg bg-surface/60 backdrop-blur-sm">
        <button
          type="button"
          aria-label="最小化"
          onClick={() => desktop.minimize?.()}
          className="flex size-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="最大化"
          onClick={() => desktop.maximize?.()}
          className="flex size-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="关闭窗口"
          onClick={() => desktop.close?.()}
          className="flex size-7 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-error hover:text-on-error"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}

export default DesktopTitleBar
