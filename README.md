# 高校学生AI就业辅助系统（AAA鸿蒙就业小助手）

以「AI 主动挖掘」为核心特色的高校学生全周期就业辅助系统。面向大一至大四学生，通过结构化测试与多场景无感采集建立动态画像，由 AI 主动识别职业痛点、能力盲区与兴趣倾向，提供职业探索引导、简历优化、面试模拟与成长任务陪伴。

**当前状态：骨架搭建中**（前端骨架 + 后端骨架，尚未联调）

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + TypeScript 6 + Vite 8 + Tailwind CSS v4 + shadcn/ui + Zustand + React Router v7 + axios + Recharts |
| 后端 | Python 3.12+ + FastAPI + SQLModel + PostgreSQL + APScheduler |
| AI | DeepSeek API（httpx 直连，SSE 流式，Pydantic 结构化输出） |
| 桌面端 | Electron（M3 阶段包壳） |
| 部署 | Docker Compose + Nginx + Uvicorn |

> 与《开发手册 V1.0》的偏差：UI 层由 Ant Design 改为 **shadcn/ui**；主色由蓝紫 `#6366f1` 改为**克制蓝 `#4E6D92`**，底色为浅米黄 `#FAF7EE`。手册 2.1 / 8.5 待同步修订。

---

## 目录结构

```
.
├── docs/                       # 文档（手册、前端设计说明书）
├── frontend/                   # React Web（M1/M2 主战场，Electron 在 M3 包壳）
├── backend/                    # FastAPI 服务
├── docker-compose.yml          # 三容器编排（db / app / nginx）
├── nginx.conf
└── README.md
```

---

## 文档索引

| 文档 | 说明 |
|---|---|
| `docs/高校学生AI就业辅助系统-开发手册.md` | 开发手册 V1.0：项目概述、技术栈、环境、数据库、后端/AI/前端规范、部署 |
| `docs/前端设计说明书-高校学生AI就业辅助系统.md` | 前端设计 V1.2：路由与守卫、页面线框、store 划分、API 层、shadcn 主题与暖色调色板 |

---

## 快速开始

### 一键脚本（推荐，Windows PowerShell）

仓库根目录有三个 `.ps1`：

| 脚本 | 作用 |
|---|---|
| `setup-backend.ps1` | 建 venv + 装 Python 依赖（幂等，已存在则跳过） |
| `dev-backend.ps1` | 建表灌种子 + 起 uvicorn（http://localhost:8000，接口文档 `/docs`） |
| `dev-frontend.ps1` | 装依赖（缺失时）+ 起 Vite（http://localhost:5173） |

直接运行，或在 PowerShell 里 `.\dev-backend.ps1`。若提示脚本被禁止执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\dev-backend.ps1
```

**为什么要包一层**：本机 Node 与 Python 是后来才装的，**在安装之前打开的终端里 `npm` / `python` 找不到**（PATH 是会话启动时的快照）。脚本内显式补 PATH 并用绝对路径调用解释器，绕开这个问题。直接开一个新终端也可以。

> **维护注意**：这三个 `.ps1` 必须保存为 **UTF-8 with BOM**。Windows PowerShell 5.1 读无 BOM 的 `.ps1` 会按 ANSI（GBK）解析，中文会乱码并导致语法错误——本项目实际踩过这个坑。

### 前端（手动）

```powershell
# 若当前终端是在装 Node 之前打开的，先补 PATH：
$env:PATH = "C:\Program Files\nodejs;" + $env:PATH

cd frontend
npm install
npm run dev          # http://localhost:5173
```

dev 环境通过 Vite 代理把 `/api` 转发到 `http://localhost:8000`，因此不需要配置 CORS。

> **`vite preview` 的坑**：它默认只监听 IPv6 `[::1]`，`http://127.0.0.1:4173` **连不上**，必须用 `http://localhost:4173`。任何拿 `127.0.0.1` 探测 4173 的脚本或健康检查都会失败。

### 渲染冒烟测试（无需后端）

`tools/render-check/` 下有独立的前端渲染验证工具：用本机 Edge（`playwright-core` + `channel: 'msedge'`，**不需要下载 Chromium**）在 mock 后端的情况下逐路由渲染、截图并采集未捕获异常。见 `tools/render-check/REPORT.md`。

### 后端

**前置：本机目前没有 Python 3.12 和 PostgreSQL，依赖尚未安装。** 装好后：

```bash
cd backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # 填入 DATABASE_URL 与 DEEPSEEK_API_KEY
alembic upgrade head
uvicorn app.main:app --reload --reload-include '*.txt' --port 8000
```

API 文档：http://localhost:8000/docs

### 一键部署（M3 阶段）

```bash
docker-compose up -d
```

---

## 开发计划（里程碑）

| 里程碑 | 内容 | 验收标准 |
|---|---|---|
| M1 主闭环 | 注册登录 → 测试表 → 初始画像 → AI 对话 → 痛点诊断 → 成长任务 → 打卡 → 画像更新 | 新用户从注册到完成一个任务，画像标签与阶段会更新 |
| M2 简历 + 面试 | 简历上传/引导式生成、ATS 评分、优化报告；模拟面试 + 复盘 | 上传 PDF 能出结构化数据并在面试中被引用 |
| M3 报告 + 上线 | 成长报告、每日一问、Electron 包壳、Docker/Nginx 部署 | 服务器 `docker-compose up -d` 后外网可访问 |

---

## 待确认事项

1. **流式方案**：手册 8.4 的 `EventSource` 无法携带 `Authorization` 头 → 改为 `fetch + ReadableStream`，后端流式接口需支持 `POST + text/event-stream`。
2. **统一响应**：手册 6.2 示例直接返回 `XxxResponse`，与 6.5/10.1 的 `{code,message,data}` 冲突 → 统一按包装实现，SSE 接口除外。
3. **手册同步**：UI 组件库与主题色与手册 2.1/8.5 冲突，待修订。
4. **图表库**：暂定 Recharts（与 shadcn Chart 同源），手册原为 ECharts。
5. **包管理器**：当前用 npm；手册示例为 pnpm。

---

## 约定

- 颜色只允许语义类（`bg-primary` / `text-muted-foreground` / `bg-accent` / `bg-stage-*`），**禁止** Tailwind 默认色板类（`bg-blue-500`）。
- 一屏最多一个 `bg-primary` 实心主按钮。
- 源码文件统一 UTF-8；`.ps1` 脚本内禁止写中文（PowerShell 5.1 会按 ANSI 解析）。
