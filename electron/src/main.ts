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
 * ⚠️ 打包/换机才会暴露的几个坑，这里都处理了：
 * - 前端必须是**相对资源路径 + hash 路由**（`vite.config.ts` 的 `base: './'` 与
 *   `router/index.tsx` 里按 `file://` 切 `createHashRouter`），否则白屏/404；
 * - spawn 后端时 **`cwd` 必须是后端目录**：`backend/.env` 是 cwd 相对读的（勘误 9.14），
 *   cwd 错了就读不到 `DEEPSEEK_API_KEY`，AI 全线走兜底；
 * - **8000 不是我们独占的**：测试机上 8000 常被别的程序抢走，所以端口改成运行时挑
 *   （`pickCandidatePorts`），挑完通过 `additionalArguments` 注入渲染进程
 *   （preload.ts → `electronAPI.apiBase` → `frontend/src/api/client.ts`）；
 * - 打包后的 GUI **没有控制台**，所以后端输出必须落盘到 `userData/backend.log`，失败对话框
 *   里直接给出端口、退出码和最后 20 行日志 —— 否则用户只能报「后端启动失败」四个字。
 */

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  dialog,
  ipcMain,
  session,
  shell,
} from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/*
 * 端口策略：优先 8000（历史版本与开发者本地的习惯），被占就顺序试 8010-8099，
 * 顺序段也满（机器上开了一堆服务）才在 20000-60000 随机撞。
 * 顺序段优于纯随机：端口可预期，用户按防火墙/抓包排查时对得上号。
 */
const PRIMARY_PORT = 8000
const FALLBACK_PORT_START = 8010
const FALLBACK_PORT_END = 8099
const RANDOM_PORT_MIN = 20000
const RANDOM_PORT_MAX = 60000
/** 随机段的尝试上限：撞不到就认输，不要无限随机下去 */
const RANDOM_PORT_TRIES = 20

/** spawn 最多尝试几次（含第一次），每次换一个候选端口；全部失败才抛最终错误 */
const MAX_SPAWN_ATTEMPTS = 3
const RETRY_INTERVAL_MS = 1000

/** 首次启动要建表 + 灌种子（run_server.py 里做），给足 180 秒 */
const READY_TIMEOUT_MS = 180_000
/** 等待期间每 5 秒写一行进度：日志里能看出是「慢」还是「卡死」 */
const READY_PROGRESS_INTERVAL_MS = 5000
/** 单次探活超时：本地回环不该慢，超过这个时间就当没应答 */
const HEALTH_TIMEOUT_MS = 1500
/** 内存里保留的日志行数，报错时直接塞进对话框 */
const LOG_TAIL_LIMIT = 20

const isDev = !app.isPackaged
const log = (...args: unknown[]) => console.log('[main]', ...args)

let win: BrowserWindow | null = null
let tray: Tray | null = null
let backend: ChildProcess | null = null
/** 只有"本进程拉起来的后端"才由本进程关闭；用户自己开着的 uvicorn 不许动 */
let spawnedByUs = false
/** 本次真正用上的端口（复用一个已在 8000 上的后端时就是 8000），渲染进程的 API 地址由它拼 */
let backendPort = PRIMARY_PORT
/** 最近一次子进程退出码，只用于失败对话框（null = 没退出或没拿到） */
let lastExitCode: number | null = null
/**
 * 本进程主动 kill 掉的子进程。
 * 换端口重试时会 kill 上一个失败的进程，它的 exit 事件不能覆盖 `lastExitCode`，
 * 否则对话框里「最后一次退出码」显示的是我们自己发 SIGTERM 的结果，反而看不出真因。
 */
const killedByUs = new WeakSet<ChildProcess>()
/** 后端日志的内存副本（最后 LOG_TAIL_LIMIT 行） */
const backendLogTail: string[] = []
let backendLogPath = ''

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

/* ------------------------------ 后端日志（落盘 + 环形缓冲） ------------------------------ */

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * backend.log 放在 `app.getPath('userData')` 下：
 * 打包后安装目录是只读的，只有这里可写，而且用户（和客服）能按路径直接找到。
 */
function backendLogFile(): string {
  if (!backendLogPath) {
    backendLogPath = path.join(app.getPath('userData'), 'backend.log')
  }
  return backendLogPath
}

/**
 * 后端输出与启动过程统一记到一处：
 * - 落盘（打包后没有控制台，不落盘就等于日志全丢）；
 * - 内存里留最后 20 行（出错时对话框里展示，用户不用去翻文件）。
 */
function backendLog(message: string): void {
  const line = `[${timestamp()}] ${message}`
  backendLogTail.push(line)
  if (backendLogTail.length > LOG_TAIL_LIMIT) backendLogTail.shift()
  log('[backend]', message)
  try {
    fs.appendFileSync(backendLogFile(), `${line}\n`, 'utf8')
  } catch {
    // 日志写不进去不该影响启动：dev 下控制台里还有一份
  }
}

/** 子进程输出按**行**拆开写日志：原始 data 块可能只有半行，直接 trim 会把两行粘一起 */
function pipeLines(stream: NodeJS.ReadableStream | null, tag: string): void {
  if (!stream) return
  let pending = ''
  stream.on('data', (chunk: Buffer | string) => {
    pending += String(chunk)
    const lines = pending.split(/\r?\n/)
    // 最后一段可能是半行，留在 pending 里等下一次 data 拼上
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) backendLog(`[${tag}] ${line.trim()}`)
    }
  })
}

/* ------------------------------ 端口探测 ------------------------------ */

/** 端口是否空闲：listen 成功即空闲，随后立刻 close（不占着） */
function probePortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => {
      server.removeAllListeners()
      resolve(false)
    })
    server.once('listening', () => {
      server.removeAllListeners()
      // 必须等 close 回调再放行：自己的监听 socket 还没释放就去 bind 同一个端口会撞上自己
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * 按「8000 → 8010-8099 → 20000-60000 随机」的顺序凑出最多 `count` 个空闲端口。
 * 不是一次性把 8010-8099 全探一遍：凑够数就停，省得每次启动白扫几十个端口。
 */
async function pickCandidatePorts(count: number): Promise<number[]> {
  const ports: number[] = []

  if (await probePortFree(PRIMARY_PORT)) {
    ports.push(PRIMARY_PORT)
  } else {
    backendLog(`端口 ${PRIMARY_PORT} 已被占用，开始找空闲端口`)
  }

  for (
    let port = FALLBACK_PORT_START;
    port <= FALLBACK_PORT_END && ports.length < count;
    port += 1
  ) {
    if (await probePortFree(port)) ports.push(port)
  }

  let tries = 0
  while (ports.length < count && tries < RANDOM_PORT_TRIES) {
    tries += 1
    const port = RANDOM_PORT_MIN + Math.floor(Math.random() * (RANDOM_PORT_MAX - RANDOM_PORT_MIN))
    if (!ports.includes(port) && (await probePortFree(port))) ports.push(port)
  }

  return ports
}

/** 指定端口上的健康检查地址 */
function healthUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/v1/health`
}

/**
 * 端口上是否有**我们自己的**后端在应答。
 *
 * 不能只看 HTTP 200：8000 上很可能坐着别的程序，它对任何路径都可能回 200。
 * 后端 `/health` 的固定应答是 `{code:0, data:{status:'ok'}}`，三个条件全中才算自己的。
 */
async function isOwnBackendUp(port: number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
    const res = await fetch(healthUrl(port), { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return false
    const body = (await res.json()) as { code?: number; data?: { status?: string } } | null
    return body?.code === 0 && body?.data?.status === 'ok'
  } catch {
    return false
  }
}

/* ------------------------------ 后端进程 ------------------------------ */

function backendExecutable(): string {
  return isDev
    ? path.join(BACKEND_DIR, 'venv', 'Scripts', 'python.exe')
    : path.join(BACKEND_DIR, 'aicareer-backend.exe')
}

function backendArgs(port: number): string[] {
  return isDev
    ? ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)]
    : []
}

/** 子进程在等待就绪期间退出了：带上退出码，让调用方/it 一眼看出是哪类死法 */
class BackendExitedError extends Error {
  readonly port: number
  readonly exitCode: number | null

  constructor(port: number, exitCode: number | null, signal: NodeJS.Signals | null) {
    super(
      exitCode === null
        ? `后端进程在等待就绪时被信号 ${signal ?? '未知'} 终止（端口 ${port}）`
        : `后端进程在等待就绪时退出（退出码 ${exitCode}，端口 ${port}）`,
    )
    this.name = 'BackendExitedError'
    this.port = port
    this.exitCode = exitCode
  }
}

/**
 * 等指定端口上的后端就绪。
 * `isCancelled` 用于「子进程已经退出」时让这个循环尽快收摊，别在后台空转 180 秒。
 */
async function waitForBackendReady(port: number, isCancelled: () => boolean): Promise<void> {
  const startedAt = Date.now()
  let nextProgressAt = READY_PROGRESS_INTERVAL_MS

  while (!isCancelled()) {
    if (await isOwnBackendUp(port)) {
      backendLog(`后端就绪：端口 ${port}，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
      return
    }

    const elapsed = Date.now() - startedAt
    if (elapsed >= READY_TIMEOUT_MS) {
      throw new Error(
        `后端 ${Math.round(READY_TIMEOUT_MS / 1000)} 秒内没有就绪：${healthUrl(port)}`,
      )
    }
    if (elapsed >= nextProgressAt) {
      backendLog(`仍在等待后端就绪：已等 ${Math.round(elapsed / 1000)}s，端口 ${port}`)
      nextProgressAt += READY_PROGRESS_INTERVAL_MS
    }
    await sleep(500)
  }
}

/**
 * 在指定端口上拉一次后端并等它就绪。
 * 任何失败（spawn 报错 / 进程退出 / 超时）都抛出来，由 `startBackendIfNeeded` 换端口重试。
 */
async function spawnBackendOnPort(exe: string, port: number): Promise<void> {
  const args = backendArgs(port)
  backendLog(`启动后端：${exe} ${args.join(' ')}（端口 ${port}）`)

  const child = spawn(exe, args, {
    // cwd 必须是后端目录：backend/.env 是 cwd 相对读的（勘误 9.14）
    cwd: BACKEND_DIR,
    windowsHide: true,
    // 后端跑哪个端口由这里决定：run_server.py 读 APP_PORT（缺省 8000）
    // PYTHONIOENCODING：Windows 上 Python 子进程默认按 GBK 写 stdout，日志落到 UTF-8 文件里
    // 会变成一串乱码（实测踩过：backend.log 里全是「姣忔棩涓€闂?」这种），强制 UTF-8 才可读。
    env: { ...process.env, APP_PORT: String(port), PYTHONIOENCODING: 'utf-8' },
  })

  backend = child
  spawnedByUs = true

  let cancelled = false
  const isCancelled = () => cancelled

  pipeLines(child.stdout, 'stdout')
  pipeLines(child.stderr, 'stderr')

  /*
   * 快速失败：子进程一退出就让等待**立刻**结束（原来是无脑轮询到 60 秒超时，
   * 明明 exe 一秒就崩了，用户还得干等一分钟才看到「启动失败」）。
   * 退出码写进错误：exe 崩溃 / 端口被抢 / 缺 DLL 在日志里长得都不一样，退出码是最快的线索。
   */
  const death = new Promise<never>((_resolve, reject) => {
    child.once('error', (error) => {
      cancelled = true
      backendLog(`后端进程启动失败：${error.message}（端口 ${port}）`)
      reject(new Error(`后端进程启动失败：${error.message}（端口 ${port}）`))
    })
    child.once('exit', (code, signal) => {
      cancelled = true
      if (killedByUs.has(child)) {
        backendLog(`后端进程被本进程关闭（端口 ${port}）`)
      } else {
        lastExitCode = code
        backendLog(`后端进程退出：code=${code ?? '-'} signal=${signal ?? '-'} 端口=${port}`)
      }
      reject(new BackendExitedError(port, code, signal))
    })
  })

  try {
    await Promise.race([waitForBackendReady(port, isCancelled), death])
  } finally {
    // 让仍在跑的探活循环在下一轮退出（超时/退出后它已经没意义了）
    cancelled = true
  }
}

function stopBackend(): void {
  if (spawnedByUs && backend && !backend.killed) {
    log('关闭后端进程')
    backendLog('关闭后端进程')
    killedByUs.add(backend)
    backend.kill()
  }
}

/**
 * 启动后端（端口自适应）。流程：
 * 1. 8000 上已经有我们自己的后端 → 直接复用（开发者手开的 uvicorn、或上次没退干净）；
 * 2. 否则按候选端口逐个 spawn + 等就绪，最多 `MAX_SPAWN_ATTEMPTS` 次，每次间隔 1 秒；
 * 3. 全部失败才抛最终错误（错误里带最后 20 行日志，见 `describeBackendFailure`）。
 */
async function startBackendIfNeeded(): Promise<void> {
  backendLog(
    `===== 后端启动开始（${isDev ? '开发' : '打包'}模式），日志：${backendLogFile()} =====`,
  )
  // 整个启动流程开始的这一次清空；换端口重试时不重置，保留上一次真正的崩溃退出码
  lastExitCode = null

  // 8000 上有自己的后端就不重复启动：dev 下这条是常态（uvicorn --reload 手动开着）
  if (await isOwnBackendUp(PRIMARY_PORT)) {
    backendPort = PRIMARY_PORT
    spawnedByUs = false
    backendLog(`127.0.0.1:${PRIMARY_PORT} 已有本应用后端在跑，直接复用，本次不再启动`)
    return
  }

  const exe = backendExecutable()
  if (!fs.existsSync(exe)) {
    const message =
      `找不到后端可执行文件：${exe}\n\n` +
      (isDev
        ? '开发模式请确认 backend\\venv 存在（手册 3.2）。'
        : '打包产物不完整：resources\\backend 下应有 aicareer-backend.exe。')
    backendLog(message)
    throw new Error(message)
  }

  const candidates = await pickCandidatePorts(MAX_SPAWN_ATTEMPTS)
  if (candidates.length === 0) {
    const message =
      `找不到可用端口：已试 8000、8010-8099，以及 20000-60000 随机段 ${RANDOM_PORT_TRIES} 次。`
    backendLog(message)
    throw new Error(message)
  }
  backendLog(`候选端口：${candidates.join(', ')}（最多尝试 ${MAX_SPAWN_ATTEMPTS} 次）`)

  let lastError: Error | null = null
  for (let index = 0; index < candidates.length; index += 1) {
    const port = candidates[index]
    backendPort = port

    if (index > 0) {
      backendLog(
        `换端口重试：第 ${index + 1}/${candidates.length} 次，${RETRY_INTERVAL_MS / 1000} 秒后开始`,
      )
      await sleep(RETRY_INTERVAL_MS)
    }

    try {
      await spawnBackendOnPort(exe, port)
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      backendLog(`端口 ${port} 启动失败：${lastError.message}`)
      // 把这一步拉起来的子进程收掉，免得它半死不活地占着端口/句柄
      stopBackend()
    }
  }

  throw lastError ?? new Error('后端启动失败：没有可用端口')
}

/**
 * 失败对话框正文。
 * 打包后没有控制台，这几乎是用户/客服唯一能拿到的一手信息，所以四样都要给：
 * 端口、最后一次退出码、backend.log 完整路径、最后 20 行日志。
 */
function describeBackendFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const tail =
    backendLogTail.length > 0
      ? backendLogTail
      : ['（内存里没有日志：后端在产出任何输出之前就失败了）']

  return [
    message,
    '',
    `端口：${backendPort}`,
    `最后一次退出码：${
      lastExitCode === null ? '未拿到（进程没有退出，或退出时没带退出码）' : String(lastExitCode)
    }`,
    `可执行文件：${backendExecutable()}`,
    `日志文件：${backendLogFile()}`,
    '',
    `最后 ${tail.length} 行日志：`,
    ...tail,
    '',
    '说明：8000 被别的程序占用时应用会自动换到 8010 起的空闲端口，不需要手动改配置；' +
      '若所有候选端口都起不来，请把 backend.log 一并反馈。',
  ].join('\n')
}

/* ------------------------------ 窗口 / 托盘 ------------------------------ */

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
    /*
     * 无边框窗口：不要系统标题栏（App 图标 + 标题 + 最小化/最大化/关闭那一行）。
     * 渲染进程自己画了一条 44px 窗口头（AppLayout 的 header，带 -webkit-app-region: drag
     * 拖拽区和最小化/最大化/关闭按钮），它现在就是这个窗口唯一的标题栏 ——
     * 否则顶上会同时叠着「系统标题栏 + 系统菜单栏 + 我们自己的窗口头」三层。
     * 三个按钮的点击走 preload 的 window:minimize / window:toggle-maximize / window:close。
     */
    frame: false,
    // 无边框窗口在 Windows 上默认仍可缩放/最小化/最大化；这里显式写一遍，
    // 免得以后有人误以为没有标题栏就该关掉这些（关掉就真的没法还原最大化了）
    resizable: true,
    minimizable: true,
    maximizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      /*
       * 端口是运行时才定的（8000 被占时可能是 8010…），前端构建时写死的 API 地址已经不可靠，
       * 所以把最终地址从这里注入：preload 从 process.argv 里读出来挂到 electronAPI.apiBase，
       * frontend/src/api/client.ts 优先用它。注意这是给 preload 看的参数，不是 Chromium 开关。
       */
      additionalArguments: [`--aicareer-api-base=http://127.0.0.1:${backendPort}/api/v1`],
    },
  })

  // 连窗口自己的菜单栏也去掉（frame: false 时本来就不显示，这里双保险，
  // 免得以后有人把 frame 打开又冒出 File/Edit/View 那一行）
  win.setMenu(null)
  win.setMenuBarVisibility(false)

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

    /*
     * 去掉 Electron 默认的应用菜单（File / Edit / View / Window / Help）。
     * 这些条目对本应用没有意义，却会占掉窗口最上面一行。
     * 代价：默认快捷键（Ctrl+R 刷新、Ctrl+Shift+I 开发者工具）一起没了；
     * 开发模式下 DevTools 仍由 openDevTools 自动打开，不受影响。
     */
    Menu.setApplicationMenu(null)

    /*
     * 麦克风权限：面试语音用 getUserMedia 录音，再由本地后端转给阿里百炼。
     * Electron 默认不会像 Chrome 那样自动弹权限框，不显式放行时
     * getUserMedia 会直接 NotAllowedError，表现就是“麦克风打不开”。
     *
     * 只放行**本应用主窗口**的 media 权限；其它窗口/权限一律拒绝。
     */
    const ses = session.defaultSession
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(permission === 'media' && webContents === win?.webContents)
    })
    ses.setPermissionCheckHandler((webContents, permission) => {
      return permission === 'media' && webContents === win?.webContents
    })

    try {
      await startBackendIfNeeded()
    } catch (error) {
      dialog.showErrorBox('后端启动失败', describeBackendFailure(error))
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

/* ------------------------------ 简历导出 PDF ------------------------------ */

/** 保存对话框里的默认文件名：去掉路径分隔符与 Windows 非法字符，并保证 .pdf 后缀 */
function resumePdfFileName(raw: unknown): string {
  const source = typeof raw === 'string' ? path.basename(raw) : ''
  const safe = source.replace(/[\\/:*?"<>|\r\n\t]/g, '').trim()
  if (!safe) return '我的简历.pdf'
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`
}

/**
 * 导出简历 PDF —— 渲染进程只负责点按钮，真正的「排版 + 落盘」在这里：
 * 1. `printToPDF` 按**打印媒体**渲染（print.css 已隐藏导航 / 按钮 / 建议块，
 *    纸张是 A4 + 12mm 页边距），所以导出的是简历本身，不是整个应用界面；
 * 2. 输出是矢量文字，可选中、可搜索、可被 ATS 解析（截图拼 PDF 做不到）；
 * 3. 先用系统「另存为」问路径，用户取消就什么都不做（不是错误）。
 */
ipcMain.handle('resume:export-pdf', async (_event, payload: { fileName?: string } = {}) => {
  if (!win) return { canceled: true }
  // 捕获当前窗口：导出过程中窗口若被关闭，也不至于把 PDF 打到 null 上
  const target = win

  try {
    const { canceled, filePath } = await dialog.showSaveDialog(target, {
      title: '导出简历 PDF',
      defaultPath: path.join(app.getPath('downloads'), resumePdfFileName(payload?.fileName)),
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      properties: ['createDirectory'],
    })
    if (canceled || !filePath) return { canceled: true }

    const pdf = await target.webContents.printToPDF({
      // print.css 的 @page 已经写了 A4 + 12mm；preferCSSPageSize 让 CSS 说了算，
      // 下面的 pageSize 只是 CSS 失效时的兜底
      pageSize: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
      landscape: false,
    })
    fs.writeFileSync(filePath, pdf)
    backendLog(`简历 PDF 已导出：${filePath}`)
    return { canceled: false, filePath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    backendLog(`简历 PDF 导出失败：${message}`)
    return { canceled: false, error: message }
  }
})

/*
 * 无边框窗口的代价：系统不再画最小化/最大化/关闭。
 * 渲染进程那条 44px 窗口头里的三个按钮通过 preload 调到这里来。
 * maximize 用 toggle：同一个按钮点第二下要还原，否则最大化后就没法变小了。
 */
ipcMain.on('window:minimize', () => win?.minimize())
ipcMain.on('window:toggle-maximize', () => {
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('window:close', () => win?.close())
