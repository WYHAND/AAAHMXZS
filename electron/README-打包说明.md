# 桌面端（Electron）打包·使用说明

> 对应手册 **第 9 章 Electron 桌面端**；产物是**免安装文件夹**，整个拷走就能用。
> 打包脚本、配置、图标都在这个目录里，改完前端/后端代码重跑一条命令即可重新出包。

---

## 一、怎么用（拿到 `release\win-unpacked\` 之后）

1. 把 **整个 `win-unpacked` 文件夹**复制到你想放的地方（**要有写权限**，例如桌面或 D 盘；
   别放进 `C:\Program Files`，那里普通用户写不了 —— 数据库要写在文件夹里）。
2. 双击里面的 **`AI就业助手.exe`**。
3. **首次启动会慢一点（5~20 秒）**：程序要在后台拉起内置后端 + 首次建表 + 灌种子题库，
   窗口是等后端就绪后才出现的（所以不会看到一屏报错，稍等即可）。
4. 用你已有的账号登录，或者注册一个新账号（数据存在**这个文件夹里**，跟着文件夹走）。
5. 关闭窗口 = 退出程序（内置后端也会一起关掉，任务管理器里不会留 python 进程）。
6. 托盘图标：右键有「打开主界面 / 每日一问提醒 / 退出」。

**你的数据在哪**：`win-unpacked\resources\backend\data\app.db`（SQLite 单文件）。
- 备份 = 拷走这一个文件；
- 想清空重来 = 删掉它，下次启动会自动重建并重新灌种子。

> ⚠️ 端口占用：内置后端固定用 **127.0.0.1:8000**。如果你同时开着开发用的后端
> （`dev-backend.ps1`），程序检测到已有后端在跑就**不会**再启一个 —— 于是它会连上
> **开发库**。演示时请先关掉开发后端，保证用的是程序自己那份数据。

---

## 二、怎么重新打包（改了代码之后）

```powershell
# 1) 重新打后端 exe（改了 backend/ 任何代码、prompt、.env 都要重跑）
powershell -ExecutionPolicy Bypass -File backend\build_backend.ps1

# 2) 重新出桌面端（内部会先跑前端构建 → 编译主进程 → electron-builder）
cd electron
npm install            # 只有第一次需要
npm run dist
```

产物：`electron\release\win-unpacked\`

`npm run dist` 实际做了三件事（`electron\package.json` 里可查）：
1. `npm --prefix ../frontend run build:electron` —— 前端用 **electron 模式**构建
   （读 `frontend/.env.electron`，接口地址是绝对路径 `http://127.0.0.1:8000/api/v1`；
   普通 `npm run build` 是给 Web 部署用的，**不要**拿它来打包桌面端）；
2. `tsc -p tsconfig.json` —— 把 `electron/src/*.ts` 编译到 `electron/dist/`；
3. `electron-builder --win` —— 按 `electron-builder.yml` 出免安装文件夹，
   并把 `backend\dist\aicareer-backend\` 原样拷到 `resources\backend\`。

---

## 三、交付前清掉 API Key

`backend\.env` 会随包带进去（含你的 `DEEPSEEK_API_KEY`）。要交给别人之前：

```powershell
powershell -ExecutionPolicy Bypass -File electron\scripts\交付前去掉Key.ps1
```

它只清**产物里**那一份，仓库里的 `backend\.env` 不动。清掉后 AI 走兜底话术（不崩，但质量下降）。

---

## 四、打包时才暴露的四个坑（都已处理，改代码时别踩回去）

| 坑 | 现象 | 现在的处理 |
|---|---|---|
| 前端资源绝对路径 | 双击**白屏**，控制台一堆 `file:///assets/...` 404 | `frontend/vite.config.ts` 里 `base: './'` |
| BrowserRouter + `file://` | 打开就是 **404 页**（pathname 是文件路径，路由匹配不上） | `frontend/src/router/index.tsx` 按 `window.location.protocol` 在 `file://` 下切 `createHashRouter` |
| 没有开发代理 | 页面能开但**接口全失败** | `frontend/.env.electron` 把 `VITE_API_BASE` 写成绝对地址；`electron/src/main.ts` 提前把内置后端拉起来 |
| `.env` 是 cwd 相对的 | 后端起来了但 **AI 全哑**（读不到 Key） | 主进程 spawn 时 `cwd` 设为 `resources\backend`；打包脚本把 `.env` 复制到 exe 同级（只此一份） |

另外两个**打包自身**的坑（也已在脚本里绕开，改脚本时注意）：

- **PyInstaller 看不到字符串动态导入**：入口必须 `from app.main import app` 直接导入再
  `uvicorn.run(app, ...)`；写成 `uvicorn.run("app.main:app")` 会打出**没有 fastapi** 的包。
- **`init_db()` 的 `create_tables` 默认是 `False`**（那是给 CLI 的默认值）：打包入口必须显式
  `init_db(create_tables=True)`，否则新机器上所有接口都会死在 `no such table: users`。

---

## 五、还没做的（M3 剩余部分）

手册第 9 章里这几项这次**没做**，需要时再补：

- **IPC 文件读写**（`ipc/file.ts`）—— 手册 9.6；现在简历是问答式生成、不落文件，所以暂时用不上；
- **渲染进程主动弹通知**：`preload.ts` 已经把 `window.electronAPI.notify(title, body)` 暴露好了，
  前端调一下就能用（托盘菜单里已经有一个示例）；
- **自动更新**（`electron-updater`，手册 2.2 提到）—— 比赛作品用不到；
- **安装版（NSIS）**：`electron-builder.yml` 里 `win.target` 现在只有 `dir`；
  要出安装版就加一个 `nsis`，并**别用 `portable`**（它每次解压到临时目录，
  内置后端的数据库会跟着临时目录走，看起来像"数据每次都被清空"）。
