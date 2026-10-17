# 《高校学生AI就业辅助系统 开发手册》

版本：V2.0  
日期：2026-09-18（V2.0 修订日期见 0.3）  
适用技术栈：FastAPI + SQLite（可切 PostgreSQL） + DeepSeek + React 19 + Electron（M3）

---

## V2.0 修订说明

本版把此前一直单独维护的《开发手册 勘误与决策记录》中**属于规格的部分**并回正文：勘误文档的第 1、4、5、6、9 节（手册内部冲突、技术选型偏差、手册遗漏、前后端集成对账、用户验收后的新决定）已逐条落到下面的对应章节，正文不再与实现分叉。勘误文档继续保留，作为「为什么这么定」的历史记录。

本版 10 条要点：

1. **技术栈按实际实现改定**（2.1 / 2.3 / 2.6 / 3.x）：React 19 + React Router v7 + TypeScript 6 + Vite 8；UI 层 **shadcn/ui（Radix）+ Tailwind CSS v4（CSS-first，无 `tailwind.config.js`）**，不再使用 Ant Design；图表库 **Recharts**，不再使用 ECharts；包管理器 **npm**，不再是 pnpm。
2. **数据库由 PostgreSQL 改为 SQLite**（2.3 / 3.4 / 3.5 / 5.1 / 5.5 / 16.2 / 16.5）：默认 `sqlite:///./data/app.db`，PostgreSQL 路径保留为生产可选项（连接串一换即切回）。
3. **UI 规范与主题定稿**（8.5）：近白画布 `#fbf9f6` + 主墨 `#091426`（标题/正文/主按钮/强调/进度条）+ 浅桃 `#ffdbca`（小面积强调底）；**全站删除琥珀色**——原 `--secondary`（琥珀 `#9b4500`）及其「AI / 强调」角色一并移除，强调改由主墨承担。替代原「主色蓝紫 `#6366f1` + 白灰辅色」，以及过渡期的「浅米黄 + 克制蓝」。
4. **奖章由 1 枚扩到 3 枚**（1.5 / 5.4 / 11.12）：`first_task` 起步行动家 / `five_steps` 坚持打卡者 / `profile_shape` 方向初现，条件必须由真实行为证据驱动。这是用户验收界面后对「砍掉奖章墙」的正式推翻。
5. **接口契约补齐**（10.2 / 10.3）：新增 `POST /chat/conversations/{id}/opening`（AI 先开口）、`DELETE /chat/conversations/{id}`、`POST /report/save`、`GET /home/summary`、`POST /events`；`GET /badge` 由裸数组改为 `{total, obtained_count, items[]}` 总览；`POST /task/generate` 增加 `reused`。（另有 `GET /resume/{id}/file`、`POST /resume/upload` 等简历端点，**已于 2026-11 随老简历链路删除**，见要点 11 与 9.17。）
6. **统一信封与错误分层定案**（6.2 / 6.5 / 6.6 / 10.1）：所有 JSON 接口统一 `{code,message,data}`（失败时 `data` 恒为 `null`）；HTTP 状态码由 `CODE_TO_HTTP_STATUS` 唯一推导，`3001` 刻意保持 200。
7. **私有资源「不存在」与「不属于你」统一 `code 2001`**（6.6 / 6.8 / 10.4）：禁止用 `1003` 区分归属，避免错误码本身成为可枚举的 oracle。
8. **SSE 流式对话改为 `POST` + `fetch/ReadableStream`**（7.2 / 8.4）：`EventSource` 既不能带 `Authorization` 头也不能带 body；事件仍是具名事件，每个事件的 `data` 是完整信封。
9. **成长报告语义**（11.10）：`GET /report` 每次实时计算、不落库；`POST /report/save` 才写里程碑快照并成为下一次 `score_delta` 的基线；无基线时不得渲染「＋0」。
10. **若干工程纪律与放宽**（7.4 / 7.7 / 8.4 / 12.2 / 13.2 / 14.5 / 16.2 / 16.4）：`POST /task/generate` 服务端按标题相似度去重；打卡区只支持点选 + ≤30 字文本，**不支持截图/上传/拍照/录屏/附件**；改 prompt 必须重启或带 `--reload-include '*.txt'`；compose 的 uploads 路径统一为 `./backend/uploads`，建表步骤写进启动命令。
11. **老简历链路整体删除**（8.1 / 10.2 / 11.8 / 13.x / 14.5）：原「上传 PDF → 解析 → ATS 评分 → 优化报告 → 下载」已整体移除，简历改为**问答式生成**——模板逐项提问 → 用户填 → 只润色不编造 → 展示/保存/打印；`resumes` 表与画像 `resume_score` 回流不变（见 9.17）。

> **Electron 桌面端（第 9 章）**：**壳与打包已落地**（2026-10，见勘误 **9.23** 与 `electron/README-打包说明.md`）——可出**免安装文件夹**、双击即用、内置后端随包走。本章原文里"仓库尚无 `electron/` 目录""全部是规划"等说法已被 9.23 覆盖；仍未做的只有 IPC 文件读写、自动更新、NSIS 安装版（清单见 9.23）。
> **不在本版范围**：对 5 条已有打卡的老任务步骤的改写已明确**不做**（保持历史打卡与新要求一致，见勘误 9.6），本手册不将它列为待办。

---

## 第0章 文档说明

### 0.1 手册目的

本手册用于指导高校学生AI就业辅助系统的开发、联调、测试与部署。目标是让开发者能够：

- 理解产品核心闭环与设计理念；
- 按照统一规范搭建开发环境；
- 按照分层架构编写后端、前端与AI集成代码；
- 按照数据库设计与API规范完成模块开发；
- 按照部署方案将系统上线运行。

### 0.2 适用读者

- 后端开发人员
- 前端开发人员
- AI集成开发人员
- 测试与运维人员
- 项目负责人

### 0.3 版本记录

| 版本 | 日期 | 修订内容 | 修订人 |
|---|---|---|---|
| V1.0 | 2026-09-18 | 初始版本，覆盖项目概述、技术栈、环境搭建、数据库、后端、AI、前端、Electron、部署等 | 项目组 |
| V2.0 | 见开篇《V2.0 修订说明》 | 并入勘误与决策记录第 1、4、5、6、9 节：技术栈改定、数据库改 SQLite、奖章扩到 3 枚、接口契约与错误码分层、SSE 改造、报告语义、任务去重等 | 项目组 |

### 0.4 相关文档索引

- 《高校学生AI就业辅助系统 需求分析文档 V2.0》
- 《数据库设计说明书》
- 《API接口文档》（FastAPI自动生成）
- 《Prompt模板全集》
- 《页面原型与路由表》
- 《高校学生AI就业辅助系统 前端设计说明书》
- 《开发手册 勘误与决策记录》——**规格部分已并入本手册 V2.0**，该文档继续作为「为什么这么定」的历史记录保留

### 0.5 术语表

| 术语 | 含义 |
|---|---|
| 画像 | 用户职业相关特征的结构化描述，包含基础属性、能力、兴趣、痛点、成长轨迹等 |
| 阶段 | 职业准备阶段，分为职业探索期、求职准备期、求职冲刺期 |
| 痛点 | AI挖掘出的用户当前核心问题，如缺乏项目经验、表达逻辑差等 |
| 任务 | 针对痛点生成的成长任务，包含步骤拆解、打卡、反馈 |
| 闭环 | 痛点诊断 → 方案推荐 → 用户选择 → 步骤拆解 → 资源支持 → 任务追踪 → 打卡反馈 → 画像更新 |
| 主动挖掘 | AI通过对话、简历、面试、每日一问等场景主动发现用户痛点与能力盲区 |
| 无感采集 | 通过轻量交互碎片化采集信息，降低用户心理负担 |

### 0.6 阅读路径建议

- 后端开发：第1、2、3、5、6、7、10、11、12、13、14、15、16章
- 前端开发：第1、2、3、4、8、9、11、15章
- AI集成：第1、2、7、11、15章
- 部署运维：第2、3、16章
- 项目负责人：第0、1、2、17章

---

## 第1章 项目概述

### 1.1 项目定位

本项目是一款以“AI主动挖掘”为核心特色的高校学生全周期就业辅助系统，面向大一至大四全阶段学生。系统通过结构化测试与多场景无感采集建立动态用户画像，由AI主动识别用户的职业痛点、能力盲区与兴趣倾向，提供个性化的职业探索引导、简历优化、面试模拟与成长任务陪伴，帮助学生从入学到毕业逐步完成职业认知与能力提升。

### 1.2 核心设计理念

- **主动挖掘，而非被动响应**：AI主动发现问题、主动引导方向，解决学生“不知道自己该干什么”的核心困境。
- **阶段分层，而非年级标签化**：按职业准备阶段匹配服务，尊重个体差异，不简单以年级定义用户。
- **无感采集，而非问卷轰炸**：通过对话、任务、面试等场景碎片化采集数据，降低用户心理负担。
- **保姆级引导，面向纯小白**：所有服务拆解到可直接执行的步骤，降低行动门槛。

### 1.3 目标用户与三阶段划分

系统不以年级为硬性划分标准，综合“职业目标清晰度、求职行动进度、简历完整度”三个维度，将用户划分为三个阶段：

| 阶段 | 典型特征 | 核心需求 | 系统推荐策略 |
|---|---|---|---|
| 职业探索期 | 无明确职业方向、无简历、对就业认知模糊、焦虑感强 | 职业启蒙、方向探索、能力规划、建立认知 | 优先推荐职业指导、每日一问、成长任务 |
| 求职准备期 | 有大致方向、开始准备简历或积累经历、技能有待提升 | 简历撰写优化、经历挖掘、能力补短板 | 优先推荐简历生成、基础面试练习、技能成长任务 |
| 求职冲刺期 | 有明确目标、有成型简历、正在投递或面试 | 简历精修、面试模拟、求职策略 | 优先推荐简历深度优化、全真模拟面试、面试复盘 |

阶段判定权重：

- 职业目标清晰度：40%
- 求职行动进度：35%
- 简历完整度：25%
- 年级辅助修正：≤10%

综合得分区间：

- 0-30分：职业探索期
- 31-65分：求职准备期
- 66-100分：求职冲刺期

### 1.4 核心功能闭环

系统核心闭环如下：

> 注册 → 基础测试表 → 初始画像 → AI职业指导对话 → 痛点诊断 → 成长任务推荐 → 步骤拆解 → 打卡反馈 → 画像更新 → 每日一问补充 → 简历生成/优化 → 模拟面试 → 面试复盘 → 画像再更新 → 下一轮对话更精准

闭环中每个环节都服务于“AI主动挖掘”与“行动闭环”两个核心卖点。

### 1.5 MVP范围与砍掉的功能

**保留的核心模块（P0）：**

1. 注册登录
2. 基础测试表（纯选择题 + 可选文字补充）
3. 用户画像与三阶段判定
4. AI职业指导对话（文字 + 流式 + 主动追问）
5. 简历生成/优化（简化版）
6. AI模拟面试（文字简化版）
7. 成长任务中心
8. 每日一问

**保留的辅助项（P1）：**

1. 简单成长报告（画像变化 + 完成任务数）
2. 对话结论卡片
3. 三枚奖章（起步行动家 / 坚持打卡者 / 方向初现）
4. 基础站内提醒

**明确砍掉或延后的功能（P2）：**

- 奖章墙（大量奖章的陈列墙与庆祝动画）——**注意：奖章本身不在此列**，「P1 只保留一枚奖章、砍掉奖章墙」已被用户验收后推翻，改为三枚，见 11.12
- 双月自动复盘、能力成长曲线、阶段跃迁时间线
- 画像衰减、人工抽检、复杂校准
- 云ASR/TTS、语音输入、语音播报
- OCR、向量数据库、LangChain、多模型路由
- Redis、Celery、对象存储
- 复杂异常流程（矛盾校验、负面情绪识别、复杂跳过策略等）

### 1.6 系统整体架构

```text
┌─────────────────────────────────────────────────────────┐
│                      客户端层                            │
│  React Web  │  Electron 桌面端  │  移动端（后期）        │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      接入层                              │
│  Nginx 反向代理 + HTTPS + 静态资源                       │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      应用层                              │
│  FastAPI + Uvicorn                                       │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────┐   │
│  │ Auth    │ Test    │ Profile │ Chat    │ Resume  │   │
│  ├─────────┼─────────┼─────────┼─────────┼─────────┤   │
│  │Interview│ Task    │ DailyQ  │ Report  │ Badge   │   │
│  ├─────────┴─────────┴─────────┴─────────┴─────────┤   │
│  │              AI Module (DeepSeek)                │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                      数据层                              │
│  SQLite（默认）│  本地磁盘（uploads/，已无文件写入）  │  APScheduler     │
│  （生产可切 PostgreSQL，连接串一换即切回）                │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                    外部服务                              │
│  DeepSeek API                                            │
└─────────────────────────────────────────────────────────┘
```

---

## 第2章 技术栈与选型说明

### 2.1 前端

| 技术 | 选型 | 说明 |
|---|---|---|
| 框架 | React 19 | 组件化、生态成熟、与Electron兼容好 |
| 语言 | TypeScript 6 | 类型安全，与后端Schema对齐。TS 6 废弃 `baseUrl`，如沿用旧写法需加 `"ignoreDeprecations": "6.0"` |
| 构建工具 | Vite 8 | 快速冷启动、HMR。`@tailwindcss/vite` 插件接入 Tailwind |
| 状态管理 | Zustand | 轻量、无样板代码 |
| UI组件库 | shadcn/ui（Radix 底座） | 组件即源码，配色/圆角/密度完全可控。产品是「陪伴型」而非中后台，不用 Ant Design |
| 样式 | Tailwind CSS v4 | 原子化CSS + CSS-first 配置（v4 无 `tailwind.config.js`，主题写在 `index.css`） |
| 图表 | Recharts | 与 shadcn Chart 同源，设计语言统一；成长曲线能力弱于 ECharts |
| 请求 | axios | 拦截器、统一错误处理（成功/失败两条路径都要解信封，见 8.3） |
| 路由 | React Router v7 | 声明式路由 + 路由守卫 |
| 提示 | sonner | 统一 toast 提示 |

> 选型纪律：**颜色只用语义类名**（`bg-primary` / `text-muted-foreground` / `bg-stage-*`），禁止 Tailwind 默认色板类（如 `bg-blue-500`）；一屏最多一个实心主按钮。

### 2.2 桌面端

| 技术 | 选型 | 说明 |
|---|---|---|
| 框架 | Electron | 复用Web前端，系统集成能力强 |
| 主进程 | Node.js + TypeScript | 与前端同语言 |
| 通信 | IPC + preload | 安全暴露系统能力 |
| 打包 | electron-builder | 三平台打包 |
| 自动更新 | electron-updater | 内置支持 |

**定位**：先做Web，Web稳定后用Electron包壳。桌面端增强能力：系统托盘、系统通知、本地文件读写、每日一问弹窗、任务提醒。

### 2.3 后端

| 技术 | 选型 | 说明 |
|---|---|---|
| 语言 | Python 3.12+ | AI生态原生 |
| 框架 | FastAPI | 异步、流式、OpenAPI、Pydantic原生 |
| 数据校验 | Pydantic v2 | 结构化输出、AI JSON校验；配置读 `.env` 用 `pydantic-settings` |
| ORM | SQLModel | SQLAlchemy + Pydantic合体，简洁 |
| 数据库 | SQLite（默认），PostgreSQL（生产可选） | 默认 `sqlite:///./data/app.db`，开箱即跑；生产换连接串即可切回 PG，代码不用改 |
| 鉴权 | JWT | python-jose + passlib |
| 定时任务 | APScheduler | 单机定时足够 |
| 文件解析 | 已移除 | 老简历链路（PDF / `.docx` 解析）已整体删除，新简历是问答式生成，不再解析任何文件（见 9.17） |
| 文件上传 | 已移除 | 老链路的文件上传端点已删除，`python-multipart` 也一并从依赖清单移除（见 9.17） |
| HTTP客户端 | httpx | 调用DeepSeek API |
| 数据库迁移 | Alembic | 开发用 `python -m app.db.init_db` 建表；迁移脚本用 Alembic（SQLite 下开 `render_as_batch`） |
| 部署 | Docker Compose + Nginx + Uvicorn | 默认两容器（app + nginx），PG 在 `postgres` profile 下可选 |

### 2.4 AI

| 技术 | 选型 | 说明 |
|---|---|---|
| 模型 | DeepSeek API | 只接一家，`deepseek-chat` |
| 调用方式 | httpx 直接调用 | 不引入LangChain，减少抽象层 |
| 流式输出 | SSE | 对话流式返回；事件具名 `start/delta/tag/pending/done/error`，`end` 收尾 |
| 结构化输出 | Pydantic + JSON Schema | 画像标签、诊断卡、面试评分等 |
| Prompt管理 | 本地模板文件（`.txt`） | 版本化管理；`load_prompt` 带 `lru_cache`，**改动后必须重启进程**（见 3.6） |
| 兜底策略 | 模板回复 + 重试 | 调用失败不报错；开场白另有专用的分档模板（见 11.4） |

### 2.5 明确不引入的依赖及原因

| 不引入 | 原因 |
|---|---|
| Redis | 无队列、无缓存刚需。JWT无状态，限流用Nginx或slowapi内存版 |
| Celery / Arq | APScheduler + BackgroundTasks足够，单机不需要分布式队列 |
| pgvector / 向量数据库 | 画像、简历、面试不需要语义检索，岗位匹配用关键词+DeepSeek |
| LangChain / LlamaIndex | 只接DeepSeek，直接SDK更轻、更可控 |
| 多模型路由 / LLM Gateway | 只考虑DeepSeek，封装一个客户端即可 |
| MinIO / OSS | 简历不再涉及文件存储：老链路的本地磁盘存文件已随链路删除，且简历体量很小（结构化 JSON 存库），更不需要对象存储 |
| PaddleOCR / OCR | 学生简历绝大多数是电子版，扫描件概率极低 |
| 云ASR/TTS | 面试语音用浏览器Web Speech API，后端零依赖（后期可加） |
| Elasticsearch / MongoDB | 单库 SQLite（生产可切 PostgreSQL）足够；扩展字段用 JSON 列承载 |
| 微服务拆分 | 模块化单体足够，FastAPI内部按模块拆router |
| 复杂监控 / 日志系统 | 标准logging + 控制台足够 |

### 2.6 最小依赖清单

**后端：**

```text
fastapi
uvicorn[standard]
pydantic
pydantic-settings        # 手册原清单遗漏；3.5/6.4 的 .env 配置必需
sqlmodel
# sqlite3 是 Python 自带，SQLite 下不需要额外驱动
# psycopg2-binary        # 可选：只有 DATABASE_URL 切回 postgresql:// 时才需要
alembic                  # 手册原清单遗漏；5.5/17.6 的迁移必需
python-jose[cryptography]
passlib[bcrypt]
bcrypt
httpx
# pdfplumber / python-docx / python-multipart   # 随老简历链路（上传 PDF/.docx 解析 + 文件上传）删除，见 9.17
apscheduler
```

**前端：**

```text
react
react-dom
typescript
vite
tailwindcss @tailwindcss/vite
zustand
radix-ui
sonner
recharts
axios
react-router-dom
```

**数据库：**

```text
SQLite（默认，零配置、零依赖）
PostgreSQL（生产可选，属于切换项而非默认项）
```

**部署：**

```text
Docker Compose
Nginx
Uvicorn
```

---

## 第3章 开发环境搭建

### 3.1 基础要求

- 操作系统：Windows 10/11、macOS 12+、Ubuntu 20.04+
- Python：3.12+
- Node.js：20 LTS+
- 数据库：**SQLite（Python 自带，无需安装，无需建库）**；生产可选 PostgreSQL 16+
- Docker：24+（可选，用于部署）
- Git：2.40+

### 3.2 Python环境

```bash
# 创建虚拟环境
python -m venv venv

# 激活
# Windows
venv\Scripts\activate
# macOS/Linux
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt
```

`requirements.txt` 内容参考第2.6节。

### 3.3 Node.js环境

```bash
# 安装依赖（本项目统一用 npm）
npm install
```

> 早期文档示例用 pnpm，实际本机只用 npm，故统一为 npm。

### 3.4 数据库（SQLite，默认）

**不需要安装、不需要建库、不需要建用户。** 库文件由应用启动或建表时自动创建：

```bash
# 建表 + 灌种子（幂等，可反复执行）
cd backend
python -m app.db.init_db

# 常用参数：--no-seed 只建表 / --drop 先删表再建（危险）
```

- 库文件位置：`backend/data/app.db`（由 `DATABASE_URL=sqlite:///./data/app.db` 决定）；
- 想看/改数据：任何 SQLite 客户端直接打开该文件即可。

**切回 PostgreSQL（生产可选）**：

```bash
# 1) 改 .env
DATABASE_URL=postgresql://ai_user:your_password@localhost:5432/ai_career
# 2) 取消 requirements.txt 里 psycopg2-binary 的注释并安装
# 3) 建表改用迁移
alembic upgrade head
```

代码侧不需要任何改动（JSON 列用 `with_variant` 同时兼容 PG 的 JSONB 与 SQLite 的 JSON）。

### 3.5 环境变量

在项目根目录或 `backend/` 下创建 `.env`：

```env
# 数据库（默认 SQLite；生产可换成 postgresql://...）
DATABASE_URL=sqlite:///./data/app.db

# JWT
SECRET_KEY=your-secret-key
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# DeepSeek
DEEPSEEK_API_KEY=sk-xxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com

# 文件存储
UPLOAD_DIR=./uploads
MAX_UPLOAD_SIZE=10485760

# 应用
APP_ENV=development
DEBUG=true
```

### 3.6 启动后端

```bash
cd backend
uvicorn app.main:app --reload --reload-include '*.txt' --host 0.0.0.0 --port 8000
```

访问 `http://localhost:8000/docs` 查看自动生成的API文档。

> **`--reload-include '*.txt'` 不是可选项**：所有 prompt 都是 `.txt`，而 `--reload` 默认只监听 `.py`；不加这个参数时改了 prompt 进程不会重启，`load_prompt` 的 `lru_cache` 会一直返回旧文本，表现为「改了 prompt 但输出没变」，很容易误判成 prompt 写得不对。手工用别的方式起 uvicorn 时，改完 prompt 请手动重启。

### 3.7 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`。dev 环境由 Vite 代理把 `/api` 转发到 `http://localhost:8000`，因此本地联调不需要配 CORS。

> `npm run preview` 默认只监听 IPv6 `[::1]`，用 `http://127.0.0.1:4173` 连不上，请用 `http://localhost:4173`。

### 3.8 启动Electron

**已落地（2026-10）**：`electron/` 目录已建好，开发模式与打包流程都能跑（详见 `electron/README-打包说明.md`、勘误 9.23）。

开发模式（需要后端自己起，或用 `dev-backend.ps1`）：

```bash
cd electron
npm install        # 只有第一次需要
npm run dev        # 编译主进程 + 启动 Electron，加载 http://localhost:5173
```

出免安装包（双击即用，内置后端）：

```bash
powershell -ExecutionPolicy Bypass -File backend\build_backend.ps1   # 先打后端 exe
cd electron && npm run dist                                          # 产物：release\win-unpacked\
```

### 3.9 Docker Compose一键启动

```bash
docker-compose up -d
```

`docker-compose.yml` 参考第16章。

### 3.10 常见问题

| 问题 | 解决 |
|---|---|
| `SQLite objects created in a thread can only be used in that same thread` | 连接参数必须带 `check_same_thread=False`（FastAPI 同步路由跑在线程池里） |
| 改了 prompt 但输出没变 | 启动加 `--reload-include '*.txt'`，或手动重启后端（`load_prompt` 有 `lru_cache`） |
| DeepSeek调用超时 | 检查网络、API Key、超时设置；AI 失败会走兜底话术而不是报错 |
| 前端跨域 | 本地用 Vite 代理；直连后端时确认后端 CORS 允许 `http://localhost:5173` |
| 数据库连接失败 | 检查 `.env` 中 `DATABASE_URL`；SQLite 需确认 `data/` 目录可写 |
| 表不存在 / 数据为空 | 先执行 `python -m app.db.init_db`（建表 + 灌种子，幂等） |

---

## 第4章 项目目录结构

### 4.1 后端目录

```text
backend/
├── app/
│   ├── main.py                 # FastAPI入口
│   ├── core/
│   │   ├── config.py           # 配置（pydantic-settings）
│   │   ├── api_response.py     # 统一信封 ApiResponse[T] / PageData[T]
│   │   ├── errors.py           # 错误码、BusinessException、CODE_TO_HTTP_STATUS
│   │   ├── security.py         # JWT、密码
│   │   └── deps.py             # 依赖注入
│   ├── models/                 # SQLModel模型
│   │   ├── user.py
│   │   ├── profile.py
│   │   ├── test.py
│   │   ├── conversation.py
│   │   ├── resume.py
│   │   ├── interview.py
│   │   ├── task.py
│   │   ├── daily_question.py
│   │   ├── report.py
│   │   ├── badge.py
│   │   └── types.py            # 跨库通用列类型（JSON/JSONB variant 等）
│   ├── schemas/                # Pydantic Schema
│   │   ├── user.py
│   │   ├── profile.py
│   │   ├── chat.py
│   │   ├── resume.py
│   │   ├── interview.py
│   │   ├── task.py
│   │   ├── home.py
│   │   ├── event.py
│   │   └── ...
│   ├── api/                    # 路由
│   │   ├── v1/
│   │   │   ├── auth.py
│   │   │   ├── test.py
│   │   │   ├── profile.py
│   │   │   ├── chat.py
│   │   │   ├── resume.py
│   │   │   ├── interview.py
│   │   │   ├── task.py
│   │   │   ├── daily_question.py
│   │   │   ├── report.py
│   │   │   ├── badge.py
│   │   │   ├── home.py         # GET /home/summary（补实现，见 10.2）
│   │   │   └── events.py       # POST /events（补实现，见 10.2）
│   │   └── router.py           # 总路由，统一前缀 /api/v1
│   ├── services/               # 业务逻辑
│   │   ├── auth_service.py
│   │   ├── profile_service.py
│   │   ├── chat_service.py
│   │   ├── resume_service.py
│   │   ├── interview_service.py
│   │   ├── task_service.py
│   │   ├── daily_question_service.py
│   │   ├── report_service.py
│   │   ├── badge_service.py
│   │   ├── home_service.py     # 首页聚合 + next_action 判定
│   │   ├── event_service.py    # 埋点只落结构化日志
│   │   └── idempotency.py      # client_msg_id 幂等
│   ├── ai/                     # AI集成
│   │   ├── deepseek_client.py
│   │   ├── schemas.py          # AI 输出模型 + 岗位关键词库
│   │   ├── fallbacks.py        # 兜底话术（含开场白三档模板）
│   │   ├── prompts/
│   │   │   ├── chat_system.txt
│   │   │   ├── chat_opening.txt        # AI 开场白（11.4）
│   │   │   ├── chat_conclusion.txt     # 结论卡片（11.11）
│   │   │   ├── profile_extract.txt
│   │   │   ├── profile_summary.txt     # 人物速写（9.24）
│   │   │   ├── resume_polish.txt
│   │   │   ├── interview_question.txt
│   │   │   ├── interview_followup.txt
│   │   │   ├── interview_review.txt
│   │   │   ├── task_generate.txt
│   │   │   └── daily_question.txt
│   │   └── parser.py           # 输出解析与校验（load_prompt 带 lru_cache）
│   ├── tasks/                  # APScheduler任务
│   │   ├── scheduler.py
│   │   ├── daily_question_job.py
│   │   ├── reminder_job.py
│   │   ├── badge_job.py
│   │   └── cleanup_job.py      # 12.2「数据清理」
│   ├── utils/
│   │   ├── file.py
│   │   ├── text.py
│   │   ├── stage.py            # 阶段 slug/label 转换（唯一出处）
│   │   ├── similarity.py       # 任务标题相似度（bigram Jaccard）
│   │   └── logger.py
│   └── db/
│       ├── session.py          # 引擎/SessionLocal（SQLite 逐连接 PRAGMA）
│       ├── init_db.py          # 建表 + 灌种子
│       └── seed_data.py        # 题库/每日一问/奖章种子
├── migrations/                 # Alembic（versions/ 目前为空，首次 autogenerate 生成）
├── scripts/                    # 一次性运维脚本（清重复任务、修老步骤等）
├── data/                       # SQLite 库文件（app.db），不入版本库
├── uploads/                    # 老链路的上传目录，仍保留但已无简历文件写入（见 13.x）
├── tests/
├── requirements.txt
└── .env
```

> **与手册 V1.0 的差异**：`layouts/`、`router/guards.tsx`、`constants/`、`lib/`、`components/ui/` 属于前端（见 4.2）；后端新增了 `utils/similarity.py`、`utils/stage.py`、`tasks/cleanup_job.py`、`services/home_service.py`、`services/event_service.py`、`services/idempotency.py`、`db/seed_data.py`、`prompts/chat_opening.txt`、`prompts/chat_conclusion.txt`、`migrations/`、`scripts/`。

### 4.2 前端目录

```text
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css               # Tailwind v4 CSS-first 主题（@theme + 设计 token）
│   ├── router/
│   │   ├── index.tsx           # 路由表
│   │   └── guards.tsx          # 登录/测评守卫
│   ├── layouts/
│   │   ├── AppLayout.tsx       # 登录后主框架（导航 + 内容区）
│   │   └── BlankLayout.tsx     # 登录/注册等无框架页
│   ├── pages/
│   │   ├── auth/               # LoginPage / RegisterPage
│   │   ├── test/               # TestIntroPage / TestQuestionPage / TestResultPage
│   │   ├── home/               # HomePage
│   │   ├── chat/               # ChatPage
│   │   ├── resume/             # MyResumePage（+ ResumePreview / resumeForm / resumeShape）
│   │   ├── interview/          # InterviewSelectPage / InterviewPreparePage / InterviewSessionPage / InterviewReviewPage
│   │   ├── task/               # TaskListPage / TaskDetailPage
│   │   ├── daily/              # DailyPage
│   │   ├── report/             # GrowthReportPage
│   │   ├── profile/            # ProfilePage
│   │   └── error/              # NotFoundPage
│   ├── components/
│   │   ├── ui/                 # shadcn/ui 组件（组件即源码）
│   │   ├── ChatBubble.tsx
│   │   ├── StepList.tsx
│   │   ├── StageBadge.tsx
│   │   ├── NextActionButton.tsx
│   │   ├── AIThinking.tsx
│   │   ├── EmptyState.tsx
│   │   ├── PageShell.tsx
│   │   └── ErrorBoundary.tsx
│   ├── store/                  # Zustand：auth / chat / profile / task / interview（简历页状态在组件内，无 resumeStore）
│   ├── api/                    # client.ts（axios + 拦截器）+ 按模块拆分的接口封装
│   │   ├── client.ts
│   │   ├── chat.ts
│   │   ├── sse.ts              # fetch + ReadableStream 消费 SSE
│   │   └── ...
│   ├── hooks/                  # useSSE / useAuth / useStage / useResponsive
│   ├── constants/              # routes / nav / stage / errorCode / interview 等常量（`resume.ts` 已随老链路删除）
│   ├── lib/                    # utils.ts（cn 等）
│   ├── types/                  # 与后端 schema 对齐的类型
│   ├── utils/                  # format / storage / list（normalizeList）/ markdown / track
│   └── styles/                 # print.css（成长报告与简历的打印样式）
├── package.json
├── vite.config.ts              # react + tailwindcss 插件、@ 别名、/api 代理
├── components.json             # shadcn/ui 配置
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
└── .env.development
```

> **没有 `tailwind.config.js`**：Tailwind v4 走 CSS-first，主题（颜色、圆角、阴影）全部写在 `src/index.css` 的 `:root` + `@theme inline` 里。

### 4.3 Electron目录

```text
electron/                       # 桌面端（2026-10 落地；用法见 README-打包说明.md）
├── src/
│   ├── main.ts                 # 主进程：拉起内置后端 + 建窗口 + 托盘 + 通知
│   └── preload.ts              # contextBridge 暴露 notify / isDesktop（手册 9.3）
├── build/
│   ├── icon.png                # 图标源图（512×512）
│   ├── icon.ico                # 应用图标（16~256 七个尺寸）
│   └── tray.ico                # 托盘图标（16/24/32）
├── scripts/
│   └── 交付前去掉Key.ps1       # 交付前一键清掉产物里的 DEEPSEEK_API_KEY
├── dist/                       # tsc 编译产物（gitignore）
├── release/                    # electron-builder 产物：win-unpacked\（gitignore）
├── package.json
├── tsconfig.json
├── electron-builder.yml
└── README-打包说明.md
```

> 与手册原规划（`src/ipc/{file,notification,tray}.ts`）的差异：托盘/通知都直接写在 `main.ts` 里，
> 没有拆 `ipc/` 子目录 —— 目前只有"弹通知"一个 IPC 方法，拆文件反而绕。等真做文件读写（9.6）再拆。

---

## 第5章 数据库设计

### 5.1 设计原则

- 单库：**默认 SQLite**（生产可切 PostgreSQL），不引入额外数据库。
- 常用字段独立列，扩展字段用 JSON 列；**方言差异用 `with_variant` 处理**（PostgreSQL 走 `JSONB`，SQLite 退回通用 `JSON`），**不要在模型里散写 `JSONB`**。
- 所有表带 `created_at`、`updated_at`。
- 软删除：`deleted_at` 为空表示未删除。
- 主键统一用 UUID 或自增 BIGINT（推荐 UUID，便于分布式扩展）。
- SQLite 注意事项：连接参数需 `check_same_thread=False`；外键约束需**逐连接** `PRAGMA foreign_keys=ON`（SQLite 默认不强制外键）；Alembic 需开 `render_as_batch=True`；`DateTime(timezone=True)` 在 SQLite 下退化为字符串，不要依赖时区语义。
- JSON 列**只做整体赋值，不做就地修改**：SQLAlchemy 默认不追踪 JSON 列的内部变更，就地改（`tag.extra["x"] = ...`）flush 不出 UPDATE，会静默丢数据。

### 5.2 表清单

| 表名 | 说明 |
|---|---|
| users | 用户 |
| profiles | 画像主表 |
| profile_tags | 画像标签 |
| test_questions | 基础测试题库（种子数据落库） |
| test_results | 测试表结果 |
| conversations | 对话记录 |
| messages | 对话消息 |
| resumes | 简历 |
| interviews | 面试记录 |
| interview_questions | 面试题目与回答 |
| tasks | 成长任务 |
| task_steps | 任务步骤 |
| daily_questions | 每日一问题库 |
| daily_answers | 每日一问回答 |
| reports | 成长报告（保存的里程碑快照） |
| badges | 奖章定义 |
| user_badges | 用户奖章 |

### 5.3 核心表结构

#### users

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| username | VARCHAR(50) | 用户名/手机号/学号 |
| password_hash | VARCHAR(255) | 密码哈希 |
| school | VARCHAR(100) | 学校 |
| major | VARCHAR(100) | 专业大类 |
| grade | VARCHAR(20) | 年级 |
| created_at | TIMESTAMP | 注册时间 |
| updated_at | TIMESTAMP | 更新时间 |
| deleted_at | TIMESTAMP | 软删除 |

#### profiles

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| clarity_score | FLOAT | 职业目标清晰度 0-100 |
| action_score | FLOAT | 求职行动进度 0-100 |
| resume_score | FLOAT | 简历完整度 0-100 |
| total_score | FLOAT | 加权总分 |
| stage | VARCHAR(20) | 阶段（库内存中文：探索期/准备期/冲刺期；**接口层统一转 slug**，见 10.4） |
| updated_at | TIMESTAMP | 更新时间 |
| ai_summary | TEXT | 「我的画像」卡片顶部那句人物速写（AI 生成，落库缓存；AI 不可用时是模板句） |
| ai_summary_key | TEXT | 生成 `ai_summary` 时所用可见标签集的指纹；指纹变了才重写（见勘误 9.24.5） |

#### profile_tags

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| dimension | VARCHAR(50) | 维度：兴趣/能力/技能/痛点/焦虑/认知 |
| label | VARCHAR(100) | 标签名 |
| weight | FLOAT | 权重 0-1 |
| source | VARCHAR(50) | 来源：test/chat/resume/interview/daily/task |
| extra | JSONB / JSON | 扩展信息 |
| updated_at | TIMESTAMP | 更新时间 |

#### conversations

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| title | VARCHAR(200) | 对话标题（创建时确定，未传则服务端取 `新对话 N`） |
| conclusion | JSONB / JSON | 结论卡片 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

> 本表**没有**追问计数字段。7.7 原有的「同一方向连续追问 ≤3 轮后换维度」计数器
> （以"当前挖掘维度 + 同方向已追问轮数"两个会话级字段实现）**已整体移除**，
> 那两个字段在真实库中也已物理删除（见 7.7）。
> 注意与 11.9 面试的追问区分：那套（每题后追问 1-2 轮，字段名为 `followups` /
> `current_followup`）保留在 `interview_questions` 上，未受影响。

#### messages

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| conversation_id | UUID | 外键 |
| role | VARCHAR(20) | user/assistant/system |
| content | TEXT | 消息内容（**纯文本，不含任何幂等标记**） |
| client_msg_id | VARCHAR(64) | 客户端幂等 id（仅用户消息有值）；与 `conversation_id` 组成唯一约束。AI 开场白固定用系统保留值 `sys:opening` |
| created_at | TIMESTAMP | 创建时间 |

> **唯一约束 `UNIQUE (conversation_id, client_msg_id)` 是幂等的实现基础**：同一 `client_msg_id` 重复提交不会产生第二条用户消息，也不会再调一次 AI。并发下靠数据库唯一约束挡第二次插入，捕获冲突后回滚并回放已落库的那条。

#### resumes

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| title | VARCHAR(200) | 简历标题（仍在使用） |
| file_path | VARCHAR(500) | **老链路遗留列**（表结构未改，列还在；上传链路删除后既不写也不读，值恒为空） |
| parsed_data | JSONB / JSON | 结构化数据（仍在使用：新链路存的就是它） |
| ats_score | FLOAT | **老链路遗留列**（表结构未改，列还在；不再有 ATS 评分，既不写也不读） |
| completeness | FLOAT | 完整度 |
| target_job | VARCHAR(100) | 目标岗位 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### interviews

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| mode | VARCHAR(50) | 小测试/全真 |
| scene | VARCHAR(50) | HR/项目/技术 |
| status | VARCHAR(20) | 进行中/已完成 |
| report | JSONB / JSON | 复盘报告 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### tasks

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| title | VARCHAR(200) | 任务标题 |
| description | TEXT | 任务描述 |
| pain_point | VARCHAR(100) | 关联痛点 |
| status | VARCHAR(20) | 进行中/已完成/已放弃 |
| value_note | TEXT | 价值说明 |
| difficulty | VARCHAR(20) | 难度 |
| estimated_days | INT | 预计天数 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### task_steps

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| task_id | UUID | 外键 |
| step_order | INT | 步骤序号 |
| title | VARCHAR(200) | 步骤标题 |
| action | TEXT | 行动指引 |
| resource | VARCHAR(500) | 资源链接 |
| completed | BOOLEAN | 是否打卡 |
| feedback | TEXT | 打卡反馈 |
| completed_at | TIMESTAMP | 完成时间 |

#### daily_questions

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| dimension | VARCHAR(50) | 维度 |
| content | TEXT | 题目 |
| options | JSONB / JSON | 选项 |
| created_at | TIMESTAMP | 创建时间 |

#### daily_answers

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| question_id | UUID | 外键 |
| answer | VARCHAR(200) | 答案 |
| answered_at | TIMESTAMP | 回答时间 |

#### reports

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| type | VARCHAR(50) | 报告类型：`growth` / `conclusion` / `resume` |
| content | JSONB / JSON | 报告快照内容（成长报告 = 实时算出的字段 + `user_note` + `saved_at`） |
| created_at | TIMESTAMP | 创建（保存）时间；它同时是下一次 `score_delta` 的基线时间 |

> `reports` 只在 `POST /report/save` 时写行；`GET /report` **不落库**（见 11.10）。

#### badges

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| name | VARCHAR(100) | 奖章名 |
| condition | JSONB / JSON | 触发条件 + 展示元数据（`event`/`threshold`/`key`/`art`/`order`/`description`/`hint`/`earned_hint`） |
| created_at | TIMESTAMP | 创建时间 |

> 奖章的**唯一定义源是代码**（`badge_service.BADGE_RULES`），种子表只做投影；`key`（前端选美术用）不新增列，就存在 `condition` 这个已有 JSON 列里。

#### user_badges

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| badge_id | UUID | 外键 |
| obtained_at | TIMESTAMP | 获得时间 |

### 5.4 初始化种子数据

由 `python -m app.db.init_db` 落库（幂等，可反复执行）：

- 基础测试题：30 题，纯选择题，四维度（clarity 8 / action 8 / resume 7 / interest 7）。
- 每日一问题库：30 题，六维度各 5 题。
- 奖章：**3 枚**（起步行动家 / 坚持打卡者 / 方向初现），定义源见 11.12。

**仍以代码常量承载、不落库的两项**（属于内部参考数据，不是用户可见数据，手册 5.2 也没有对应表）：

- 成长任务模板（附录E）：`task_service.TASK_TEMPLATES`，作为 `task_generate` 的参考样例喂给模型；
- 岗位关键词库（附录F）：`ai/schemas.py::JOB_KEYWORDS`，已不再用于 ATS 评分（老链路已删），现仅被 `db/init_db.py` 打日志引用。

> 若要让这两项支持在线维护，需要新增 `task_templates` / `job_keywords` 两张表并把常量搬成种子数据（范围扩张，未做）。

### 5.5 数据库迁移

**开发（SQLite 默认路径）**：用 `python -m app.db.init_db` 建表 + 灌种子（`create_all`，幂等，不写 `alembic_version`）。

**正式 / 需要迁移管理时**用 Alembic：

```bash
alembic init migrations
alembic revision --autogenerate -m "init"
alembic upgrade head
```

- SQLite 下必须开 `render_as_batch=True`（SQLite 的 `ALTER TABLE` 能力弱）；
- `migrations/versions/` 目前为空，首次 `--autogenerate` 生成；
- **不要混用**两种方式：先 `create_all` 再 Alembic，autogenerate 会看不到表而重复建表；
- 首次迁移会带上 5.3 里补的列（`messages.client_msg_id`）与 `test_questions` 表，无需手写 `ALTER TABLE`。
  （`conversations` 的追问计数两列已随 7.7 的功能一起移除，不参与迁移。）

---

## 第6章 后端开发规范

### 6.1 分层架构

```text
api/router → service → model/repository
```

- **router**：接收请求、参数校验、调用service、返回响应。
- **service**：业务逻辑、事务、AI调用、画像更新。
- **model**：SQLModel 数据库模型。
- **schema**：Pydantic 请求/响应模型。

### 6.2 路由规范

- 统一前缀 `/api/v1`
- 使用 APIRouter 按模块拆分
- 路由函数只做参数校验和调用service

示例：

```python
@router.post("/chat", response_model=ApiResponse[ChatResponse])
async def chat(
    req: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ChatResponse]:
    return ApiResponse.ok(await chat_service.chat(db, current_user, req))
```

> **注意 `response_model` 必须写 `ApiResponse[XxxResponse]`**，不能裸写 `XxxResponse`：前者既统一包了信封，`/docs` 里又能看到 `data` 的真实结构。

### 6.3 Schema规范

- 请求：`XxxRequest`
- 响应：`XxxResponse`
- 内部：`XxxCreate`、`XxxUpdate`
- 使用 Pydantic v2，`model_config = ConfigDict(from_attributes=True)`
- **列表类响应的 `data` 是裸数组**（`ApiResponse[List[XxxResponse]]`），当前**不做分页**；前端用 `normalizeList()` 同时兼容裸数组与 `{items}` 两种形状。等数据量上来（任务/对话历史变长）再按分页体补齐，届时手册与两端一起改。
- 入参字段一律带 `Field(description=...)`：`/docs` 是前后端唯一共同的事实来源。

### 6.4 依赖注入

- `get_db`：数据库会话
- `get_current_user`：JWT解析当前用户
- `get_settings`：配置

> **判断「用户做没做过测评」一律看 `ProfileResponse.tested`**，不要看画像对象是否存在：`GET /profile` 走 `get_or_create_profile`，永远返回一个画像对象。看对象是否存在会让「已登录 + 未测评 → /test/intro」的漏斗永不触发。
>
> **流式端点不要沿用请求级 Session**：`StreamingResponse` 的 body 在请求依赖被清理**之后**才被消费，生成器里再 `commit` 会作用在已关闭的 Session 上。生成器内部应自开 Session（只把 `user_id` 这类纯数据传进去，避免 `DetachedInstanceError`）。

### 6.5 统一响应格式

```json
// 成功
{ "code": 0, "message": "success", "data": { "id": "...", "title": "新对话 1" } }
// 失败（HTTP 状态见下表）
{ "code": 2001, "message": "资源不存在", "data": null }
```

约定：

- **所有** JSON 接口（含 `DELETE`、含 `POST /report/save`）都返回这个信封，路由上写 `response_model=ApiResponse[XxxResponse]`；
- 成功时 `data` 是业务对象，**失败时 `data` 恒为 `null`**（不是 `{}`）；
- 列表接口的 `data` 是**裸数组**；
- 裸数组/分页体两种形状前端都要能吃（见 6.3）。

错误码：

| code | 含义 | HTTP 状态 |
|---|---|---|
| 0 | 成功 | 200 |
| 1001 | 参数错误（含请求体校验失败） | 400 |
| 1002 | 未登录 | 401 |
| 1003 | 权限不足 | 403 |
| 2001 | 资源不存在（**含「存在但不属于你」**） | 404 |
| 3001 | AI调用失败 | **200**（刻意保持） |
| 5000 | 服务器内部错误 | 500 |

**这张表的 HTTP 一列由 `app/core/errors.py::CODE_TO_HTTP_STATUS` 唯一推导**：只要业务码相同，HTTP 状态就一定相同。禁止在业务代码里各自传 `status_code` —— 历史上出现过「同码不同状态」（`2001` 有时 404 有时 200、`1002` 有时 401 有时 200），前端表现为「偶发跳不过登录页」，极难排查。

`3001` 刻意保持 HTTP 200：它是「外部依赖抖动的业务结果」，前端按 `code` 提示重试即可；`1002/2001` 必须是真 401/404，否则任何标准中间件、Nginx 与前端拦截器都会失效。

### 6.6 异常处理

全局异常处理器：

```python
@app.exception_handler(BusinessException)
async def business_exception_handler(request, exc):
    return JSONResponse(
        status_code=exc.status_code or 200,   # 由 code 推导，见 6.5
        content={"code": exc.code, "message": exc.message, "data": None},
    )
```

分层规则：

| 异常 | HTTP | code |
|---|---|---|
| `BusinessException`（业务失败） | 按 `CODE_TO_HTTP_STATUS` 推导 | 业务码 |
| `RequestValidationError`（请求体校验失败） | 400 | 1001（响应体带 `data.errors` 明细） |
| `HTTPException` | 保留原始状态码 | 按 `HTTP_STATUS_TO_CODE` 映射 |
| 未捕获 `Exception` | 500 | 5000（细节只进日志，见 14.6） |

**私有资源一律用 `not_found_unless_owner()`**：「不存在」与「不属于你」返回同一个 `2001`，禁止用 `1003` 区分（理由见 6.8）。`1003` 只保留给「与资源归属无关的越权」（管理员接口、被封禁用户等），当前业务里没有这种场景。

### 6.7 日志

使用标准 logging：

```python
import logging
logger = logging.getLogger(__name__)
logger.info("...")
```

### 6.8 JWT鉴权

- 登录返回 access_token
- 前端在 Header 中携带 `Authorization: Bearer <token>`
- 后端解析 token 获取 user_id
- 未登录一律返回 **HTTP 401 + `code 1002`**；前端拦截器对 HTTP 401 与 `code === 1002` **两条路径都要触发登出**（401 可能来自中间件、1002 来自业务层）

### 6.9 模块划分

| 模块 | 路由前缀 | 说明 |
|---|---|---|
| Auth | /api/v1/auth | 注册登录 |
| Test | /api/v1/test | 测试表 |
| Profile | /api/v1/profile | 画像 |
| Chat | /api/v1/chat | 职业指导对话 |
| Resume | /api/v1/resume | 简历（模板 / 我的那一份 / 润色三条件套，见 10.2） |
| Interview | /api/v1/interview | 面试 |
| Task | /api/v1/task | 成长任务 |
| DailyQuestion | /api/v1/daily | 每日一问 |
| Report | /api/v1/report | 成长报告 |
| Badge | /api/v1/badge | 奖章 |
| Home | /api/v1/home | 首页聚合（`GET /home/summary`） |
| Events | /api/v1/events | 行为埋点上报（`POST /events`） |
| System | /api/v1/health | 探活（不带信封） |

### 6.10 私有资源归属规则（编码红线）

> 查私有资源时，「不存在」与「不属于你」必须返回**同一个**错误码 `2001`；禁止用 `1003` 区分，否则错误码本身就是可枚举的 oracle。

- 实现落点：`app/core/errors.py::not_found_unless_owner()`，所有私有资源端点都走它；
- 适用范围：`task`（`{id}` / `abandon` / `steps/{id}/complete`）、`interview`（`questions` / `answer` / `finish` / `review`）、`chat`（`conversations/{id}` 下的 `messages` / `stream` / `conclusion` / `opening`，以及 `DELETE`）；`resume` **没有**需要归属校验的 `{id}` 端点（只有 `/resume/template`、`/resume/mine`、`/resume/polish`，老链路的 `{id}` / `optimize` / `report` / `file` 已随链路删除）；
- 归属不符时**不记日志**（避免探测行为刷日志），排查时看 404 计数；
- 文件类资源还要做目录穿越校验：规范化后的路径必须仍在 `UPLOAD_DIR` 内。

### 6.11 字段口径统一：`stage` 一律 slug + label

同一个概念不允许两种编码。**全接口统一**：

- `stage` 一律为英文 slug，枚举固定 `explore` / `prepare` / `sprint`，未知值兜底 `explore`；
- 另给 `stage_label` 为中文展示名（探索期 / 准备期 / 冲刺期）；
- 转换只发生在 schema 层（`app/utils/stage.py` 是唯一出处），**不为了改接口去改存量数据编码**。

### 6.12 纪律：不要用「登记式簿记」记录渲染状态

任何「记录某个东西已经渲染过 / 已经处理过」的副本，都必须**能由渲染态本身推导出来**；推导不出来就不要存。

反面案例（真实踩过）：会话页曾用 `openingMessageIds: Map<会话, 消息id>` 记录「这条开场白已经渲染过」。因为登记发生在丢弃之前，切走时会话被永久毒化 —— 加载消息时按这个 id 把服务端真实存在的开场白过滤掉，而补开场白的逻辑又因为「已经有开场白」提前返回，AI 的提问凭空消失且不可自愈。

正确做法：参与判断的字段全是渲染态本身（例如 `messages` 里有没有 `client_msg_id === 'sys:opening'` 的消息）。同类形状的 bug 在本项目出现过三次（两次会话页、一次奖章种子），遇到「需要一个记号/缓存来记住某状态」时先按本条检查。

---

## 第7章 AI集成与Prompt工程

### 7.1 DeepSeek客户端封装

```python
# app/ai/deepseek_client.py
import httpx
from app.core.config import settings

DEEPSEEK_API_URL = f"{settings.DEEPSEEK_BASE_URL}/chat/completions"

async def chat(messages, temperature=0.7, stream=False, max_tokens=2048):
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            DEEPSEEK_API_URL,
            headers={"Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}"},
            json={
                "model": "deepseek-chat",
                "messages": messages,
                "temperature": temperature,
                "stream": stream,
                "max_tokens": max_tokens,
            },
        )
        resp.raise_for_status()
        return resp
```

### 7.2 流式输出

使用 SSE，正式端点是 **`POST`**：

```
POST /api/v1/chat/conversations/{conversation_id}/stream
Body: { "content": "...", "client_msg_id": "<uuid>" }
Response: text/event-stream
```

```python
from fastapi.responses import StreamingResponse

async def stream_chat(messages):
    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream("POST", DEEPSEEK_API_URL, ...) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:] + "\n\n"
```

**为什么不沿用 `EventSource`（GET）**：`EventSource` 既不能带 `Authorization` 头，也不能带请求体，与 6.8 的 Bearer 鉴权、与 `client_msg_id` 幂等直接冲突。因此前端用 `fetch` + `ReadableStream` 消费 `POST` 端点；`GET .../stream?content=...` 仅保留作**调试用**（curl / 手工验证），前端不调用。

事件契约（两个端点共用同一个生成器，事件序列完全一致）：

- 具名事件：`start → delta* → tag? → done → end`；异常时 `error`；幂等命中时 `pending`；
- **每个事件的 `data` 都是完整信封** `{code,message,data}`，其中 `data.type` 与 `event:` 行一致，前端任选其一派发；
- 流末尾固定 `event: end` + `data: [DONE]`；
- 响应头带 `X-Accel-Buffering: no`（否则 Nginx 下 SSE 会被攒着一起发）；
- 事件负载里的 `UUID` / `datetime` 必须显式转字符串再 `json.dumps`（`_sse_data()` + `_json_default()`）。否则异常发生在流已开始之后，只会被吞成 `event: error` + `code 5000`，日志里也没有堆栈，表现为「流式对话 100% 失败」而极难定位。

### 7.3 结构化输出

所有需要JSON的Prompt，要求DeepSeek返回JSON，并用Pydantic校验：

```python
class ProfileTag(BaseModel):
    dimension: str
    label: str
    weight: float

tag = ProfileTag.model_validate_json(content)
```

### 7.4 核心Prompt清单

| Prompt | 用途 |
|---|---|
| chat_system.txt | 职业指导对话系统提示 |
| chat_opening.txt | AI 开场白（11.4） |
| chat_conclusion.txt | 结论卡片（11.11） |
| profile_extract.txt | 从对话中抽取画像标签 |
| resume_polish.txt | 简历润色（**只改写用户填过的内容，一个字的事实都不许新增**） |
| interview_question.txt | 面试出题 |
| interview_followup.txt | 面试追问 |
| interview_review.txt | 面试评分与复盘 |
| task_generate.txt | 成长任务生成 |
| daily_question.txt | 每日一问口语化 |
| profile_summary.txt | 「我的画像」顶部那句人物速写（**只用可见标签当素材，≤45 字，不许引入标签外的事实**，见勘误 9.24） |

> **改 prompt 必须让进程重启才能生效**：`load_prompt` 带 `lru_cache`，而 `--reload` 默认只监听 `.py`。启动命令已加 `--reload-include '*.txt'`（见 3.6）；用别的方式起服务时改完 prompt 请手动重启。

### 7.5 Prompt示例：职业指导对话系统

```text
你是高校学生的AI职业指导助手，像学长学姐一样亲切。
规则：
1. 每轮用户回答后，必须回应并主动抛出下一个问题或方向。
2. 每次输出不超过300字，长内容分段。
3. 语气平等，不说教，可适当使用语气词。
4. 用户表达迷茫或焦虑时，先共情，再引导到兴趣、经历。
5. 用户拒绝回答时，立即跳过并切换话题。
6. 对话超过5轮无新信息时，主动切换挖掘维度。
7. 【不要重复提问（跨会话）】提问前在三处核对：当前对话历史、"已知画像标签"、
   以及「你在其它会话里已经问过 / 已经知道的事」区块；已问过的一律不再问，
   **换个说法也算重复**。
8. 【先问进展，再挖细节】优先确认"事情做到哪一步了"，不要泛泛地重新问兴趣/性格/专业。
9. 【绝不让用户写长文本】一次只问一个问题，用户一两句话甚至一两个词就能答完。
10. 【平时不给选项】默认是一句正常的问话，禁止 A/B/C 或 1/2/3 这类选项。
11. 【只有真的答不上来才给台阶】仅当用户明确说"不知道"或连续两轮极短内容时，
    才可以给 2-3 个具体选项当台阶，给完仍要继续往下聊。
12. 【循序渐进，先聊事再聊职业】先从具体的小事、日常聊起，
    不要一上来就谈方向、规划、职业目标。
```

> 以上为 `app/ai/prompts/chat_system.txt` 的要点摘录；**改动以文件为准**，本节不作为第二份定义源。

### 7.6 兜底策略

- DeepSeek调用失败：返回模板回复，不报错（`chat_text()` 的契约就是「不抛异常」）。
- 结构化输出解析失败：重试1次，仍失败则使用默认值。
- 用户拒绝回答：跳过，切换话题。
- 用户答不上来：给提示思路。
- **开场白有专用的分档兜底模板**（按背景丰度分三档），不能复用「中途断线」那句兜底话术 —— 它放在会话第一句非常突兀（见 11.4）。

### 7.7 对话边界控制

- **「同一方向连续追问 ≤3 轮后换维度」的追问计数器：该功能已移除。**
  原实现是在 `conversations` 表上维护两个会话级字段（"当前挖掘维度" + "同方向已追问轮数"），
  每轮从 `profile_extract` 抽出的标签里取主导 `dimension` 推进计数，满 3 轮时往 Prompt 注入
  「本轮必须换维度」的硬约束，并在 SSE 的 `start` / `delta` / `done` 事件里下发轮次。
  **现已整体删除**：模型字段、schema 字段、服务端计数逻辑、Prompt 硬约束、SSE 字段
  全部不再存在（`chat_system.txt` 里对应那条规则也已删除，其余规则重新编号保持连续）；
  真实库里的那两个字段也已物理删除。
  **前端不应再实现「追问进度 1/3」这类进度环，SSE 事件里没有这两个字段。**
- 输出≤300字：Prompt约束+后端截断。
- 过渡语模板：本地维护，随机选择。
- **面试追问另有一套上限**：`MAX_FOLLOWUP_PER_QUESTION = 2`（每题最多 1-2 轮追问，见 11.9）。
  它与上面被移除的聊天计数器**完全无关**，属于模拟面试的核心功能，保留不变。
- 开场白**禁止给选项**、**≤60 字**、一次只问一件事（见 11.4）。

### 7.8 AI数据回流画像

- 对话每轮结束后，调用 `profile_extract` 抽取标签。
- 简历润色、面试复盘、任务打卡后同样抽取。
- 标签写入 `profile_tags`，更新权重。
- 阶段判定重新计算。

---

## 第8章 前端开发规范

### 8.1 路由设计

| 路径 | 页面 | 守卫 / 布局 |
|---|---|---|
| /login | 登录 | 已登录则重定向（未测评 → `/test/intro`）；BlankLayout |
| /register | 注册 | 同上 |
| /test/intro | 测试引导 | 仅需登录（**不再套「必须已测评」**，否则与「无画像 → /test/intro」互相死循环） |
| /test/question | 测试答题 | 仅需登录 |
| /test/result | 测试结果 | 仅需登录 |
| / | 首页 | 登录 + 已测评；AppLayout |
| /chat | AI职业指导对话 | 同上 |
| /task | 任务列表 | 同上 |
| /task/:id | 任务详情 | 同上 |
| /profile | 个人中心（含奖章区） | 同上 |
| /daily | 每日一问 | 同上 |
| /resume | 问答式生成简历（单页，含填写态与展示态） | 同上 |
> 简历原有四条路由（`/resume/list`、`/resume/create`、`/resume/:id/edit`、`/resume/:id/report`）已随老链路（上传 → 解析 → ATS 评分 → 优化报告 → 下载）一并删除，现在只有上面这一行（见 9.17）；`nav.ts`、`stage.ts` 与对话页的「生成简历」入口都指向这个 `/resume`。
| /interview | 面试选择 | 同上 |
| /interview/prepare | 面试准备 | 同上 |
| /interview/review/:id | 面试复盘 | 同上 |
| /report | 成长报告 | 同上 |
| /interview/session | 面试进行 | 登录 + 已测评；**BlankLayout（全屏沉浸，无侧栏）** |
| /404、* | 未找到 | 无守卫 |

**守卫语义（三态必须分开，不能合并）**：

1. 无 token → `<Navigate to="/login">`；
2. 有 token 但画像还没拿到 → 显示「正在准备你的工作台…」；
3. **画像拉取失败 → 显示错误提示 + 重试按钮，绝不跳测评**（否则后端一次抖动就把用户踢去重做测试）；
4. 已拿到画像且 `tested === false` 且当前不在 `/test` 前缀下 → `<Navigate to="/test/intro">`。

### 8.2 状态管理

Zustand store（`src/store/`），**除 `authStore.token`（localStorage）外均不持久化**：

- `authStore`：token、user、bootstrapped、loading；并在模块初始化时把 `getToken` / `onUnauthorized` 反向注入 api 层（避免 store↔api 循环依赖）
- `chatStore`：会话列表、当前会话、消息、流式状态、追问轮次、结论卡片
- `profileStore`：画像、标签、阶段、`tested`、`nextAction`、`version`
- `taskStore` / `interviewStore`：各自的列表与当前对象（**没有 `resumeStore`**：简历只有 `/resume` 一个页面、一份数据，状态就放在页面组件内，`store/resumeStore.ts` 已随老链路删除）

**全局失效信号只有 `profileStore.version` 一个**：任何写操作成功后调 `bumpVersion()`，依赖画像的页面 `useEffect(..., [version])` 重拉。不要为每个模块各造一套刷新信号。

### 8.3 API请求封装

```typescript
// src/api/client.ts（要点摘录）
import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

export const client = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = authBridge.getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 成功路径：解信封，直接把 data 交给调用方
client.interceptors.response.use(
  (res) => {
    const payload = res.data;
    if (!isEnvelope(payload)) return payload;        // blob / 裸对象原样透传
    if (payload.code === 0) return payload.data;
    return rejectWithEnvelope(payload);
  },
  (err) => rejectWithEnvelope(err.response?.data ?? ...),
);
```

**两条路径都要解信封**（这是硬要求）：

- 成功路径按 `code` 判错 —— 覆盖 `3001` 这类「HTTP 200 但业务失败」；
- 错误路径读 `error.response.data` —— 覆盖 400/401/403/404/500 这些带信封的错误响应；
- 命中 `code === 1002`（或 HTTP 401）→ 触发登出；**登出只清 token，不做 `window.location.href` 硬跳**，跳转交给路由守卫渲染（硬跳会丢掉当前页面状态、也无法被测试）。
- `normalizeList()`：后端列表 `data` 是裸数组，前端统一收口，裸数组与 `{items}` 两种形状都吃。
- 个别调用可传 `silent: true` 抑制全局错误 toast（例如删除会话失败由页面自己提示）。

### 8.4 流式对话

使用 **`fetch` + `ReadableStream`**（不是 `EventSource`）：

```typescript
const res = await fetch(`${API_BASE}/chat/conversations/${id}/stream`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ content, client_msg_id }),
  signal,      // 支持中途停止
});
```

解析要点：

- 按 `\n\n` 分帧；逐行识别 `event:` 与 `data:`（`:` 开头的心跳行跳过）；
- 每个 `data` 都是 `{code,message,data}` 信封；派发依据 `data.type ?? event`；
- `data: [DONE]` 是流结束哨兵，**不做 JSON.parse**；
- 按事件分发：`start` / `delta`（追加文本）/ `tag` / `pending`（幂等命中，**不是错误**，不弹错误提示）/ `done` / `end`；`error` 或 `code !== 0` 才按失败处理；
- 服务端直接关连接（没有 `end`）也算正常结束；
- 失败自动重试 1 次，仍失败才落到模板兜底；
- **`conversationId` 必填**，没有"无会话也能聊"的兜底路径。

### 8.5 UI规范

- 组件库：shadcn/ui（Radix 底座），组件即源码放在 `src/components/ui/`
- 样式：Tailwind CSS v4（CSS-first，**无 `tailwind.config.js`**），主题写 `src/index.css`
- 主题：**近白画布 `#fbf9f6` + 主墨 `#091426` + 浅桃 `#ffdbca`**（完整 token 表以 `docs/设计系统-页面规范.md` 第二节为准）

| token | 值 | 用途 |
|---|---|---|
| `--background` | `#fbf9f6` | 全站画布 |
| `--foreground` | `#1b1c1a` | 正文 |
| `--primary` | `#091426` | **可点的东西 + 强调**（主按钮、链接、选中态、强调数字、进度条填充、AI 提示竖条） |
| `--accent` | `#ffdbca`（浅桃） | 小面积强调底（chip、状态点、小按钮） |
| `--stage-*` | 阶段色 | 阶段标识（取值以 `frontend/src/index.css` 为准） |
| `--medal-*` | 金色系 + 铸模中性灰 | 「我的奖章」专用，组件里只允许引用这些变量 |
| ~~`--secondary`~~ | ~~琥珀 `#9b4500`~~ | **已于 2026-10-15 删除**：强调角色移交主墨 |

- 用色纪律：**只有主墨是"动作 / 强调色"**，浅桃只做小面积点缀；颜色只允许语义类名（`bg-primary` / `text-on-surface-variant` / `bg-stage-*`），**禁止 Tailwind 默认色板类**（`bg-blue-500`）；**全站不使用琥珀色**（`text-secondary` / `bg-secondary` 不再表示琥珀）；一屏最多一个实心主按钮。
- 字体：系统默认（`PingFang SC` / `Microsoft YaHei` / `Segoe UI`），正文 14px、行高 1.6；数字用等宽（`font-numeric`）。
- 提示：sonner，4s 自动消失，顶部居中。AI 失败类提示在调用处给「重试」动作。
- **界面不允许出现英文字段名或设计术语**：所有英文枚举必须先经中文映射（例如分数维度 → 方向清晰度 / 行动力 / 简历完整度 / 综合得分；阶段 slug → 职业探索期 / 求职准备期 / 求职冲刺期；标签来源 → 职业测评 / 和 AI 对话 / 简历 / 模拟面试 / 每日一问 / 成长任务），未知值走兜底文案，**不允许把 `clarity_score`、`pain_point`、`stage` 这类字段名直接渲染给用户**。

### 8.6 表单与校验

使用 react-hook-form + zod（`@hookform/resolvers`）做表单与校验，错误文案用中文写在 schema 的 message 里。

### 8.7 图表

Recharts：成长报告的趋势/柱状图、画像维度的雷达图（简化版）。

### 8.8 错误处理

- 统一用 sonner 提示，文案中文、说人话；
- **HTTP 401 与 `code === 1002` 都要触发登出跳登录**（两条路径，见 8.3）；
- 空态、加载态、失败态三者必须分开渲染，失败态给重试入口；
- 数值型变化统一用 `formatScoreDelta()`：正数 `+N`、负数 `-N`、**0 显示 `±0`**（0 不是「涨了」，不走 `+0`）。

---

## 第9章 Electron桌面端开发

### 9.1 定位

先做Web，Web稳定后用Electron包壳。

> **当前状态**：**已落地（2026-10）** —— `electron/` 目录、开发模式、免安装包打包都已实现并真机验证过；下面 9.2~9.7 里 **9.2 / 9.4 / 9.5 / 9.7 已实现**，9.3 只暴露了 `notify`（文件读写未做），9.6 因简历改为问答式生成而暂不需要。未做项清单见勘误 **9.23**。

### 9.2 主进程与渲染进程

- 主进程：`electron/main.ts`
- 渲染进程：加载Web页面
- preload：安全暴露IPC

### 9.3 IPC

```typescript
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  notify: (title: string, body: string) => ipcRenderer.invoke('notify', title, body),
});
```

### 9.4 系统托盘

```typescript
import { Tray, Menu } from 'electron';
let tray = new Tray('icon.png');
tray.setToolTip('AI就业助手');
tray.setContextMenu(Menu.buildFromTemplate([...]));
```

### 9.5 系统通知

```typescript
new Notification({ title: '每日一问', body: '今天聊一句？' }).show();
```

### 9.6 本地文件读写

- `uploads/` 目录树与 Dockerfile 里的空目录**还在**（用于简历文件、缓存的这条用途已随老简历链路删除，现在目录是空的，不再有简历文件写入，见 13.1）。

### 9.7 打包

使用 electron-builder：

```yaml
# electron-builder.yml
appId: com.example.aicareer
productName: AI就业助手
directories:
  output: dist
win:
  target: nsis
mac:
  target: dmg
linux:
  target: AppImage
```

---

## 第10章 API接口规范

### 10.1 通用规范

- 前缀：`/api/v1`
- 请求：JSON（老链路的文件上传端点已删除，现行接口没有 `multipart/form-data`）
- 响应：`{ code, message, data }`；成功时 `data` 为业务对象，**失败时恒为 `null`**；列表接口的 `data` 为裸数组
- 鉴权：`Authorization: Bearer <token>`
- 阶段字段：一律 `stage`（slug） + `stage_label`（中文），见 6.11
- 业务错误码与 HTTP 状态的对应由 `CODE_TO_HTTP_STATUS` 唯一推导，见 6.5
- SSE 端点（`/chat/conversations/{id}/stream`）是唯一例外形态：响应体是事件流，但**每个事件的 `data` 仍是完整信封**
- `/api/v1/health` 为运维探活端点，不带信封

### 10.2 接口清单

#### Auth

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /auth/register | 注册 |
| POST | /auth/login | 登录 |
| GET | /auth/me | 当前用户 |

#### Test

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /test/questions | 获取测试题 |
| POST | /test/submit | 提交答案 |
| GET | /test/result | 获取结果（未测评时 `data: null`） |

#### Profile

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /profile | 获取画像（含 `tested`，见 6.4） |
| GET | /profile/tags | 获取标签 |
| POST | /profile/feedback | 标签反馈 |

#### Chat

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /chat/conversations | 创建对话（未传 title 取 `新对话 N`） |
| GET | /chat/conversations | 对话列表 |
| DELETE | /chat/conversations/{id} | **删除会话及其全部消息**；**不触碰画像**（见 11.4） |
| GET | /chat/conversations/{id}/messages | 消息列表（`limit` 1-500，默认 100，无分页参数） |
| POST | /chat/conversations/{id}/messages | 发送消息（非流式） |
| POST | /chat/conversations/{id}/opening | **获取/生成 AI 开场白**（幂等，见 11.4） |
| POST | /chat/conversations/{id}/stream | **SSE 流式对话（前端使用）**，body 含 `content` + `client_msg_id` |
| GET | /chat/conversations/{id}/stream?content=... | SSE 流式（**调试用，前端不调用**） |
| GET | /chat/conversations/{id}/conclusion | 结论卡片 |

#### Resume

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /resume/template | 简历模板：要问用户哪些字段（纯静态配置，不查库、不调 AI） |
| GET | /resume/mine | 我的那一份简历（**没有时 `data: null`，刻意不 404**） |
| PUT | /resume/mine | 保存我编辑的简历（不调 AI，全量覆盖 `parsed_data`） |
| POST | /resume/polish | 润色我填的简历：**只改写用户写过的内容，不新增事实**（技能栏例外：关键词展开成能力表述，见 11.8 / 9.20） |

> 原 ATS 链路的 8 条端点（`GET /resume` 列表、`POST /resume` 新建、`GET|PUT /resume/{id}`、`POST /resume/upload` 上传解析、`POST /resume/{id}/optimize`、`GET /resume/{id}/report`、`GET /resume/{id}/file` 鉴权下载）**已全部移除**（见 9.17），因此本模块现在只有固定路径、不再有 `/{resume_id}` 动态段。

#### Interview

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /interview/start | 开始面试 |
| GET | /interview/{id}/questions | 获取题目 |
| POST | /interview/{id}/answer | 提交回答（响应含 `action`，见 11.9） |
| POST | /interview/{id}/finish | 结束 |
| GET | /interview/{id}/review | 复盘报告 |

#### Task

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /task | 任务列表（可选 `status`） |
| POST | /task/generate | 生成任务；**命中同题「进行中」任务时不新建**，`data.reused = true` |
| GET | /task/{id} | 任务详情 |
| POST | /task/{id}/steps/{step_id}/complete | 打卡 |
| POST | /task/{id}/abandon | 放弃 |
| DELETE | /task/{id} | **删除任务**（硬删除，连带全部步骤，不可恢复；前端「删除」按钮走它） |

#### DailyQuestion

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /daily/today | 今日问题（题库为空或已答完时 `question` 为 `null`） |
| POST | /daily/answer | 回答 |
| GET | /daily/history | 每日一问历史（`/daily` 页面的历史列表走它） |

#### Report

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /report | 成长报告（**实时计算，不落库**，见 11.10） |
| POST | /report/save | 保存里程碑快照（body 只有可选 `user_note`，≤500 字） |

#### Badge

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /badge | 我的奖章总览（`{total, obtained_count, items[]}`，见 11.12） |

#### Home / Events / System

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /home/summary | 首页聚合：阶段、画像、标签、今日一问、AI 发现、进行中任务、`next_action` |
| POST | /events | 行为埋点上报（单条或批量；**只落结构化日志，不建表**） |
| GET | /health | 探活 |
| GET | `/`（**根路径，不在 `/api/v1` 下**） | 服务信息：应用名与版本（运维自检用，不是业务接口） |

> `/home/summary` 的 `next_action` **由后端按阶段 + 画像 + 任务状态判定**，前端不做推荐逻辑 —— 这是「AI 主动性」这个核心卖点的落点，让前端按几个 if 排序就退化成了静态导航。

### 10.3 错误码

| code | 含义 | HTTP |
|---|---|---|
| 0 | 成功 | 200 |
| 1001 | 参数错误 | 400 |
| 1002 | 未登录 | 401 |
| 1003 | 权限不足（仅限与资源归属无关的越权） | 403 |
| 2001 | 资源不存在（**含「存在但不属于你」**） | 404 |
| 3001 | AI调用失败 | 200 |
| 5000 | 服务器内部错误 | 500 |

### 10.4 接口契约纪律

以下几条是踩过坑之后定下来的编码规则，新增接口时必须遵守：

1. **信封统一**：所有 JSON 接口返回 `{code,message,data}`，路由 `response_model` 写 `ApiResponse[Xxx]`（见 6.2 / 6.5）；失败时 `data` 为 `null`。
2. **HTTP 状态只由 `CODE_TO_HTTP_STATUS` 推导**：禁止各处自己传 `status_code`，否则会出现同码不同状态（见 6.5）。
3. **归属统一 `2001`**：私有资源的「不存在」与「不属于你」返回同一个码，禁止用 `1003` 当 oracle（见 6.10）。
4. **`stage` 统一 slug + label**：不允许某些接口返 slug、另一些返中文（见 6.11）。
5. **幂等字段必须是正式列，不能内联进正文**：`messages.client_msg_id` 独立成列并加唯一约束。曾被内联在 `content` 前缀（HTML 注释形式），那个标记会跟着响应发给前端，污染用户可见文本、长度统计与搜索。
6. **列表形状**：`data` 是裸数组；前端用 `normalizeList()` 收口。新增列表接口不要临时改成 `{items}`，要改就两端一起改并回写本节。
7. **文件访问只走鉴权端点**：任何上传目录都**不许**挂成无鉴权静态目录；越权按「不存在」处理，并做目录穿越校验。
8. **埋点只落日志不建表**：手册 5.2 没有事件表，擅自建表属于范围扩张；要做行为分析需先新增 `events` 表并回写 5.2/5.3。
9. **JSON 列只整体赋值**（见 5.1）。
10. **改 prompt / 改 schema 后要能生效**：prompt 改动需重启（或带 `--reload-include '*.txt'`）；接口契约改动必须**先落到手册或勘误文档，再让两端各自实现** —— 本项目最大的集成事故就是「设计文档要求的接口」与「手册 10.2 的接口」不一致，两端各自按不同来源实现，前端 12 处路径后端根本不存在（其中 `/tasks`、`/report/growth`、`/interview/sessions` 等全是单复数或命名不一致），以及 7 处读 `.items` 导致所有列表恒为空。

---

## 第11章 核心业务流程实现

### 11.1 注册登录

1. 注册：用户名+密码 → 创建用户 → 返回token。
2. 登录：校验密码 → 返回token。
3. JWT有效期24小时。

### 11.2 基础测试表

1. 获取题目列表。
2. 用户逐题作答，前端保存进度。
3. 提交答案 → 计算初始画像 → 生成阶段。
4. 文字补充经DeepSeek抽取标签。

### 11.3 初始画像生成

- 选择题映射标签和分值。
- 计算 clarity_score、action_score、resume_score。
- 加权总分 → 阶段。
- 写入 profiles 和 profile_tags。

### 11.4 AI职业指导对话

1. 创建对话（未传 title 时服务端取 `新对话 N`）。
2. **获取 AI 开场白**：`POST /chat/conversations/{id}/opening`（见下）。
3. 用户发消息 → 后端调用DeepSeek流式返回（`POST .../stream`，见 7.2）。
4. 每轮抽取画像标签。
5. 对话结束生成结论卡片。

> 原来还有一条「维护追问计数器，超过 3 轮换维度」——该计数器**已移除**，见 7.7。

**AI 先开口（`POST /chat/conversations/{id}/opening`）**

原来的流程是「AI 被动应答」：新建会话 → 空白输入框 → 用户先说话。问题出在空白输入框上：本系统的主要用户恰恰是「还没想清楚方向」的学生，面对空框最容易卡住。改成一个具体、好回答的第一句，冷启动成本立刻降下来。

| 情况 | 行为 |
|---|---|
| 会话里**已有开场白** | 回放同一条（**幂等**，重复调用不会产生第二条） |
| 会话**没有任何消息** | 生成开场白并落库，返回这条消息 |
| 会话**有消息但没有开场白**（用户先说了话） | `{"code":0,"message":"会话已有消息，未生成开场白","data":null}`，**不补开场白** |
| 会话不存在 / 不属于当前用户 | 404 + `code 2001` |

- **开场白就是一条普通 assistant 消息**，形状与 `/messages` 里的一致，`client_msg_id` 是系统保留值 `sys:opening`。必须落库（而不是前端自己拼一句）：否则刷新/换设备就没了、模型不知道自己说过这句会重复问、会话列表里 `message_count` 还是 0。
- 「已有消息就不补」的理由：开场白是对话的第一句，用户已经说过话之后再插一句会排在用户消息**后面**，变成 AI 在自问自答。所以前端应在**创建会话后立刻**调用本接口。
- 内容硬约束：**一句人话、≤60 字、一次只问一件事、绝不出现 A/B/C 这类选项**；有画像标签或进行中任务时必须引用背景，**全新用户从日常小事切入**。它不写任何画像标签 —— 没有任何用户输入，就没有可回流的证据。
- **新会话 = 用户想换一个话题**（硬性规格）：
  - 开场白**禁止**顺着最近会话里出现过的任何话题 / 关键词发问 —— 既包括用户刚说过的话（例如"我平时健身，刷视频，看短句"），也包括刚刚从这些对话里新抽出来的画像标签；
  - 也**禁止**用"你之前说……""上次那个……还在弄吗"这类承接式措辞把旧话题当铺垫；
  - 跨会话信息（其它会话最近几条开场白 + 用户最近说过的话）**只能当"已经聊过"的禁止清单用，绝不能当"可以拿来问的素材"**；
  - 因此开场白要么换一个画像维度（用**没有被聊过**的标签 / 任务），要么聊一件与它们都无关的日常小事；
  - 与服务端保证配套：候选（画像标签 / 进行中任务）在生成前会被**硬剔除** —— 剔的依据是"最近几条开场白 **+ 用户最近说过的话**"，所以即使模型想顺着问也没有素材；剔完候选为空时回到"全新用户 → 聊日常"，这是**预期行为**；
  - 但**不许把"有背景就引用背景"搞死**：全新用户照旧只聊日常；有背景且背景**没有**刚聊过时，仍然必须真的引用该背景，不许退化成"最近在忙什么"这种通用问候。
- AI 不可用时走**开场专用**的三档本地模板（有进行中任务 → 引用任务标题；有画像标签 → 引用标签；都没有 → 聊日常），不会退化成空白、报错或一张选择题。
- 前端消费时要注意：`data: null` 是**预期行为**（说明用户已经先说话了），不是错误，不要弹提示。

**删除会话（`DELETE /chat/conversations/{id}`）**

- 只删 `conversations` 与 `messages` 两类数据，**一行 `profiles` / `profile_tags` 都不碰**；
- 这是**产品红线**，不是实现遗漏：画像标签按 `user_id` 独立存储，回答的是「对这个人已经了解到什么」，与「这些信息是在哪次聊天里说的」无关。用户清理聊天记录是界面整理行为，不该连带丢掉他积累的画像 —— 否则删一次记录就得重新测评，而画像又是后续所有推荐的输入；
- 实现上**显式先删消息、再删会话**，不依赖级联（模型里没有 `ondelete="CASCADE"`，且 SQLite 的外键行为取决于 `PRAGMA foreign_keys`）；这样在开不开外键强制的库上行为一致；
- 重复删除同一个 id 第二次返回 `2001`（已不存在），符合预期。

### 11.5 痛点诊断与任务推荐

- 从画像标签中识别痛点。
- 映射到任务模板（`task_service.TASK_TEMPLATES`，支持「精确命中 → 互相包含 → 默认模板」的降级匹配，所以标签「缺项目经验」也能命中「缺项目」模板）。
- 生成任务并推送。

**生成任务的服务端去重（`POST /task/generate`）**

同一个痛点连点几次「生成任务」会攒出同题任务。只把已有任务标题塞进 prompt 靠模型自觉是不够的，服务端必须自己校验。

| 场景 | `data.reused` | `message` | `data` |
|---|---|---|---|
| 正常新建 | `false` | `"success"` | 新任务详情 |
| 命中同题「进行中」任务 | `true` | `"已经有一个类似的任务了，没有重复生成"` | **那条已有任务的详情（`id` 不变）**，不新建、不写库 |

- **前端判断一律看 `reused === true`**，不要去匹配 `message` 里的中文（文案会改，字段不会）；字段缺失时按「新建」处理。
- 判定规则（保守：**宁可漏判，不可误判**）：
  1. **只跟「进行中」比** —— 已完成/已放弃的同题任务不算重复（放弃后想重做是合理的），它们只进 prompt 当「可承接/加深」的素材；
  2. **按标题相似度比，不按 `pain_point` 比** —— 同一痛点下产出两件不同的事是正常的，按痛点去重会让用户再也拿不到新任务；
  3. 相似度用字符 bigram Jaccard + 归一化（去空白标点、去数字、去虚词量词与交付物泛称），阈值 **0.6**；实现只有一份（`app/utils/similarity.py`），清理脚本也 import 它，避免「接口认为不重复、脚本认为是重复」的两套口径漂移；
  4. 阈值只收语气词/量词/时间词/交付物泛称，**绝不收主题词** —— 否则「用 Java 写命令行工具」和「用 C 写命令行工具」会被压成同一个串。

**打卡区的能力边界（硬约束）**

任务的标题、`action`、`resource` 以及**选项文本里**，一律禁止出现需要提交文件的动作：

- **打卡区只能点选 + 最多写 30 字补充，不支持截图 / 上传 / 拍照 / 录屏 / 录音 / 附件**；
- 禁止词：截图、上传、拍照、录屏、录音、附件、提交文件、发给我看；
- 需要「留下痕迹」的步骤改成**自己做、自己留**：完成标准写「能自己独立做一遍」「把结果存在本地留作纪念」，不要求交付物。

要求写在 `app/ai/prompts/task_generate.txt` 里（第 4 条「能力边界」与第 3 条「禁止让用户写小作文」）。

### 11.6 成长任务打卡与画像更新

- 用户完成任务步骤 → 打卡（`feedback` 最多 1000 字，UI 上限见 11.5 的打卡区边界）。
- 记录反馈。
- 更新画像标签（行动力、自律性等）。
- 打卡路径**必须触发奖章检查**（`complete_step` 里调用），否则打完第 5 步要等一小时的定时兜底才拿到奖章。

> **实现约束：`Task` / `TaskStep` 没有配 `relationship()`，不能用 ORM 删 task**。`db.delete(task)` 会撞 `FOREIGN KEY constraint failed` —— 工作单元不知道两张表的依赖顺序，把 `DELETE FROM tasks` 排到了 `DELETE FROM task_steps` 之前。删任务必须显式按「子表先于父表」发 Core `delete()`。

### 11.7 每日一问

- 题库 30 题（六维度轮换），从 `daily_questions` 表按天取题。
- 用户点击即答。
- 题库为空或当日已答完时返回 `question: null`（**不要返回假数据**，例如全零 UUID 的占位题）。
- 累计答题触发画像微调。

### 11.8 简历生成/优化

- 模板提问：`GET /resume/template` 下发"简历要问的每一项"（每项一句人话问题），前端一个问题一个输入框地问用户。
- 用户填写：前端提交前把空字段剔掉（**用户没写的字段绝不发给 AI**）。
- 润色：`POST /resume/polish` 调 `resume_polish.txt`，**只改写用户写过的内容**（口语 → 简历口吻 / 按 STAR 重组），一个字的事实都不许新增；**唯一的例外是技能栏** —— 用户在那里写的通常只是关键词，要展开成简历上的能力表述（「Java」→「熟悉 Java 基础语法、面向对象编程、集合框架与异常处理。能使用 Java 独立完成控制台程序开发。」），但**不许加用户没写过的其它技术名、不许加任何数字、不许写"精通/资深"**（这条边界与它的机械缺口见 9.20）；服务端另做机械校验（数字必须是用户原文数字的子集、用户没填的字段不许被填、技能条目**一一对应且每条必须留着原技术名**），命中就把那个字段回退成用户原文。
- 技能的填写方式：**一项一行**（模板下发 `lines: true`，前端渲染成多行输入框）。因为展开后的一句话自带顿号逗号，用顿号分隔的单行输入框会把一句话切成好几项假技能；展示态也只对短词条用「、」拼接，展开成句子的技能一条一行。
- 展示 / 保存 / 打印：点「润色」立刻先按用户原文排出一份完整简历（顶上提示"正在润色"），AI 回来后原地换成润色版；可编辑、可 `PUT /resume/mine` 保存、可打印导出。
- 画像回流：完整度（`calculate_completeness`，权重 25/10/20/10/20/10/5 合计 100）、项目经验、技能栈。
- 老链路的「上传 PDF → 解析 → ATS 评分 → 优化报告 → 下载」已**整体删除**，本节的标题与编号沿用，内容以上面这几条为准（见 9.17）。

### 11.9 模拟面试

- 选择模式与场景。
- DeepSeek基于简历出题。
- 每题后 1-2 轮追问（追问上限 `MAX_FOLLOWUP_PER_QUESTION = 2`）。
- 结束生成复盘报告。
- 画像回流：技能、项目深度、知识盲区、沟通能力。

**追问与下一题的判别（`POST /interview/{id}/answer` 的响应契约）**

追问 = **同一道题的再问，不新建题目行**（都挂在同一行 `interview_questions`：主问题答 `answer`，追问存 `followups` JSON 数组）。响应必须给出判别字段：

| `action` | 含义 | 前端行为 |
|---|---|---|
| `followup` | 这是同一题的追问（`question_id` 与上一题相同） | **就地续问**，不追加新题、不前进题号 |
| `next_question` | 这是下一道新题 | 追加新题并前进 |
| `finished` | 本题/本场结束 | 收尾 |

`followups` 必须回传（不能只藏在 `extra` 里，否则前端看不到追问内容）；`extra` 是 JSON 列，**只做整体赋值**（见 5.1）。

### 11.10 成长报告

两个接口，`data` 形状完全一致：

| 接口 | 语义 |
|---|---|
| `GET /report` | **每次实时聚合计算，从不落库** —— 改一个分数（打卡/测评）后立刻反映。查询参数 `refresh` 已废弃且被忽略 |
| `POST /report/save` | 把**当前实时数据 + 用户补充说明**存成一份**里程碑快照**（`reports` 一行）；该快照成为下一次 `score_delta` 的基线 |

- `score_delta` = 当前实时分数 − **最近一次「保存」的报告**里的分数；**从未保存过则全为 0**，但这不代表「真的没变化」；
- 前端必须用 `saved` / `last_saved_at` 判断「有没有可比对的基线」，**不能只看 delta 是否为 0**；**没有基线时不渲染一排「＋0」**（那是误导），应显示「还没有可对比的基线」；
- 即使有基线，变化值为 0 也显示 `±0` 而不是 `+0`（0 不是「涨了」）；
- `suggestions` 每条带 `pain_point`，可直接作为 `POST /task/generate` 的 `pain_point` 传回去，让「报告 → 行动」闭环；
- **产品红线：用户只能改自己的补充说明（`user_note`，≤500 字），不能改分数** —— 分数是对行为证据的度量，由测评、打卡、简历、面试算出。代码层面的保证是保存请求的 schema 里根本没有分数字段。

> 实现注意：组装响应时不要写成 `GrowthReportResponse(**content, score_delta=...)` —— `content` 里已有同名键会抛 `TypeError: got multiple values for keyword argument`。

### 11.11 结论卡片

- 对话结束生成结构化诊断卡（`chat_conclusion.txt`）。
- 首次调用时生成并缓存到 `conversations.conclusion`；`done` 事件带 `conclusion_ready` 供前端决定是否去拉取。

### 11.12 奖章触发

**三枚奖章（用户验收后由 1 枚扩到 3 枚）**：

| key | 名称 | 条件（**必须由真实行为证据驱动**） |
|---|---|---|
| `first_task` | 起步行动家 | 已完成任务数 ≥ 1 |
| `five_steps` | 坚持打卡者 | 累计打卡步骤数 ≥ 5（**跨任务累计**） |
| `profile_shape` | 方向初现 | 画像标签数 ≥ 6（标签是 AI 从真实对话里抽出来的，不是用户自报） |

> 手册 V1.0 曾写「砍掉奖章墙、P1 只保留一个轻量奖章」。**这一条已被用户验收后的决定推翻**：用户看到界面后要求「添加其他奖章，建议一共三个，后续可以添加」，因此改为三枚。被砍掉的仍然只有「奖章墙 / 庆祝动画」这类陈列与表演部分。

工程上的三条要求：

1. **定义只有一个来源**：三枚奖章的定义（事件名、阈值、`key`、展示顺序、文案）只写在 `badge_service.BADGE_RULES` 一处，`seed_data.BADGES` 由它派生。历史上出现过「种子里有、引擎里没有」的死数据 —— 奖章在种子里定义了但引擎只认第一枚，于是「坚持打卡者」从来没被发放过。**凡是「种子/配置/代码」三处各写一份的定义，都要收成一个来源。**
2. **事件只是触发器，一次触发要评估全部条件**：不能按 `event == "task_completed"` 分派，否则新增奖章时老用户永远不会被追认。任何触发都重算全部条件，另有每小时 `settle_badges` 兜底。打卡路径必须显式触发检查（见 11.6）。
3. **红线**：`current` 只能来自真实行为证据（已完成任务 / 已完成步骤 / 画像标签），不允许出现「用户声称即达成」的条件，也不允许为了让人拿到而调阈值。

**`GET /badge` 的契约**：

```json
{
  "total": 3,
  "obtained_count": 1,
  "items": [
    {
      "key": "first_task",
      "name": "起步行动家",
      "description": "完成第一个成长任务",
      "hint": "把「成长任务」里任意一个任务的步骤全部打完，让它变成已完成",
      "obtained": true,
      "obtained_at": "2026-09-18T12:00:00Z",
      "progress": { "current": 1, "target": 1 }
    }
  ]
}
```

- `items` **必须包含未获得的奖章**，只返回已获得的做不出「还差多远」的界面（`hint` 未获得时说怎么拿到、已获得时说一句庆祝/意义）；
- `items` 顺序**固定为门槛从低到高**，前端槽位不会因为获得顺序而跳动；
- `progress.current` 已达成的封顶为 `target`（进度条不该溢出 100%）；
- 前端 `key` 取不到时用默认美术兜底；未获得的奖章渲染成「铸模」态（中性灰），不留整块空白。

### 11.13 提醒

- 站内提醒或Electron通知（推送通道属 M3，当前只返回提醒列表）。

---

## 第12章 定时任务与后台作业

### 12.1 APScheduler

```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()
scheduler.add_job(daily_question_job, 'cron', hour=0)
scheduler.start()
```

### 12.2 任务清单

| 任务 | 频率 | 说明 |
|---|---|---|
| 每日一问生成 | 每天0点 | 生成次日题目 |
| 任务提醒 | 每天10点 | 检查未打卡任务（只返回列表，通知通道属 M3） |
| 奖章结算 | 每小时 | 遍历全部用户 × 全部奖章条件，追认新达成的奖章（兜底，见 11.12） |
| 数据清理 | 每周 | 清理 `uploads/` 下过期临时文件（只认 `tmp`/`temp`/`.cache` 目录与 `.tmp`/`.part`/`.crdownload` 后缀，保留 7 天；`cleanup_job.py`） |

### 12.3 不做

- 双月复盘
- 画像衰减

---

## 第13章 文件存储与解析

### 13.1 本地磁盘存储

- **本章讲的是老简历链路（上传 PDF → 解析 → ATS 评分 → 报告 → 下载）的文件能力，该功能已整体移除**（见 9.17）；现行的简历是问答式生成（见 11.8），**不涉及任何文件上传、解析或落盘**。
- 仍然成立的部分：`uploads/` 目录树与 Dockerfile 里的空目录**还在**，`UPLOAD_DIR` 与 compose 的 `./backend/uploads` 卷也照旧（一致性约定仍要遵守），只是老链路删掉后**不再有任何简历文件写进去**（现存目录是空的）。
- `app/utils/file.py` 现在只剩 `get_upload_root()`（`tasks/cleanup_job.py` 在用）与 `resolve_stored_path` / `delete_file`；上传校验、PDF / `.docx` 解析、鉴权下载全部已删。

### 13.2 上传限制

- 老链路的限制（支持 **PDF 与 `.docx`**、不支持二进制 `.doc`、白名单 + 10MB 上限、落盘用 `{uuid}.{ext}`）**随功能一并移除**，现在没有任何上传入口，这些校验也就不存在了。
- 之所以不需要：简历改成用户一个字段一个字段填，走的是 JSON 接口，不经过文件。

### 13.3 解析

**该实现已移除**：原来的 `parse_pdf`（pdfplumber）/ `parse_docx`（`from docx import Document`）两个函数已随老链路删除，`pdfplumber` / `python-docx` 也不再是运行依赖（见 2.3 / 2.6）。简历数据现在由前端表单直接产出结构化 JSON（`parsed_data`），没有任何文本抽取步骤，因此本节不再保留示例代码。

### 13.4 解析失败

- **该失败分支已随解析功能一并移除**：没有上传与解析，就没有"解析失败"这条路径。
- 仍然成立的教训保留在这里：**用户输入永远可能不合格式**，所以新链路的兜底做在服务端——润色失败/坏 JSON 一律退回用户原文，画像 `completeness` 按实际填写比例算，**永远不 500**。

---

## 第14章 安全与隐私

### 14.1 数据保密

- 引导页明确承诺。
- 敏感字段加密存储。

### 14.2 JWT

- SECRET_KEY 环境变量。
- Token 过期时间24小时。

### 14.3 密码

- passlib bcrypt 哈希。

### 14.4 HTTPS

- Nginx 配置 Let's Encrypt。

### 14.5 权限

- 用户只能访问自己的数据：所有按 id 取私有资源的地方一律走 `not_found_unless_owner()`，「不存在」与「不属于你」返回同一个 `2001`（见 6.10）。
- **上传目录禁止挂成无鉴权静态目录**：曾把 `uploads/` 挂成 `StaticFiles`，于是未登录的人只要知道路径就能下载别人的简历（简历含姓名、手机号、学校、经历，属 PII）。老链路的鉴权下载端点 `GET /api/v1/resume/{id}/file` 已随链路删除，Nginx 也不暴露 `/uploads`；**以后再引入文件类功能，仍然禁止把上传目录挂成静态目录**。
- 文件类端点要做**目录穿越校验**：规范化后的路径必须仍在 `UPLOAD_DIR` 内。

### 14.6 日志脱敏

- 不记录密码、API Key。
- 私密资源的越权访问**不记日志**（避免被当成探测信号刷日志）。
- 流内异常用 `logger.exception` 而不是 `logger.error`：否则只剩一行错误文本、没有堆栈。

### 14.7 Prompt注入

- 系统Prompt与用户输入分离。
- 输出校验。

### 14.8 字段与枚举不外泄

- 所有对外枚举（阶段、标签来源、分数维度）都必须经中文映射后再给用户看；
- 私有资源的错误信息不得泄露「该 id 是否存在」；
- 500 的细节只进日志，响应体里不带堆栈。

---

## 第15章 测试与调试

### 15.1 后端测试

- pytest
- TestClient

### 15.2 前端测试

- Vitest
- React Testing Library

### 15.3 AI输出测试

- 固定输入，校验Schema。

### 15.4 Mock DeepSeek

- 测试环境使用 mock 返回。

### 15.5 常见Bug

| 问题 | 排查 |
|---|---|
| 500错误 | 看后端日志 |
| AI超时 | 检查网络、Key |
| 画像不更新 | 检查事件触发 |

---

## 第16章 部署与运维

### 16.1 服务器

- 2核4G
- Ubuntu 22.04

### 16.2 Docker Compose

```yaml
services:
  # 建表 / 迁移（一次性）：docker-compose run --rm migrate
  migrate:
    build: ./backend
    env_file: .env
    environment:
      DATABASE_URL: sqlite:////data/app.db     # 生产切 PG 时改成 postgresql://...
    volumes:
      - sqlite_data:/data
    command: ["sh", "-c", "python -m app.db.init_db"]   # 有迁移脚本后换成 alembic upgrade head
    restart: "no"

  app:
    build: ./backend
    env_file: .env
    environment:
      DATABASE_URL: sqlite:////data/app.db
      UPLOAD_DIR: /app/uploads
      APP_ENV: production
      DEBUG: "false"
    volumes:
      - ./backend/uploads:/app/uploads        # 与 13.1 的 UPLOAD_DIR 保持一致
      - sqlite_data:/data
    ports:
      - "8000:8000"
    # 建表失败则不让 app 起来，避免"表不存在"的 500
    command: >
      sh -c "python -m app.db.init_db &&
             uvicorn app.main:app --host 0.0.0.0 --port 8000"

  # PostgreSQL：保留但默认不启动（profile: postgres），生产一键切回
  db:
    image: postgres:16
    profiles: ["postgres"]
    environment:
      POSTGRES_DB: ai_career
      POSTGRES_USER: ai_user
      POSTGRES_PASSWORD: your_password
    volumes:
      - pgdata:/var/lib/postgresql/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./frontend/dist:/usr/share/nginx/html:ro
      # ⚠️ 不要把 uploads 挂给 Nginx（见 14.5）
    depends_on:
      - app

volumes:
  sqlite_data:
  pgdata:
```

要点：

1. **数据库默认 SQLite**，`db` 服务放在 `postgres` profile 下，默认不启动（因此 app 也不 `depends_on: db`）；
2. **建表/迁移写进启动命令**（`python -m app.db.init_db`，切回 PG 时改成 `alembic upgrade head`），另留一次性 `migrate` 服务；
3. **uploads 卷统一为 `./backend/uploads`**，与 13.1 的 `UPLOAD_DIR` 一致（原手册 16.2 写 `./uploads`，两处路径不一致）；卷本身保留，但老链路删除后**不再有简历文件写进去**（见 13.1）；
4. 补了 db 健康检查、app healthcheck（打 `/api/v1/health`）与重启策略。

### 16.3 Nginx

反向代理 `/api` 到 app:8000，静态资源指向 frontend/dist。

### 16.4 启动

```bash
docker-compose up -d
```

### 16.5 备份

- **SQLite（默认）**：定期复制库文件（连同 `-wal` / `-shm` 一起，或先 `VACUUM INTO` 导出一份一致性快照），与 `uploads/` 一起备份（该目录目前是空的，保留它只是延续同样的备份口径）。
- **PostgreSQL（若已切回）**：`pg_dump` 定期备份。

### 16.6 日志

- docker logs

---

## 第17章 开发流程与协作

### 17.1 Git分支

- main：稳定
- dev：开发
- feature/xxx：功能

### 17.2 Commit规范

- feat: 新功能
- fix: 修复
- docs: 文档
- refactor: 重构

### 17.3 Code Review

- 至少一人review。

### 17.4 接口变更

- 更新API文档。
- 通知前端。

### 17.5 Prompt变更

- 版本化。
- 测试后再上线。
- 改完**必须重启后端**才能生效（`load_prompt` 带 `lru_cache`；启动命令已带 `--reload-include '*.txt'`，见 3.6）。

### 17.6 数据库变更

- Alembic迁移。

---

## 第18章 附录

### 附录A：画像标签枚举

| 维度 | 标签示例 |
|---|---|
| 兴趣 | 技术、产品、设计、运营、数据 |
| 能力 | 表达、逻辑、执行、学习、协作 |
| 技能 | Python、Java、前端、SQL、PPT |
| 痛点 | 缺项目、缺实习、表达差、迷茫 |
| 焦虑 | 高、中、低 |
| 认知 | 清晰、模糊、偏差 |

标签来源 `source` 的取值与展示文案：`test` 职业测评 / `chat` 和 AI 对话 / `resume` 简历 / `interview` 模拟面试 / `daily` 每日一问 / `task` 成长任务。

### 附录B：阶段判定规则

- clarity_score：测试表计算
- action_score：功能行为累计
- resume_score：简历完整度
- total = 0.4*clarity + 0.35*action + 0.25*resume
- 0-30 探索期，31-65 准备期，66-100 冲刺期

### 附录C：测试表题目示例

1. 你目前有明确的职业方向吗？
2. 你写过简历吗？
3. 你参加过实习吗？
4. 你了解自己的优势吗？
5. 你对未来就业焦虑吗？

### 附录D：每日一问题库示例

- 兴趣：如果可以选，你更想做哪种工作？
- 能力：做小组作业时，你通常是？
- 认知：你觉得产品经理主要是做什么的？

### 附录E：成长任务模板

以代码常量承载（`task_service.TASK_TEMPLATES`），作为 `task_generate` 的参考样例：

1. 做一个入门级小项目
2. 挖掘三段校园经历
3. 每天1分钟口头复述
4. 完成一个基础技能学习
5. 完成一次职业深度对话
6. 完成一次面试小测试

> 实际落地的模板数量少于上面 6 条（当前 4 条，并补齐了报告建议所对应的痛点模板），且**未落库**（理由与影响见 5.4）。

### 附录F：岗位关键词库

- 产品经理：需求分析、原型、PRD、用户调研
- 前端开发：React、Vue、TypeScript、Webpack
- 数据分析：SQL、Python、Excel、可视化

### 附录G：Prompt模板全集

见第7章。

### 附录H：API错误码

见第10章。

### 附录I：数据库ER图

（略，可用 dbdiagram.io 生成）

### 附录J：页面原型与路由表

见第8章。

### 附录K：环境变量清单

见第3章。

### 附录L：常见问题FAQ

| 问题 | 答案 |
|---|---|
| 如何修改DeepSeek模型？ | 改 `.env` 的 `DEEPSEEK_MODEL`（或 `deepseek_client.py` 中的 model 字段） |
| 如何增加岗位？ | 在岗位关键词库中添加（代码常量，见 5.4） |
| 如何导出报告？ | 浏览器打印（`src/styles/print.css` 提供打印样式） |
| 改了 prompt 为什么不生效？ | prompt 带 `lru_cache`，必须重启后端（见 3.6） |

---

**文档结束**
