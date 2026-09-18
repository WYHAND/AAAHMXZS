# 《高校学生AI就业辅助系统 开发手册》

版本：V1.0  
日期：2026-09-18  
适用技术栈：FastAPI + PostgreSQL + DeepSeek + React + Electron

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

### 0.4 相关文档索引

- 《高校学生AI就业辅助系统 需求分析文档 V2.0》
- 《数据库设计说明书》
- 《API接口文档》（FastAPI自动生成）
- 《Prompt模板全集》
- 《页面原型与路由表》

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
3. 一个轻量奖章（完成第一个任务）
4. 基础站内提醒

**明确砍掉或延后的功能（P2）：**

- 奖章墙、5种奖章、庆祝动画
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
│  PostgreSQL  │  本地磁盘（简历文件）  │  APScheduler     │
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
| 框架 | React 18+ | 组件化、生态成熟、与Electron兼容好 |
| 语言 | TypeScript | 类型安全，与后端Schema对齐 |
| 构建工具 | Vite | 快速冷启动、HMR |
| 状态管理 | Zustand | 轻量、无样板代码 |
| UI组件库 | Ant Design | 企业级组件丰富，适合中后台与工具类产品 |
| 样式 | Tailwind CSS | 原子化CSS，快速布局 |
| 图表 | ECharts | 雷达图、成长曲线（简化版） |
| 请求 | axios | 拦截器、统一错误处理 |
| 路由 | React Router v6 | 声明式路由 |

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
| 数据校验 | Pydantic v2 | 结构化输出、AI JSON校验 |
| ORM | SQLModel | SQLAlchemy + Pydantic合体，简洁 |
| 数据库 | PostgreSQL | 单库够用，JSONB灵活 |
| 鉴权 | JWT | python-jose + passlib |
| 定时任务 | APScheduler | 单机定时足够 |
| 文件解析 | pdfplumber + python-docx | 简历PDF/Word解析 |
| 文件上传 | python-multipart | FastAPI文件上传 |
| HTTP客户端 | httpx | 调用DeepSeek API |
| 部署 | Docker Compose + Nginx + Uvicorn | 三容器编排 |

### 2.4 AI

| 技术 | 选型 | 说明 |
|---|---|---|
| 模型 | DeepSeek API | 只接一家，deepseek-chat |
| 调用方式 | httpx 直接调用 | 不引入LangChain，减少抽象层 |
| 流式输出 | SSE | 对话、面试追问流式返回 |
| 结构化输出 | Pydantic + JSON Schema | 画像标签、诊断卡、面试评分等 |
| Prompt管理 | 本地模板文件 | 版本化管理 |
| 兜底策略 | 模板回复 + 重试 | 调用失败不报错 |

### 2.5 明确不引入的依赖及原因

| 不引入 | 原因 |
|---|---|
| Redis | 无队列、无缓存刚需。JWT无状态，限流用Nginx或slowapi内存版 |
| Celery / Arq | APScheduler + BackgroundTasks足够，单机不需要分布式队列 |
| pgvector / 向量数据库 | 画像、简历、面试不需要语义检索，岗位匹配用关键词+DeepSeek |
| LangChain / LlamaIndex | 只接DeepSeek，直接SDK更轻、更可控 |
| 多模型路由 / LLM Gateway | 只考虑DeepSeek，封装一个客户端即可 |
| MinIO / OSS | 简历文件存本地磁盘，数据库存路径 |
| PaddleOCR / OCR | 学生简历绝大多数是电子版，扫描件概率极低 |
| 云ASR/TTS | 面试语音用浏览器Web Speech API，后端零依赖（后期可加） |
| Elasticsearch / MongoDB | PostgreSQL的JSONB足够 |
| 微服务拆分 | 模块化单体足够，FastAPI内部按模块拆router |
| 复杂监控 / 日志系统 | 标准logging + 控制台足够 |

### 2.6 最小依赖清单

**后端：**

```text
fastapi
uvicorn
pydantic
sqlmodel
psycopg2-binary
python-jose[cryptography]
passlib[bcrypt]
httpx
pdfplumber
python-docx
python-multipart
apscheduler
```

**前端：**

```text
react
typescript
vite
zustand
antd
tailwindcss
axios
echarts
react-router-dom
```

**数据库：**

```text
PostgreSQL
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
- PostgreSQL：16+
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
# 安装 pnpm（推荐）
npm install -g pnpm

# 安装依赖
pnpm install
```

### 3.4 PostgreSQL

```bash
# 创建数据库
createdb ai_career

# 或使用 psql
psql -U postgres
CREATE DATABASE ai_career;
CREATE USER ai_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE ai_career TO ai_user;
```

### 3.5 环境变量

在项目根目录创建 `.env`：

```env
# 数据库
DATABASE_URL=postgresql://ai_user:your_password@localhost:5432/ai_career

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
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

访问 `http://localhost:8000/docs` 查看自动生成的API文档。

### 3.7 启动前端

```bash
cd frontend
pnpm dev
```

访问 `http://localhost:5173`。

### 3.8 启动Electron

```bash
cd electron
pnpm dev
```

### 3.9 Docker Compose一键启动

```bash
docker-compose up -d
```

`docker-compose.yml` 参考第16章。

### 3.10 常见问题

| 问题 | 解决 |
|---|---|
| psycopg2安装失败 | 安装 `psycopg2-binary` 或系统依赖 `libpq-dev` |
| DeepSeek调用超时 | 检查网络、API Key、超时设置 |
| 前端跨域 | 后端配置CORS，允许 `http://localhost:5173` |
| 数据库连接失败 | 检查 `.env` 中 `DATABASE_URL` |

---

## 第4章 项目目录结构

### 4.1 后端目录

```text
backend/
├── app/
│   ├── main.py                 # FastAPI入口
│   ├── core/
│   │   ├── config.py           # 配置
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
│   │   └── badge.py
│   ├── schemas/                # Pydantic Schema
│   │   ├── user.py
│   │   ├── profile.py
│   │   ├── chat.py
│   │   ├── resume.py
│   │   ├── interview.py
│   │   ├── task.py
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
│   │   │   └── badge.py
│   │   └── router.py
│   ├── services/               # 业务逻辑
│   │   ├── auth_service.py
│   │   ├── profile_service.py
│   │   ├── chat_service.py
│   │   ├── resume_service.py
│   │   ├── interview_service.py
│   │   ├── task_service.py
│   │   ├── daily_question_service.py
│   │   ├── report_service.py
│   │   └── badge_service.py
│   ├── ai/                     # AI集成
│   │   ├── deepseek_client.py
│   │   ├── prompts/
│   │   │   ├── chat_system.txt
│   │   │   ├── profile_extract.txt
│   │   │   ├── resume_parse.txt
│   │   │   ├── resume_optimize.txt
│   │   │   ├── interview_question.txt
│   │   │   ├── interview_review.txt
│   │   │   ├── task_generate.txt
│   │   │   └── daily_question.txt
│   │   └── parser.py           # 输出解析与校验
│   ├── tasks/                  # APScheduler任务
│   │   ├── scheduler.py
│   │   ├── daily_question_job.py
│   │   ├── reminder_job.py
│   │   └── badge_job.py
│   ├── utils/
│   │   ├── file.py
│   │   ├── text.py
│   │   └── logger.py
│   └── db/
│       ├── session.py
│       └── init_db.py
├── uploads/                    # 简历文件存储
├── tests/
├── requirements.txt
└── .env
```

### 4.2 前端目录

```text
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── router/
│   │   └── index.tsx
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── Login.tsx
│   │   │   └── Register.tsx
│   │   ├── test/
│   │   │   ├── TestIntro.tsx
│   │   │   ├── TestQuestion.tsx
│   │   │   └── TestResult.tsx
│   │   ├── home/
│   │   │   └── Home.tsx
│   │   ├── chat/
│   │   │   └── Chat.tsx
│   │   ├── resume/
│   │   │   ├── ResumeList.tsx
│   │   │   ├── ResumeCreate.tsx
│   │   │   ├── ResumeEdit.tsx
│   │   │   └── ResumeReport.tsx
│   │   ├── interview/
│   │   │   ├── InterviewSelect.tsx
│   │   │   ├── InterviewPrepare.tsx
│   │   │   ├── InterviewSession.tsx
│   │   │   └── InterviewReview.tsx
│   │   ├── task/
│   │   │   ├── TaskList.tsx
│   │   │   └── TaskDetail.tsx
│   │   ├── daily/
│   │   │   └── DailyQuestion.tsx
│   │   ├── report/
│   │   │   └── Report.tsx
│   │   └── profile/
│   │       └── Profile.tsx
│   ├── components/
│   │   ├── Layout.tsx
│   │   ├── ChatBubble.tsx
│   │   ├── ProfileCard.tsx
│   │   ├── TaskCard.tsx
│   │   └── ...
│   ├── store/
│   │   ├── authStore.ts
│   │   ├── chatStore.ts
│   │   ├── profileStore.ts
│   │   └── taskStore.ts
│   ├── api/
│   │   ├── client.ts
│   │   ├── auth.ts
│   │   ├── chat.ts
│   │   ├── resume.ts
│   │   ├── interview.ts
│   │   ├── task.ts
│   │   └── daily.ts
│   ├── types/
│   │   ├── user.ts
│   │   ├── profile.ts
│   │   ├── chat.ts
│   │   ├── resume.ts
│   │   ├── interview.ts
│   │   └── task.ts
│   ├── hooks/
│   │   ├── useSSE.ts
│   │   └── useAuth.ts
│   └── utils/
│       ├── format.ts
│       └── storage.ts
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

### 4.3 Electron目录

```text
electron/
├── src/
│   ├── main.ts
│   ├── preload.ts
│   └── ipc/
│       ├── file.ts
│       ├── notification.ts
│       └── tray.ts
├── package.json
└── electron-builder.yml
```

---

## 第5章 数据库设计

### 5.1 设计原则

- 单库 PostgreSQL，不引入额外数据库。
- 常用字段独立列，扩展字段用 JSONB。
- 所有表带 `created_at`、`updated_at`。
- 软删除：`deleted_at` 为空表示未删除。
- 主键统一用 UUID 或自增 BIGINT（推荐 UUID，便于分布式扩展）。

### 5.2 表清单

| 表名 | 说明 |
|---|---|
| users | 用户 |
| profiles | 画像主表 |
| profile_tags | 画像标签 |
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
| reports | 成长报告 |
| badges | 奖章 |
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
| stage | VARCHAR(20) | 探索期/准备期/冲刺期 |
| updated_at | TIMESTAMP | 更新时间 |

#### profile_tags

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| dimension | VARCHAR(50) | 维度：兴趣/能力/技能/痛点/焦虑/认知 |
| label | VARCHAR(100) | 标签名 |
| weight | FLOAT | 权重 0-1 |
| source | VARCHAR(50) | 来源：test/chat/resume/interview/daily/task |
| extra | JSONB | 扩展信息 |
| updated_at | TIMESTAMP | 更新时间 |

#### conversations

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| title | VARCHAR(200) | 对话主题 |
| conclusion | JSONB | 结论卡片 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

#### messages

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| conversation_id | UUID | 外键 |
| role | VARCHAR(20) | user/assistant/system |
| content | TEXT | 消息内容 |
| created_at | TIMESTAMP | 创建时间 |

#### resumes

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| title | VARCHAR(200) | 简历标题 |
| file_path | VARCHAR(500) | 文件路径 |
| parsed_data | JSONB | 解析后结构化数据 |
| ats_score | FLOAT | ATS评分 |
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
| report | JSONB | 复盘报告 |
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
| options | JSONB | 选项 |
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
| type | VARCHAR(50) | 成长报告 |
| content | JSONB | 报告内容 |
| created_at | TIMESTAMP | 创建时间 |

#### badges

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| name | VARCHAR(100) | 奖章名 |
| condition | JSONB | 触发条件 |
| created_at | TIMESTAMP | 创建时间 |

#### user_badges

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| user_id | UUID | 外键 |
| badge_id | UUID | 外键 |
| obtained_at | TIMESTAMP | 获得时间 |

### 5.4 初始化种子数据

- 基础测试题：30-50题，纯选择题，四维度。
- 每日一问题库：30题，四维度轮换。
- 成长任务模板：6个任务，每个3-5步。
- 岗位关键词库：产品经理、前端开发、数据分析。
- 奖章：起步行动家。

### 5.5 数据库迁移

使用 Alembic 或手动 SQL 脚本。推荐 Alembic：

```bash
alembic init migrations
alembic revision --autogenerate -m "init"
alembic upgrade head
```

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
@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await chat_service.chat(db, current_user, req)
```

### 6.3 Schema规范

- 请求：`XxxRequest`
- 响应：`XxxResponse`
- 内部：`XxxCreate`、`XxxUpdate`
- 使用 Pydantic v2，`model_config = ConfigDict(from_attributes=True)`

### 6.4 依赖注入

- `get_db`：数据库会话
- `get_current_user`：JWT解析当前用户
- `get_settings`：配置

### 6.5 统一响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

错误码：

| code | 含义 |
|---|---|
| 0 | 成功 |
| 1001 | 参数错误 |
| 1002 | 未登录 |
| 1003 | 权限不足 |
| 2001 | 资源不存在 |
| 3001 | AI调用失败 |
| 5000 | 服务器内部错误 |

### 6.6 异常处理

全局异常处理器：

```python
@app.exception_handler(BusinessException)
async def business_exception_handler(request, exc):
    return JSONResponse(
        status_code=200,
        content={"code": exc.code, "message": exc.message, "data": None},
    )
```

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

### 6.9 模块划分

| 模块 | 路由前缀 | 说明 |
|---|---|---|
| Auth | /api/v1/auth | 注册登录 |
| Test | /api/v1/test | 测试表 |
| Profile | /api/v1/profile | 画像 |
| Chat | /api/v1/chat | 职业指导对话 |
| Resume | /api/v1/resume | 简历 |
| Interview | /api/v1/interview | 面试 |
| Task | /api/v1/task | 成长任务 |
| DailyQuestion | /api/v1/daily | 每日一问 |
| Report | /api/v1/report | 成长报告 |
| Badge | /api/v1/badge | 奖章 |

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

使用 SSE：

```python
from fastapi.responses import StreamingResponse

async def stream_chat(messages):
    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream("POST", DEEPSEEK_API_URL, ...) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    yield line[6:] + "\n\n"
```

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
| profile_extract.txt | 从对话中抽取画像标签 |
| resume_parse.txt | 简历解析 |
| resume_optimize.txt | 简历优化建议 |
| interview_question.txt | 面试出题 |
| interview_followup.txt | 面试追问 |
| interview_review.txt | 面试评分与复盘 |
| task_generate.txt | 成长任务生成 |
| daily_question.txt | 每日一问口语化 |

### 7.5 Prompt示例：职业指导对话系统

```text
你是高校学生的AI职业指导助手，像学长学姐一样亲切。
规则：
1. 每轮用户回答后，必须回应并主动抛出下一个问题或方向。
2. 连续追问同一方向不超过3轮。
3. 每次输出不超过300字，长内容分段。
4. 语气平等，不说教，可适当使用语气词。
5. 用户表达迷茫或焦虑时，先共情，再引导到兴趣、经历。
6. 用户拒绝回答时，立即跳过并切换话题。
7. 对话超过5轮无新信息时，主动切换挖掘维度。
```

### 7.6 兜底策略

- DeepSeek调用失败：返回模板回复，不报错。
- 结构化输出解析失败：重试1次，仍失败则使用默认值。
- 用户拒绝回答：跳过，切换话题。
- 用户答不上来：给提示思路。

### 7.7 对话边界控制

- 追问≤3轮：在service层维护计数器。
- 输出≤300字：Prompt约束+后端截断。
- 过渡语模板：本地维护30条，随机选择。

### 7.8 AI数据回流画像

- 对话每轮结束后，调用 `profile_extract` 抽取标签。
- 简历解析、面试复盘、任务打卡后同样抽取。
- 标签写入 `profile_tags`，更新权重。
- 阶段判定重新计算。

---

## 第8章 前端开发规范

### 8.1 路由设计

| 路径 | 页面 |
|---|---|
| /login | 登录 |
| /register | 注册 |
| /test/intro | 测试引导 |
| /test/question | 测试答题 |
| /test/result | 测试结果 |
| / | 首页 |
| /chat | AI职业指导对话 |
| /resume | 简历列表 |
| /resume/create | 新建简历 |
| /resume/:id/edit | 简历编辑 |
| /resume/:id/report | 简历优化报告 |
| /interview | 面试选择 |
| /interview/prepare | 面试准备 |
| /interview/session | 面试进行 |
| /interview/review/:id | 面试复盘 |
| /task | 任务列表 |
| /task/:id | 任务详情 |
| /daily | 每日一问 |
| /report | 成长报告 |
| /profile | 个人中心 |

### 8.2 状态管理

Zustand store：

- `authStore`：用户、token
- `chatStore`：对话消息、流式状态
- `profileStore`：画像标签
- `taskStore`：任务列表

### 8.3 API请求封装

```typescript
// src/api/client.ts
import axios from 'axios';

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res.data,
  (err) => Promise.reject(err)
);

export default client;
```

### 8.4 流式对话

使用 EventSource：

```typescript
const es = new EventSource(`/api/v1/chat/stream?conversation_id=${id}`);
es.onmessage = (e) => {
  appendMessage(e.data);
};
```

### 8.5 UI规范

- 组件库：Ant Design
- 样式：Tailwind CSS
- 主色：蓝紫 `#6366f1`
- 辅助色：白、灰
- 字体：系统默认

### 8.6 表单与校验

使用 Ant Design Form + 自定义校验。

### 8.7 图表

ECharts 雷达图、简单柱状图。

### 8.8 错误处理

统一 toast 提示，401 跳转登录。

---

## 第9章 Electron桌面端开发

### 9.1 定位

先做Web，Web稳定后用Electron包壳。

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

用于简历文件、缓存。

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
- 请求：JSON
- 响应：`{ code, message, data }`
- 鉴权：`Authorization: Bearer <token>`

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
| GET | /test/result | 获取结果 |

#### Profile

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /profile | 获取画像 |
| GET | /profile/tags | 获取标签 |
| POST | /profile/feedback | 标签反馈 |

#### Chat

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /chat/conversations | 创建对话 |
| GET | /chat/conversations | 对话列表 |
| GET | /chat/conversations/{id}/messages | 消息列表 |
| POST | /chat/conversations/{id}/messages | 发送消息 |
| GET | /chat/conversations/{id}/stream | SSE流式 |
| GET | /chat/conversations/{id}/conclusion | 结论卡片 |

#### Resume

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /resume | 简历列表 |
| POST | /resume | 新建 |
| GET | /resume/{id} | 详情 |
| PUT | /resume/{id} | 更新 |
| POST | /resume/upload | 上传解析 |
| POST | /resume/{id}/optimize | 优化建议 |
| GET | /resume/{id}/report | 优化报告 |

#### Interview

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /interview/start | 开始面试 |
| GET | /interview/{id}/questions | 获取题目 |
| POST | /interview/{id}/answer | 提交回答 |
| POST | /interview/{id}/finish | 结束 |
| GET | /interview/{id}/review | 复盘报告 |

#### Task

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /task | 任务列表 |
| POST | /task/generate | 生成任务 |
| GET | /task/{id} | 任务详情 |
| POST | /task/{id}/steps/{step_id}/complete | 打卡 |
| POST | /task/{id}/abandon | 放弃 |

#### DailyQuestion

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /daily/today | 今日问题 |
| POST | /daily/answer | 回答 |

#### Report

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /report | 成长报告 |

#### Badge

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /badge | 我的奖章 |

### 10.3 错误码

| code | 含义 |
|---|---|
| 0 | 成功 |
| 1001 | 参数错误 |
| 1002 | 未登录 |
| 1003 | 权限不足 |
| 2001 | 资源不存在 |
| 3001 | AI调用失败 |
| 5000 | 服务器内部错误 |

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

1. 创建对话。
2. 用户发消息 → 后端调用DeepSeek流式返回。
3. 每轮抽取画像标签。
4. 维护追问计数器，超过3轮换维度。
5. 对话结束生成结论卡片。

### 11.5 痛点诊断与任务推荐

- 从画像标签中识别痛点。
- 映射到任务模板。
- 生成任务并推送。

### 11.6 成长任务打卡与画像更新

- 用户完成任务步骤 → 打卡。
- 记录反馈。
- 更新画像标签（行动力、自律性等）。
- 完成第一个任务 → 发奖章。

### 11.7 每日一问

- 每天生成1题。
- 用户点击即答。
- 累计7题触发画像微调。

### 11.8 简历生成/优化

- 上传PDF/Word → 解析文本 → DeepSeek分段。
- 引导式生成：五步表单。
- ATS评分：关键词规则+DeepSeek。
- 优化建议逐条展示。
- 画像回流：完整度、项目经验、技能栈。

### 11.9 模拟面试

- 选择模式与场景。
- DeepSeek基于简历出题。
- 每题后1-2轮追问。
- 结束生成复盘报告。
- 画像回流：技能、项目深度、知识盲区、沟通能力。

### 11.10 成长报告

- 聚合画像变化、完成任务数。
- 简单页面展示。

### 11.11 结论卡片

- 对话结束生成结构化诊断卡。
- 保存到报告。

### 11.12 奖章触发

- 完成第一个任务 → 起步行动家。

### 11.13 提醒

- 站内提醒或Electron通知。

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
| 任务提醒 | 每天10点 | 检查未打卡任务 |
| 奖章结算 | 每小时 | 检查奖章条件 |
| 数据清理 | 每周 | 清理过期临时文件 |

### 12.3 不做

- 双月复盘
- 画像衰减

---

## 第13章 文件存储与解析

### 13.1 本地磁盘存储

- 目录：`uploads/resumes/{user_id}/`
- 文件名：`{uuid}.pdf` 或 `.docx`
- 数据库存路径。

### 13.2 上传限制

- PDF/Word
- 最大10MB

### 13.3 解析

```python
import pdfplumber
from docx import Document

def parse_pdf(path):
    with pdfplumber.open(path) as pdf:
        return "\n".join(page.extract_text() for page in pdf.pages)

def parse_docx(path):
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs)
```

### 13.4 解析失败

- 提示用户切换引导式生成。
- 保留已识别信息。

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

- 用户只能访问自己的数据。

### 14.6 日志脱敏

- 不记录密码、API Key。

### 14.7 Prompt注入

- 系统Prompt与用户输入分离。
- 输出校验。

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
version: '3.8'
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: ai_career
      POSTGRES_USER: ai_user
      POSTGRES_PASSWORD: your_password
    volumes:
      - pgdata:/var/lib/postgresql/data
  app:
    build: ./backend
    env_file: .env
    depends_on:
      - db
    volumes:
      - ./uploads:/app/uploads
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./frontend/dist:/usr/share/nginx/html
    depends_on:
      - app
volumes:
  pgdata:
```

### 16.3 Nginx

反向代理 `/api` 到 app:8000，静态资源指向 frontend/dist。

### 16.4 启动

```bash
docker-compose up -d
```

### 16.5 备份

- pg_dump 定期备份。

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

1. 做一个入门级小项目
2. 挖掘三段校园经历
3. 每天1分钟口头复述
4. 完成一个基础技能学习
5. 完成一次职业深度对话
6. 完成一次面试小测试

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
| 如何修改DeepSeek模型？ | 修改 `deepseek_client.py` 中 model 字段 |
| 如何增加岗位？ | 在岗位关键词库中添加 |
| 如何导出报告？ | 浏览器打印 |

---

**文档结束**
