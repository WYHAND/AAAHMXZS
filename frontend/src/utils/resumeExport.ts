/**
 * 简历导出 PDF
 *
 * 两条路，按运行环境自动选：
 * - **桌面端（Electron）**：主进程 `webContents.printToPDF()` 按 `styles/print.css`
 *   渲染出矢量 PDF，弹系统「另存为」并直接落盘 —— 点一下就能拿到文件；
 * - **浏览器（docker / nginx 部署）**：渲染进程没有落盘能力，退回系统打印窗口，
 *   用户在窗口里选「另存为 PDF」。
 *
 * 导出的永远是**屏幕上这一份**（`.resume-sheet` 的打印形态由 print.css 决定），
 * 不依赖是否保存过：所见即所得。
 *
 * ⚠️ 这里只负责"怎么导出"，不负责"导出什么" —— 是否为空、按钮是否可点由页面判断。
 */

/** 主进程 `resume:export-pdf` 的返回（见 electron/src/main.ts） */
export interface PdfExportResult {
  canceled: boolean
  /** 已经写盘的文件绝对路径（成功时） */
  filePath?: string
  /** 失败原因（保存对话框取消时没有这个字段） */
  error?: string
}

/** preload 暴露的桌面能力（只取导出要用的两项，避免和别处的桥类型互相牵连） */
interface DesktopExportBridge {
  isDesktop?: boolean
  exportResumePdf?: (options: { fileName: string }) => Promise<PdfExportResult>
}

function desktopBridge(): DesktopExportBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { electronAPI?: DesktopExportBridge }).electronAPI
}

/** 当前环境能不能直接把 PDF 落到磁盘（浏览器里不能，只能走打印窗口） */
export function canSavePdf(): boolean {
  const bridge = desktopBridge()
  return bridge?.isDesktop === true && typeof bridge.exportResumePdf === 'function'
}

/**
 * 默认文件名：`{姓名}-简历-{YYYY-MM-DD}.pdf`。
 *
 * 姓名里可能有 Windows 不允许出现在文件名里的字符（/ \ : * ? " < > |），统一抹掉；
 * 没填姓名时退回「我的简历」，不生成一个以「-简历」开头的怪文件名。
 */
export function resumePdfFileName(name: string, date = new Date()): string {
  const safe = name.replace(/[\\/:*?"<>|\r\n\t]/g, '').trim().slice(0, 40)
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${safe || '我的简历'}-简历-${day}.pdf`
}

/**
 * 桌面端一键导出。
 *
 * 返回 `null` 表示**当前环境没有这个能力**（浏览器），调用方应退回 `window.print()`；
 * 返回结果里 `canceled=true` 是用户自己取消了保存，不是失败。
 */
export async function saveResumePdf(name: string): Promise<PdfExportResult | null> {
  const bridge = desktopBridge()
  if (!canSavePdf() || !bridge?.exportResumePdf) return null
  return bridge.exportResumePdf({ fileName: resumePdfFileName(name) })
}
