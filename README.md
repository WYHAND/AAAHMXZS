# AI 就业小助手 · 高校学生 AI 就业辅助系统

> 面向大一至大四学生的全周期就业辅助系统：一次结构化测评建立初始画像，AI 在对话、任务、简历、面试与报告中持续更新画像，把「我该做什么」收敛成「今天做这一件」。

**技术栈**：React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui · FastAPI + SQLModel + SQLite/PostgreSQL · DeepSeek（SSE 流式）· Electron 桌面壳 · Docker Compose + Nginx

---

## 1. 项目状态

核心闭环已完整跑通，可在本地或 Docker 中复现：

> 注册 → 30 题职业测评 → 初始画像 → AI 职业指导对话 → 成长任务 → 打卡 → 画像更新 → 简历生成 → 模拟面试（文字/语音）→ 成长报告

| 项 | 现状 |
|---|---|
| Web 端（React SPA） | ✅ 13 个页面全部可访问，含守卫与 404 兜底 |
| 后端（FastAPI） | ✅ 统一 `{code,message,data}` 信封、SSE 流式对话、APScheduler 定时任务 |
| 数据库 | ✅ 默认 SQLite（零安装）；PostgreSQL 可切换（`--profile postgres`） |
| AI 能力 | ✅ DeepSeek 流式对话 + 结构化输出；无 Key 时自动走兜底话术，不阻塞演示 |
| 语音面试 | ✅ 阿里云百炼 ASR/TTS；未配置 Key 时前端自动隐藏语音入口 |
| 桌面端 | ✅ Electron 可打包（构建产物不入库） |
| 自动化测试 | ⚠️ 尚未补齐（当前为手工冒烟清单，见 §6.3） |
| 数据库迁移 | ⚠️ 建表走 `create_all`，Alembic 版本脚本待补（见 §9） |

---

## 2. 它解决什么问题

高校就业指导的现实是「一对多」：一次讲座覆盖几百人，测评报告看完就忘，简历和面试得不到及时反馈。学生真正缺的不是信息，而是**在正确阶段做对下一件事**。

本项目的做法：

1. **先画像，再建议**：30 题测评 + 任务打卡 + 面试表现共同更新画像，AI 的建议始终引用当前画像，而不是通用鸡汤；
2. **把建议变成动作**：每条建议落到一个可执行的成长任务（含步骤、预计时长、完成标准），打卡后回写画像；
3. **闭环可验证**：简历、模拟面试、成长报告都读取同一份画像与任务数据，不存在「各页各说一套」。

---

## 3. 功能地图

| 路由 | 页面 | 能力 |
|---|---|---|
| `/login` `/register` | 登录 / 注册 | JWT 鉴权、登录态持久化、已登录自动分流 |
| `/test/intro` | 测评引导 | 说明测评用途与耗时，支持 `?retest=1` 重测 |
| `/test/question` | 测评答题 | 30 题四维度选择题，进度与离开保护 |
| `/test/result` | 测评结果 | 初始画像生成与四维解释 |
| `/` | 首页 | 阶段判断、今日行动、成长数据、快捷入口 |
| `/chat` | AI 职业指导 | SSE 流式输出、多轮上下文、画像注入、开场白与兜底 |
| `/task` `/task/:id` | 成长任务 | 任务列表、详情步骤、打卡、放弃/删除 |
| `/profile` | 个人画像 | 雷达图、标签球、阶段徽章、画像更新时间 |
| `/daily` | 每日一问 | 每日一题 + AI 反馈，沉淀到画像 |
| `/resume` | 我的简历 | 问答式逐字段生成 → AI 润色 → 打印/导出样式 |
| `/interview` | 模拟面试 | 岗位选择、准备页、文字/语音作答、复盘评分 |
| `/report` | 成长报告 | 阶段总结、能力变化、下一步建议 |
| `*` | 404 | 公开访问、统一外壳 |

---

## 4. 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19、TypeScript、Vite、Tailwind CSS v4、shadcn/ui（Radix）、Zustand、React Router v7、axios、Recharts、motion |
| 后端 | Python 3.12、FastAPI 0.115、SQLModel、Pydantic v2、APScheduler、Uvicorn |
| AI | DeepSeek API（httpx 直连；对话走 SSE，结构化任务走 JSON 模式；失败自动降级） |
| 语音 | 阿里云百炼 DashScope：`paraformer-realtime-v2`（ASR）、`cosyvoice-v3-flash`（TTS） |
| 桌面 | Electron 33（`file://` 下使用 HashRouter） |
| 部署 | Docker Compose（app + nginx，可选 PostgreSQL profile） |

---

## 5. 架构与关键约定

```text
frontend/src
  pages/        页面（只负责展示与交互）
  components/   共享构件（Panel / PageHeader / AIThinking / 图表…）
  api/          每个领域一个文件，统一走 client.ts（信封解包、401 登出）
  store/        Zustand：auth / profile / chat / interview
  router/       路由表 + 守卫（RequireAuth / RequireProfile / RedirectIfAuthed）

backend/app
  api/v1/       路由层：参数校验、鉴权依赖、响应信封
  services/     业务层：测评、画像、任务、对话、简历、面试、报告
  models/       SQLModel 表结构
  ai/           DeepSeek 客户端、prompt 模板、题库、降级话术
  core/         配置、错误码、统一响应、安全
```

关键约定（AI 生成代码时用这些约束它）：

- **分层不穿透**：路由不写业务，服务不拼 SQL，模型不带展示逻辑；
- **响应统一**：成功 `{code:0,message,data}`，业务失败 HTTP 200 + 业务码，未登录真 401；
- **内容与代码分离**：prompt 放 `ai/prompts/*.txt`，题库放 `ai/question_bank/*.json`，改内容不改代码；
- **AI 必须可失败**：外部模型超时/限流时返回兜底话术与可重试提示，页面不允许白屏；
- **前端状态单一来源**：登录态、画像、对话分别只在一个 store 中维护，页面不各存一份。

---

## 6. 10 分钟极速复现

### 6.1 前置

| 依赖 | 版本 | 说明 |
|---|---|---|
| Python | ≥ 3.12 | 后端与建表脚本 |
| Node.js | ≥ 20.19（建议 22 LTS） | Vite 8 要求 |
| Git | 任意较新版本 | 克隆仓库 |
| Docker Desktop | 可选 | 只想跑容器时使用 |

以下命令以 **Windows PowerShell** 为例；macOS/Linux 把 `.\venv\Scripts\python.exe` 换成 `./venv/bin/python` 即可。

### 6.2 路径 A：本地运行（推荐，首次约 5–8 分钟，之后 < 1 分钟）

```powershell
# 0) 克隆
git clone https://github.com/WYHAND/AAAHMXZS.git
cd AAAHMXZS

# 1) 后端：虚拟环境 + 依赖
cd backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt

# 2) 环境变量（默认值即可跑；有 Key 体验更完整）
Copy-Item .env.example .env
#    按需填写 SECRET_KEY、DEEPSEEK_API_KEY、DASHSCOPE_API_KEY

# 3) 建表 + 灌入 30 道测评题（幂等，可重复执行）
.\venv\Scripts\python.exe -m app.db.init_db

# 4) 启动后端
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-include "*.txt" --host 0.0.0.0 --port 8000
```

新开一个终端：

```powershell
cd frontend
npm install
npm run dev        # http://localhost:5173
```

打开 <http://localhost:5173>，注册一个账号 → 完成 30 题测评（约 3 分钟）→ 进入首页即看到画像与今日任务。

服务地址：

- 前端：<http://localhost:5173>（Vite 代理 `/api` → `http://127.0.0.1:8000`，无需配 CORS）
- 后端接口文档：<http://localhost:8000/docs>
- 健康检查：<http://localhost:8000/api/v1/health>

### 6.3 路径 B：Docker Compose（约 5 分钟，需 Docker）

> ⚠️ 当前 compose 只编排 `app + nginx`，**前端需要先构建**，否则 nginx 打开的是占位页。

```powershell
# 1) 仓库根目录：compose 读取的是根目录 .env（不是 backend/.env）
Copy-Item backend\.env.example .env

# 2) 构建前端静态文件（nginx 挂载 ./frontend/dist）
cd frontend
npm install
npm run build
cd ..

# 3) 启动
docker compose up -d
docker compose logs -f app     # 看到建表完成 + Uvicorn running 即可
```

打开 <http://localhost>（80 端口）。想用 PostgreSQL：

```powershell
docker compose --profile postgres up -d
# 并把 .env 中 DATABASE_URL 改为 postgresql://ai_user:your_password@db:5432/ai_career
```

### 6.4 验收清单（照着点一遍即可）

- [ ] `GET /api/v1/health` 返回 `{"code":0,...}`
- [ ] 注册 → 测评 30 题 → 结果页出现四维画像
- [ ] 首页显示阶段、今日任务、画像数据
- [ ] `/chat` 发送消息，回复**逐字流式**出现，刷新后历史仍在
- [ ] 任务打卡后，`/profile` 的画像标签/分数发生变化
- [ ] `/resume` 问答式生成一份简历并可打印
- [ ] `/interview` 完成一次文字面试并进入复盘页
- [ ] `/report` 展示成长报告

---

## 7. 环境变量

本地开发读取 `backend/.env`；Docker Compose 读取**仓库根目录** `.env`。两个文件都已被 `.gitignore` 忽略，仓库中只保留 `backend/.env.example`。

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | 否 | `sqlite:///./data/app.db` | 切换 PostgreSQL 只改这一行 |
| `SECRET_KEY` | 生产必填 | 示例值 | JWT 签名密钥；生产环境必须替换为随机串 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 否 | 1440 | 登录有效期 |
| `DEEPSEEK_API_KEY` | 否 | 空 | 为空时 AI 走兜底话术，功能不中断 |
| `DEEPSEEK_MODEL` | 否 | `deepseek-flash` | 全项目统一一个模型 |
| `DASHSCOPE_API_KEY` | 否 | 空 | 为空时前端隐藏语音面试入口 |
| `VOICE_PROVIDER` | 否 | `aliyun` | 语音服务商 |
| `APP_ENV` / `DEBUG` | 否 | `development` / `true` | 生产置 `production` / `false` |
| `CORS_ORIGINS` | 否 | `localhost:5173` | 前后端分离部署时按需追加 |

生成随机密钥：

```powershell
.\venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"
```

---

## 8. 目录结构

```text
.
├── frontend/                 # React SPA（页面、构件、api、store、router）
├── backend/                  # FastAPI（api / services / models / ai / core）
│   ├── app/ai/prompts/       # 对话、简历、面试的 prompt 模板
│   ├── app/ai/question_bank/ # 分岗位面试题库
│   └── .env.example          # 环境变量模板
├── electron/                 # 桌面壳（Electron 主进程与打包脚本）
├── docs/                     # 开发手册、设计说明书、设计系统、任务书、决策记录
├── tools/render-check/       # 无头浏览器渲染冒烟与截图工具
├── docker-compose.yml        # app + nginx（可选 postgres profile）
├── nginx.conf
└── README.md
```

---

## 9. 开发过程与可复现性

本项目的规格、约束与演进过程全部留在仓库里，可逐条对照：

| 材料 | 位置 | 用途 |
|---|---|---|
| 开发手册 V2.0 | `docs/高校学生AI就业辅助系统-开发手册.md` | 数据模型、接口、错误码、部署的基线规格 |
| 勘误与决策记录 | `docs/开发手册-勘误与决策记录.md` | 每次偏离手册的原因、被推翻的方案、踩过的坑 |
| 前端设计说明书 | `docs/前端设计说明书-高校学生AI就业辅助系统.md` | 路由、守卫、store 划分、API 层 |
| 设计系统 | `docs/设计系统-页面规范.md` | 颜色、字号阶、卡片与页头规范 |
| 页面任务书 T01–T13 | `docs/任务书/` | 交给 AI 的逐页施工说明（含「只改哪些文件」边界） |
| 渲染检查报告 | `tools/render-check/REPORT.md` | 逐路由渲染、截图与未捕获异常记录 |

提交约定：一个提交对应一个可独立描述的功能点或一次 AI 协作，不使用「更新」「修复一下」这类无信息量信息；涉及规格变更时同步更新决策记录。

---

## 10. 常见问题

**PowerShell 禁止执行脚本**
```powershell
powershell -ExecutionPolicy Bypass -File .\dev-backend.ps1
```
仓库内 `.ps1` 必须保存为 **UTF-8 with BOM**，否则 Windows PowerShell 5.1 会按 GBK 解析导致中文乱码。

**`npm` / `python` 找不到**
安装 Node/Python 之前打开的终端里 PATH 是旧快照，**开一个新终端**即可。

**`vite preview` 用 `127.0.0.1` 打不开**
Vite preview 默认只监听 IPv6，改用 <http://localhost:4173>。

**Docker 起来后是占位页**
没构建前端。执行 `cd frontend && npm run build`，确认 `frontend/dist/index.html` 存在后重启 nginx。

**对话没有回复，只出现兜底话术**
`DEEPSEEK_API_KEY` 未配置或额度不足，属于预期降级；填入 Key 后重启后端。

**语音入口不见了**
`DASHSCOPE_API_KEY` 为空时前端主动隐藏语音入口，文字面试不受影响。

**80/443 端口被占用**
改 `docker-compose.yml` 中 nginx 的端口映射，例如 `"8080:80"`。

---

## 11. 已知限制

1. **无自动化测试**：当前依靠 §6.4 手工冒烟清单与 `tools/render-check` 渲染检查；
2. **无 Alembic 版本脚本**：建表使用 `create_all`，适合演示与单机部署，生产迁移需补齐；
3. **SQLite 为默认库**：单机写入足够，多人并发建议切换 PostgreSQL；
4. **语音链路依赖外部服务**：ASR/TTS 不可用时只降级为文字面试；
5. **未预置演示账号**：首次使用需注册并完成测评（约 3 分钟），数据从零开始。

---

## 12. 第三方组件

界面基于 shadcn/ui（Radix UI）与 Tailwind CSS 构建，图表使用 Recharts，图标使用 lucide-react，动效使用 motion；后端基于 FastAPI、SQLModel、Pydantic。以上均为开源依赖，业务代码（测评规则、画像模型、任务闭环、prompt 编排、面试流程）为本项目原创实现。
