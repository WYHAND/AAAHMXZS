/**
 * Electron 主进程（对应手册 9.2 主进程与渲染进程 / 9.4 托盘 / 9.5 系统通知）。
 *
 * 它做四件事：
 * 1. **拉起本机后端**（FastAPI + SQLite）：优先用随包带的后端 exe，开发时用 `backend/venv`
 *    里的解释器；已有后端在跑就不重复启动（见 `startBackendIfNeeded`）；
 * 2. 等后端 `/api/v1/health` 通了再开窗口 —— 否则用户会先看到一屏报错；
 * 3. 加载前端：开发用 `http://localhost:5173`，打包后用 `loadFile(frontend/dist/index.html)`；
 * 4. 托盘 + 系统通知；退出时只关**自己拉起来**的后端进程。
 *
 * ⚠️ 两个打包才会暴露的坑，这里都处理了：
 * - 前端必须是**相对资源路径 + hash 路由**（`vite.config.ts` 的 `base: './'` 与
 *   `router/index.tsx` 里按 `file://` 切 `createHashRouter`），否则白屏/404；
 * - spawn 后端时 **`cwd` 必须是后端目录**：`backend/.env` 是 cwd 相对读的（勘误 9.14），
 *   cwd 错了就读不到 `DEEPSEEK_API_KEY`，AI 全线走兜底。
 */

import { app, BrowserWindow, Tray, Menu, Notification, dialog, ipcMain, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** 后端端口：必须与 frontend/.env.electron 的 VITE_API_BASE 一致 */
const BACKEND_PORT = 8000
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`
const HEALTH_URL = `${BACKEND_ORIGIN}/api/v1/health`

const isDev = !app.isPackaged
const log = (...args: unknown[]) => console.log('[main]', ...args)

let win: BrowserWindow | null = null
let tray: Tray | null = null
let backend: ChildProcess | null = null
/** 只有"本进程拉起来的后端"才由本进程关闭；用户自己开着的 uvicorn 不许动 */
let spawnedByUs = false

/** 开发：仓库里的 backend/；打包：extraResources 放进 resources/backend 的那份 */
const BACKEND_DIR = isDev
  ? path.resolve(__dirname, '../../backend')
  : path.join(process.resourcesPath, 'backend')

const DEV_URL = 'http://localhost:5173'
/**
 * 打包后 index.html 在 **app.asar 里**（electron-builder.yml 的 files 把 frontend/dist
 * 映射到 asar 根的 frontend/dist）。要注意 `__dirname` 在打包后是 `app.asar/dist`：
 * - 开发：`electron/dist/` → 上两级才是仓库根的 `frontend/dist`
 * - 打包：`app.asar/dist/` → 上一级就是 asar 根的 `frontend/dist`
 * 两者相对层级不同，必须分开写（写错的表现就是启动后立刻退出，因为 loadFile 抛未处理异常）。
 */
const RENDERER_FILE = isDev
  ? path.resolve(__dirname, '../../frontend/dist/index.html')
  : path.join(__dirname, '../frontend/dist/index.html')
const ICON_PATH = path.join(__dirname, '../build/icon.ico')
const TRAY_ICON_PATH = path.join(__dirname, '../build/tray.ico')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 后端是否已经能应答（用于"别启动第二个"和"等它就绪"） */
async function isBackendUp(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(HEALTH_URL, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

function backendExecutable(): string {
  return isDev
    ? path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe')
    : path.join(BACKEND_DIR, 'aicareer-backend.exe')
}

async function startBackendIfNeeded(): Promise<void> {
  if (await isBackendUp()) {
    log(`${BACKEND_ORIGIN} 已有后端在跑，本次不再启动第二个`)
    return
  }

  const exe = backendExecutable()
  if (!fs.existsSync(exe)) {
    throw new Error(
      `找不到后端可执行文件：${exe}\n\n` +
        (isDev
          ? '开发模式请确认 backend\\venv 存在（手册 3.2）。'
          : '打包产物不完整：resources\\backend 下应有 aicareer-backend.exe。'),
    )
  }

  const args = isDev
    ? ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)]
    : []
  log('启动后端：', exe, args.join(' '))
  backend = spawn(exe, args, { cwd: BACKEND_DIR, windowsHide: true })
  spawnedByUs = true

  backend.stdout?.on('data', (d) => log('[backend]', String(d).trim()))
  backend.stderr?.on('data', (d) => log('[backend]', String(d).trim()))
  backend.on('exit', (code) => log(`后端进程退出，code=${code}`))

  // 首次启动要建表 + 灌种子（run_server.py 里做），给足 60 秒
  for (let i = 0; i < 120; i += 1) {
    if (await isBackendUp()) {
      log(`后端就绪（约 ${(i * 0.5).toFixed(1)}s）`)
      return
    }
    await sleep(500)
  }
  throw new Error(`后端 60 秒内没有就绪：${HEALTH_URL}`)
}

function stopBackend(): void {
  if (spawnedByUs && backend && !backend.killed) {
    log('关闭后端进程')
    backend.kill()
  }
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'AI就业助手',
    icon: ICON_PATH,
    backgroundColor: '#f7f4ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })

  // 外链一律走系统浏览器，别在应用窗口里打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 加载失败要说清楚是哪一步（白屏最常见的两个原因就是资源路径与路由模式）
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    dialog.showErrorBox(
      '界面加载失败',
      `地址：${url}\n错误：${desc}（${code}）\n\n` +
        '若是打包版：检查前端是否用 `npm run build:electron` 构建（需要 base:"./" 与 hash 路由）。',
    )
  })

  if (isDev) {
    await win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    await win.loadFile(RENDERER_FILE)
  }
}

function setupTray(): void {
  if (!fs.existsSync(TRAY_ICON_PATH)) {
    log('托盘图标缺失，跳过托盘：', TRAY_ICON_PATH)
    return
  }
  tray = new Tray(TRAY_ICON_PATH)
  tray.setToolTip('AI就业助手')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主界面', click: () => showMainWindow() },
      {
        label: '每日一问提醒',
        click: () => notify('每日一问', '今天聊一句？打开应用看看今天的问题。'),
      },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]),
  )
  // 双击托盘图标 = 打开主界面（Windows 习惯）
  tray.on('double-click', () => showMainWindow())
}

function showMainWindow(): void {
  if (!win) {
    void createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function notify(title: string, body: string): boolean {
  if (!Notification.isSupported()) return false
  new Notification({ title, body, icon: ICON_PATH }).show()
  return true
}

// 单实例：第二次双击时把已有窗口叫到前面，而不是开两个后端
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(async () => {
    // Windows 上系统通知要靠 AppUserModelId 才显示正确的应用名
    app.setAppUserModelId('com.example.aicareer')

    try {
      await startBackendIfNeeded()
    } catch (error) {
      dialog.showErrorBox('后端启动失败', String(error instanceof Error ? error.message : error))
    }

    await createWindow()
    setupTray()
  }).catch((error) => {
    /*
     * ⚠️ 这个 catch 是必需的：Electron 主进程里未处理的 promise rejection 会**直接结束进程**，
     * 表现就是"双击了没反应/闪一下没了"，而且没有任何提示。曾经因为打包时漏了前端 dist，
     * loadFile 抛错 → 进程静默退出，排查全靠猜。现在至少会弹一个能读的框。
     */
    dialog.showErrorBox(
      '启动失败',
      `${String(error instanceof Error ? error.stack || error.message : error)}\n\n` +
        '常见原因：打包时前端产物没进 app.asar（检查 electron-builder.yml 的 files），' +
        '或内置后端目录缺失（resources\\backend）。',
    )
    app.quit()
  })
}

app.on('window-all-closed', () => {
  // 桌面端习惯：关窗口即退出（同时会关掉我们拉起的后端）
  app.quit()
})

app.on('before-quit', () => stopBackend())

// 渲染进程通过 preload 请求弹通知（手册 9.5）
ipcMain.handle('notify', (_event, title: string, body: string) => notify(title, body))
