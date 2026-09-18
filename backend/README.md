# 高校学生AI就业辅助系统 · 后端骨架

FastAPI + **SQLite（默认）/ PostgreSQL（可切）** + DeepSeek 的后端，目录与规范对照
`docs/高校学生AI就业辅助系统-开发手册.md`（下称"手册"）。

> ✅ **已在 Python 3.12.10 + SQLite 上实际跑通**（本机无 PostgreSQL / Docker 也没关系）：
> 导入应用、建 16 张表、生成 OpenAPI、起 uvicorn 冒烟均通过。
> 实测记录与已知差异见 §5.1 与 §4.13。

---

## 1. 当前机器状态（先读这一节）

| 事实 | 影响 |
|---|---|
| ✅ 有 Python 3.12.10（`backend/venv` 已建好、依赖已装好） | 可以直接 `python -m app.db.init_db` / `uvicorn` 联调 |
| ✅ **数据库用 SQLite**（Python 自带驱动，零安装） | 不再需要 PostgreSQL 与 Docker |
| ❌ 没有 PostgreSQL 客户端、没有 Docker | SQLite 之外的能力（并发写、JSONB 索引）无法在本机验证 |
| ⚠️ 没有任何 Alembic 迁移脚本 | `migrations/versions/` 为空；SQLite 联调走 `create_all`，正式库再补迁移 |
| ⚠️ 没有 DeepSeek API Key | AI 能力走 7.6 兜底话术，未真实调用过模型 |

**因此：结构、import、建表、OpenAPI、HTTP 冒烟都已验证；AI 链路与 PG 路径未验证。**

---

## 2. 本机怎么跑起来（SQLite，零外部依赖）

### 2.1 本地开发（venv + SQLite + uvicorn）

```powershell
# 0) 本机 venv 已经建好、依赖已经装好，直接用即可（不要重复建第二个 venv）
cd backend
.\venv\Scripts\python.exe -V          # 应为 Python 3.12.x

# 1) 准备环境变量（手册 3.5）——默认值就是 SQLite，不填也能跑
Copy-Item .env.example .env
# 需要改的只有 SECRET_KEY 与 DEEPSEEK_API_KEY（不填 AI 会走兜底话术）

# 2) 建表（默认 SQLite：backend/data/app.db，幂等可反复执行）
.\venv\Scripts\python.exe -m app.db.init_db
#   常用参数：--no-seed 只建表 / --drop 先删表再建（危险）

# 3) 启动服务（手册 3.6）
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

首次安装依赖（**本机已做过，换机器才需要**）：

```powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m pip check          # 应输出 "No broken requirements found."
```

访问：

- 接口文档：<http://localhost:8000/docs>
- 健康检查：<http://localhost:8000/api/v1/health>
- 根信息：<http://localhost:8000/>

SQLite 库文件位置：`backend/data/app.db`（相对路径按 **backend/** 解析，目录自动创建；
已在 `.gitignore` 里忽略）。想看库内容可以用 `sqlite3` 或 DB Browser for SQLite。

### 2.2 Docker Compose 一键启动（手册 3.9 / 16.4）

```bash
# 在仓库根目录（不是 backend/）
copy backend\.env.example .env      # compose 的 env_file 指向仓库根 .env
docker-compose up -d                # 默认：SQLite，起 app + nginx（不含 db）
docker-compose run --rm migrate     # 建表（SQLite 下 = python -m app.db.init_db）

# 看日志（16.6）
docker-compose logs -f app
```

容器拓扑（与手册 16.2 的差异见 §6 的 ㉙）：默认是
`app(./backend)` + `nginx(nginx:alpine)`，数据库用 SQLite 卷 `sqlite_data`（容器内 `/data/app.db`）。
Nginx 反代 `/api` 到 `app:8000`，静态资源取 `frontend/dist`。

**想用 PostgreSQL**（生产建议）：

```bash
docker-compose --profile postgres up -d          # 额外起 db(postgres:16)
# 并把 .env（或 compose 里的 environment）的 DATABASE_URL 改成
#   postgresql://ai_user:your_password@db:5432/ai_career
# 同时把 app/migrate 的启动命令从 `python -m app.db.init_db` 换成 `alembic upgrade head`
```

> 为什么 PG 服务**保留**在 `postgres` profile 下而不是删掉：删掉等于把"切回生产库"的
> 路径也一起删了；profile 让它不参与默认 `docker-compose up`，既不拖慢本地联调，
> 又保证生产一键可切（代码侧只需改 `DATABASE_URL`）。

路径说明：`/api` 前缀的请求原样转发，所以 Nginx 后面就是
`http://<host>/api/v1/...`，与本地开发完全一致。

### 2.3 前端联调（手册 3.7 / 3.10）

前端跑在 `http://localhost:5173`，后端 CORS 默认已放开该来源
（`CORS_ORIGINS`，开发模式下额外允许 `*`）。

---

## 3. 目录结构（照抄手册 4.1，并标注骨架新增文件）

```text
backend/
├── app/
│   ├── main.py                     # FastAPI 入口：CORS / 路由 / 全局异常 / APScheduler
│   ├── core/
│   │   ├── config.py               # pydantic-settings 读 .env（手册 3.5）
│   │   ├── security.py             # JWT + bcrypt（6.8 / 14.2 / 14.3）
│   │   ├── deps.py                 # get_db / get_current_user / get_settings（6.4）
│   │   ├── errors.py               # ★新增：错误码表 + BusinessException（6.5 / 6.6）
│   │   └── api_response.py         # ★新增：ApiResponse.ok/fail 统一响应（6.5）
│   ├── models/                     # 16 张表的 SQLModel 模型（第 5 章）
│   │   ├── types.py ★               # 跨方言 JSON 列（PG=JSONB / SQLite=JSON，见 §4.13）
│   │   ├── user.py                 # users（+ 严格单调递增的 utcnow()）
│   │   ├── profile.py              # profiles, profile_tags
│   │   ├── test.py                 # test_results
│   │   ├── conversation.py         # conversations, messages
│   │   ├── resume.py               # resumes
│   │   ├── interview.py            # interviews, interview_questions
│   │   ├── task.py                 # tasks, task_steps
│   │   ├── daily_question.py       # daily_questions, daily_answers
│   │   ├── report.py               # reports
│   │   └── badge.py                # badges, user_badges
│   ├── schemas/                    # XxxRequest / XxxResponse / XxxCreate / XxxUpdate（6.3）
│   │   ├── common.py               # 统一响应信封出口
│   │   ├── user.py  profile.py  test.py  chat.py  resume.py
│   │   ├── interview.py  task.py  daily_question.py  report.py  badge.py
│   │   ├── home.py ★  event.py ★   # 设计说明书 5.4 补实现的接口契约
│   ├── api/
│   │   ├── router.py               # /api/v1 总路由（6.2 / 6.9）
│   │   └── v1/
│   │       ├── auth.py  test.py  profile.py  chat.py  resume.py
│   │       ├── interview.py  task.py  daily_question.py  report.py  badge.py
│   │       ├── home.py ★  events.py ★   # 补实现：/home/summary、/events
│   ├── services/                   # 业务逻辑（6.1）
│   │   ├── auth_service.py  profile_service.py（含测试表）  chat_service.py
│   │   ├── idempotency.py ★        # client_msg_id 幂等（设计文档 4.3，见第 6 节 ⑤）
│   │   ├── resume_service.py  interview_service.py  task_service.py
│   │   ├── daily_question_service.py  report_service.py  badge_service.py
│   │   ├── home_service.py ★  event_service.py ★   # 补实现（见 §4.8 / §4.9）
│   ├── ai/
│   │   ├── deepseek_client.py      # httpx 直连 + 流式 + 结构化 + 兜底（7.1/7.2/7.3/7.6）
│   │   ├── parser.py               # Prompt 加载 + JSON 抠取 + 校验（7.3）
│   │   ├── schemas.py              # ★新增：AI 输出契约（Pydantic）
│   │   ├── fallbacks.py            # ★新增：兜底话术与默认值（7.6）
│   │   └── prompts/
│   │       ├── chat_system.txt     # 7.5 原文，一字未改
│   │       ├── profile_extract.txt  resume_parse.txt  resume_optimize.txt
│   │       ├── interview_question.txt  interview_followup.txt
│   │       ├── interview_review.txt  task_generate.txt  daily_question.txt
│   │       └── chat_conclusion.txt # ★新增（11.11 结论卡片用，7.4 未列）
│   ├── tasks/
│   │   ├── scheduler.py            # APScheduler 注册（12.1 / 12.2）
│   │   ├── daily_question_job.py  reminder_job.py  badge_job.py
│   │   └── cleanup_job.py          # ★新增：12.2「数据清理」那一条
│   ├── utils/
│   │   ├── file.py  text.py  logger.py
│   │   └── stage.py                # ★新增：阶段判定与加权总分（附录B）
│   └── db/
│       ├── session.py              # engine / SessionLocal（同步 psycopg2）
│       └── init_db.py              # 种子数据占位（5.4，不造假数据）
├── migrations/                     # ★Alembic（5.5）：env.py / script.py.mako / versions/
├── alembic.ini                     # ★Alembic 配置
├── uploads/                        # 简历文件（13.1）
├── tests/                          # 占位说明（骨架阶段不写测试）
├── requirements.txt                # 固定版本（未验证）
├── .env.example                    # 3.5 全部变量
├── Dockerfile                      # 16.2 的 app 镜像
└── README.md                       # 本文件
```

★ = 手册目录树里没有、但为了满足手册其它章节要求而补的文件（见第 6 节「待确认」）。

---

## 4. 关键设计说明

### 4.1 统一响应与异常

- `app/core/api_response.py` 提供 `ApiResponse[T]`（泛型信封）与 `ok(data)` / `fail(code, message)`。
- 路由写法：`response_model=ApiResponse[XxxResponse]`，函数内 `return ApiResponse.ok(payload)`。
  这样既满足 6.5 / 10.1 的统一 `{code,message,data}`，又让 `/docs` 里能看到 `data` 的真实结构。
- `app/core/errors.py` 定义 `ErrorCode`（0/1001/1002/1003/2001/3001/5000）、`BusinessException`
  与 `HTTP_STATUS_TO_CODE` 映射表。
- `app/main.py` 注册四类 handler（**HTTP 状态码分层，FIX 3**）：

| 异常 | HTTP 状态 | 响应体 |
|---|---|---|
| `BusinessException`（默认，无 `status_code`） | **200**（照 6.6） | `{code: 业务码, message, data}` |
| `BusinessException.param_error / unauthorized / forbidden / not_found / internal` | **400 / 401 / 403 / 404 / 500** | `{code: 1001/1002/1003/2001/5000, message, data}` |
| `RequestValidationError` | **200** | `{code: 1001, message, data.errors[]}` |
| `StarletteHTTPException` | **保留原始状态码** | `{code: 映射码, message, data: null}` |
| 未捕获 `Exception` | **500** | `{code: 5000, message: "服务器内部错误", data: null}` |

覆盖的映射：`400/405/409/413/415/422/429 → 1001`、`401 → 1002`、`403 → 1003`、`404 → 2001`、
`500/502/503 → 5000`、`504 → 3001`。

**为什么不全 200（对 6.6 的适用范围澄清）**：6.6 的示例只讲 `BusinessException`，
并没有要求 `HTTPException` 也变成 200。如果连 404/401/500 都返回 200：

- 浏览器、Nginx、Electron 客户端、未来的监控告警、`curl -f` 全都分不清「成功」和「服务挂了」；
- `get_current_user` 抛的未登录必须是**真正的 401**，否则前端 401 拦截器、标准 HTTP
  缓存/重试中间件全部失效。

因此现在的分工是：**传输层语义用 HTTP 状态码，业务语义用信封 `code`**。
前端拦截器建议：

```ts
// 成功路径（HTTP 2xx）：按信封 code 判业务成败
// 错误路径（HTTP 4xx/5xx）：读 error.response.data 里的信封，同样按 code 分派
```

> 注意 HTTP 200 仍然可能携带失败的业务码（例如 1001「该消息正在生成回复」），
> 所以「拿到 200 即成功」这个判断在前端是不成立的，必须看 `code`。

### 4.2 画像回流（7.8）预留位置

统一入口是 `profile_service.apply_tags()`（同维度同标签权重融合）+ `recompute_stage()`。
异步 AI 抽取入口是 `profile_service.extract_tags_from_text(text, source=...)`。

| 触发点 | 位置 | source |
|---|---|---|
| 测试表提交 | `profile_service.submit_test()`（选择题映射标签；文字补充留了 TODO 调用点） | `test` |
| 每轮对话 | `chat_service._extract_round_tags(conversation_id, user_id)`（`send_message` 与 SSE `stream_reply` 都调用） | `chat` |
| 简历解析 / 优化 | `resume_service._extract_resume_tags()`（技能规则 + AI 痛点抽取） | `resume` |
| 面试复盘 | `interview_service.finish_interview()`（复盘结果自带 `tags`；复盘 Prompt 负责产出） | `interview` |
| 任务打卡 | `task_service._extract_task_tags()`（行动力规则 + 反馈 AI 抽取） | `task` |
| 每日一问 | `daily_question_service.answer_question()`（累计 7 题触发，11.7） | `daily` |
| 简历完整度 | `profile_service.update_resume_score()`（11.8 简历 -> resume_score） | — |

阶段重算按附录B：`total = 0.4*clarity + 0.35*action + 0.25*resume`，
`0-30 探索期 / 31-65 准备期 / 66-100 冲刺期`（`app/utils/stage.py`）。

### 4.3 SSE 接口长什么样

> 完整契约见第 10 节「SSE 契约」；这里只讲实现要点。

两个端点，**共用同一份事件生成器**（`app/api/v1/chat.py::_event_generator`），事件序列完全一致：

| 端点 | 用途 | body |
|---|---|---|
| `POST /api/v1/chat/conversations/{id}/stream` | **前端正式使用**（fetch + ReadableStream） | `ChatRequest` JSON：`{content, client_msg_id?}` |
| `GET /api/v1/chat/conversations/{id}/stream?content=...` | **调试用**（curl / 手册 8.4 的 EventSource 兜底） | 无（query 参数） |

实现要点：

1. **POST 是给前端用的**：`EventSource` 既不能带 `Authorization` 头也不能带 body，
   所以前端用 `fetch` + `ReadableStream` 消费 POST 端点。GET 端点保留只为 curl 调试。
2. **用户消息先落库再开流**：两个端点都走 `chat_service.prepare_stream()`，
   在请求级 Session 还活着时把用户消息 `commit` 掉，再做幂等判断与 LLM 上下文组装。
3. **幂等（设计文档 4.3）**：`client_msg_id` 重复提交时不会插第二条用户消息、也不会再调 AI，
   只回一个 `pending` 事件（详见 §10.4）。
4. **流结束后**把完整回复落库，并按 7.7 截断到 300 字；7.6 兜底时逐字吐兜底话术。
5. **生成器自开数据库会话**（FIX 2，坑的完整说明见 §10.5）。
6. Nginx 侧必须 `proxy_buffering off` + `proxy_request_buffering off`（已写在 `nginx.conf`），
   否则 SSE 会被攒着一起发、POST body 会被缓冲。
7. SSE 响应**不能**包 `ApiResponse` 信封（它不是 JSON），但每个事件的 `data` 仍是
   `{code,message,data}` 信封（见 `app/schemas/chat.py::SSEEvent`）。

### 4.4 AI 集成
- `deepseek_client.chat()`：7.1 的 httpx 直连，超时 60s。
- `stream_chat()`：7.2 流式，逐块 yield 文本增量；失败不抛错，yield 兜底话术。
- `chat_json()/chat_prompt_json()`：7.3 结构化输出，要求 `response_format=json_object`，
  解析 → Pydantic 校验 → **失败重试 1 次 → 仍失败用默认值**（7.6）。
- `parser.extract_json()`：容忍 ```json 代码块、前后解释文字、尾随逗号。
- Prompt 模板 9 个（7.4 全覆盖）+ 1 个补充（`chat_conclusion`），`load_prompt()` 带 LRU 缓存。
- 兜底话术与过渡语 30 条分别在 `ai/fallbacks.py` 与 `utils/text.py`（7.7）。

### 4.5 定时任务（第 12 章）

| job | 文件 | 频率 |
|---|---|---|
| 每日一问生成 | `tasks/daily_question_job.py` | 每天 0 点 |
| 任务提醒 | `tasks/reminder_job.py` | 每天 10 点 |
| 奖章结算 | `tasks/badge_job.py` | 每小时 |
| 数据清理 | `tasks/cleanup_job.py` | 每周日 3 点 |

在 `app/main.py` 的 lifespan 启动时注册并 `start()`，关闭时 `shutdown()`。
定时任务起不来**不会**导致服务无法启动（只记 error 日志）。

### 4.6 SSE 契约（前端照此对接）

> **契约状态：已决策（FIX 1 / FIX 4）**。两个端点共用同一份事件生成器，
> 事件序列、事件字段、结束标记完全一致。改动本契约必须同时改
> `app/api/v1/chat.py`、`app/schemas/chat.py` 与本节。

#### 4.6.1 两个端点

| | POST（**前端使用**） | GET（**调试用，前端不调用**） |
|---|---|---|
| 路径 | `/api/v1/chat/conversations/{conversation_id}/stream` | 同路径 |
| 方法 | `POST` | `GET` |
| 入参 | JSON body（与 `POST .../messages` **同一 schema** `ChatRequest`） | query 参数 `content` |
| 鉴权 | `Authorization: Bearer <token>` | 同左（**EventSource 做不到**，所以才要 POST） |
| 幂等 | 支持 `client_msg_id` | 不支持（无 body） |
| 备注 | `summary` 标注「前端使用」 | `summary` 标注「调试用，前端不调用」 |

请求体（`ChatRequest`，两个写消息的端点共用）：

```json
{
  "content": "我有点迷茫，不知道做什么",
  "client_msg_id": "8f14e45f-ea0b-4c0e-9d6a-2b1c3d4e5f60"
}
```

- `content`：必填，1–2000 字。
- `client_msg_id`：可选，≤64 字，**建议前端为每次「发送动作」生成一个 UUID，
  重试（网络抖动、用户手抖再点）时复用同一个值**。不传则无幂等保护。

请求头：

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: text/event-stream
```

响应头：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

#### 4.6.2 线格式

每个事件两块 + 一个空行：

```
event: <type>\n
data: <JSON>\n
\n
```

`data` 里的 JSON **恒为 10.1 的信封** `{code, message, data}`；内层 `data.type`
与 `event:` 行始终相同，前端任选其一分派。流末尾固定补：

```
event: end
data: [DONE]
```

#### 4.6.3 完整事件序列（正常一轮）

假设会话已经围绕「兴趣」聊了 2 轮，这是第 3 轮：

| # | event | data（信封内的 data） | 说明 |
|---|---|---|---|
| 1 | `start` | `{"type":"start","conversation_id":"<uuid>","followup_round":2,"followup_direction":"兴趣"}` | 流已建立，前端切「生成中」态；`followup_round` = **这一轮开始前**的值 |
| 2..n | `delta` | `{"type":"delta","content":"增量文本","conversation_id":"<uuid>","followup_round":2,"followup_direction":"兴趣"}` | 追加到当前气泡；可能 0..n 次；轮次值同 `start` |
| n+1 | `tag` | `{"type":"tag","data":{"tags":[{"dimension":"痛点","label":"缺项目","weight":0.8,...}]}}` | 仅当本轮抽到新画像标签时出现，可能没有。**这张标签决定下一轮的 `followup_direction`** |
| n+2 | `done` | `{"type":"done","message_id":"<uuid>","conversation_id":"<uuid>","conclusion_ready":false,"followup_round":3,"followup_direction":"兴趣"}` | 本轮结束；`followup_round` = **本轮更新后**的值 |
| n+3 | `end` | 字面量 `[DONE]`（非 JSON） | 流结束标记；前端据此关闭 ReadableStream |

各事件的完整线上样例（含信封）：

```
event: start
data: {"code":0,"message":"success","data":{"type":"start","conversation_id":"5c0f...","followup_round":2,"followup_direction":"兴趣"}}

event: delta
data: {"code":0,"message":"success","data":{"type":"delta","content":"嗯，我理解了。","conversation_id":"5c0f...","followup_round":2,"followup_direction":"兴趣"}}

event: tag
data: {"code":0,"message":"success","data":{"type":"tag","data":{"tags":[{"dimension":"痛点","label":"缺项目","weight":0.8}]}}}

event: done
data: {"code":0,"message":"success","data":{"type":"done","message_id":"a1b2...","conversation_id":"5c0f...","conclusion_ready":false,"followup_round":3,"followup_direction":"兴趣"}}

event: end
data: [DONE]
```

#### 4.6.4 异常与边界事件

| 场景 | 事件 | data |
|---|---|---|
| AI 中断（7.6 兜底） | `error`（随后 `end`） | `{"code":3001,"message":"AI回复中断，已切换兜底话术","data":null}`；正文里已经吐了兜底话术 |
| 服务端未捕获异常 | `error`（随后 `end`） | `{"code":5000,"message":"服务器内部错误","data":null}` |
| 幂等命中（**另起一条流**） | `pending`（随后 `end`） | 上一轮已完成：`{"code":0,"message":"该消息已提交过，未重复生成","data":{"type":"pending","replay_message_id":"<uuid>"}}`；上一轮还在生成：`{"code":0,...,"data":{"type":"pending","pending":true}}` |
| 未登录 / 会话不属于自己 / 会话不存在 | **不开流**，直接返回 JSON 错误 | `401 {code:1002}` / `404 {code:2001}`（见 §4.1，FIX 3 后是真状态码） |
| 7.6 拒绝回答 / 答不上来 | 正常 `delta`（内容来自本地模板，不调模型） | — |

前端建议处理：`pending` 事件不要弹错误；有 `replay_message_id` 时拉一次
`GET /chat/conversations/{id}/messages` 对齐，没有就等上一轮的流。

#### 4.6.5 字段说明（FIX 4 + 追问计数器）

| 字段 | 类型 | 出现位置 | 说明 |
|---|---|---|---|
| `type` | string | 所有事件 | `start`/`delta`/`tag`/`done`/`error`/`pending` |
| `content` | string | `delta` | 增量文本，直接追加 |
| `conversation_id` | uuid | `start`/`delta`/`done`/`pending` | 便于前端校验是否串了会话 |
| `message_id` | uuid | `done` | 本轮 assistant 消息 id，用于对齐消息列表 / 触发「结论卡片」拉取 |
| `conclusion_ready` | bool | `done` | 本轮结束后是否已有结论卡片。`true` 时前端调 `GET /chat/conversations/{id}/conclusion` 直接命中缓存（否则该接口会现生成一次，较慢） |
| `followup_round` | int \| null | `start`/`delta`/`done` | 同方向追问轮次（**1 起**）。`start`/`delta` = **这一轮开始前**的值；`done` = **本轮更新后**的值。见下方语义 |
| `followup_direction` | string \| null | `start`/`delta`/`done` | 当前挖掘维度（兴趣/能力/技能/痛点/焦虑/认知）。`done` 里的值若与上一轮不同，说明**已换维度** |
| `data.tags` | array | `tag` | 本轮新抽到的画像标签（已写库），也是下一轮维度的依据 |

**`followup_round` 的真实语义（7.7）**

追问计数是**会话级状态**，存在 `conversations` 表上（`followup_direction` +
`followup_round` 两列，授权补列，见第 6 节 ⑤⑥），不是单条消息的属性。推进规则：

1. 每轮结束后，从 `_extract_round_tags()` 抽到的标签里算**主导维度**：
   先比该维度下标签**权重之和**，权重和相同比**标签条数**，仍相同按
   `痛点 → 技能 → 能力 → 兴趣 → 焦虑 → 认知` 的固定优先级取（保证结果确定）。
2. 主导维度 == 当前 `followup_direction` → `followup_round += 1`（+1）。
3. 主导维度 != 当前方向，或当前为空 → `followup_direction = 新维度`，
   `followup_round = 1`（**重置**，前端进度环回到 1）。
4. 达到 **3 轮**时，下一轮的 system Prompt 会被注入硬约束指令
   （「已经连续 3 轮围绕『X』追问，本轮必须换到另一个维度」），不靠模型自觉。
5. **拿不到标签**（AI 兜底 / 解析失败 / 没有正式维度）→ 保持原值不变，**不清零**。

**`followup_round` 什么时候是 `null`**：只有当会话**还没开始计数**（`followup_direction`
为空且 `followup_round = 0`，即第一轮还没拿到过标签）时对外返回 `null`，前端此时隐藏进度环；
其余情况都是真实整数。

前端进度环的建议用法：

```ts
// start/delta：画"这一轮开始前"的进度
// done：把进度更新为 done.followup_round
// done.followup_direction 与上一轮不同 -> 说明换维度了，进度环应重置为 1（后端已给 1）
// followup_round === null -> 隐藏进度环（新会话首轮、或本轮没抽到标签）
```

#### 4.6.6 前端消费参考（fetch + ReadableStream）

```ts
const res = await fetch(`/api/v1/chat/conversations/${id}/stream`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    Accept: 'text/event-stream',
  },
  body: JSON.stringify({ content, client_msg_id: crypto.randomUUID() }),
});
if (!res.ok) {
  // FIX 3：401/404 等是真状态码，错误信封在 body 里
  const err = await res.json();
  throw new Error(`[${err.code}] ${err.message}`);
}

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buf = '';
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  // SSE 以空行分隔事件块
  const blocks = buf.split('\n\n');
  buf = blocks.pop() ?? '';
  for (const block of blocks) {
    const lines = block.split('\n');
    const eventLine = lines.find((l) => l.startsWith('event: '));
    const dataLine = lines.find((l) => l.startsWith('data: '));
    const event = eventLine?.slice(7).trim();
    const raw = dataLine?.slice(6) ?? '';
    if (raw === '[DONE]') return;
    const payload = JSON.parse(raw);       // {code, message, data}
    if (payload.code !== 0) { /* 按 code 处理错误 */ continue; }
    dispatch(event, payload.data);          // data.type 与 event 一致
  }
}
```

> 注意：**不要用 `EventSource`**。它无法设置 `Authorization` 头，也无法带 POST body；
> 手册 8.4 的 `EventSource` 写法只适用于本仓库的 GET 调试端点（且无法鉴权除非用 cookie）。

### 4.7 「有没有画像」不等于「做没做过测评」（`ProfileResponse.tested`）

`GET /api/v1/profile` 走 `get_or_create_profile()`，**永远会创建并返回一个画像对象**。
所以前端**不能**用「有没有 profile 对象」判断用户是否做过基础测试表 ——
这个判据恒为 `true`，「新用户强制去 `/test/intro`」的漏斗永远不会触发，
新注册用户会直接掉进首页。

新增字段：

```python
class ProfileResponse(BaseModel):
    ...
    tested: bool = Field(
        default=False,
        description="是否已完成基础测试表（依据 test_results 是否存在）",
    )
```

- 真实值由 `profile_service.has_finished_test(db, user_id)` 计算：
  查 `test_results` 表有没有该 `user_id` 的记录，只 `SELECT id ... LIMIT 1`
  （不拉整行），在 `get_profile()` 里**只调用一次**再复用（无 N+1）。
- `GET /profile/tags` 返回的是标签数组、`POST /profile/feedback` 返回的是
  `ProfileResponse` —— 后者内部就是 `get_profile()`，所以 `tested` 语义一致。
- `POST /test/submit` 成功后 `test_results` 落库，`tested` **自然变 `true`**，
  不需要额外写任何东西。

**前端建议的守卫写法**：

```ts
const profile = await getProfile();
if (!profile.tested) router.replace('/test/intro');  // ✅ 正确
// if (!profile) router.replace('/test/intro');      // ❌ 永远不会触发
```

### 4.8 `GET /api/v1/home/summary` 首页聚合

> 来源：设计说明书 5.4，手册 10.2 未列，按用户要求补实现（第 6 节 ⑨）。
> 实现：`app/api/v1/home.py` + `app/services/home_service.py` + `app/schemas/home.py`。

**为什么需要**：前端首页原本要串行发 4 个请求（profile / task / daily / conversations），
慢且没法做「下一步建议」的统一决策。现在一次拿全。

请求：`GET /api/v1/home/summary`，需要 `Authorization: Bearer <token>`，无 query/body。

响应（统一信封内）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "stage": "explore",
    "stage_label": "探索期",
    "profile": {
      "clarity_score": 0,
      "action_score": 0,
      "resume_score": 0,
      "total_score": 0,
      "stage": "explore",
      "tested": false
    },
    "tags": [
      { "dimension": "痛点", "label": "缺项目经验", "weight": 0.8, "source": "chat" }
    ],
    "daily_question": {
      "id": "uuid",
      "content": "……",
      "options": [ { "key": "A", "text": "…", "weight": 3 } ],
      "answered": false
    },
    "ai_findings": [
      {
        "pain_point": "缺项目经验",
        "label": "缺项目经验",
        "reason": "AI 在对话里注意到：我还没做过完整的项目",
        "target_route": "/task"
      }
    ],
    "ongoing_tasks": [
      {
        "id": "uuid",
        "title": "做一个入门级小项目",
        "difficulty": "中等",
        "estimated_days": 3,
        "done_steps": 2,
        "total_steps": 4,
        "current_step_title": "写出最简版本"
      }
    ],
    "next_action": {
      "text": "先花 5 分钟做个小测试",
      "route": "/test/intro",
      "reason": "还没有你的画像，先做个测试我才能给你靠谱的建议"
    }
  }
}
```

**字段说明**

| 字段 | 类型 | 说明 |
|---|---|---|
| `stage` | string | 阶段 slug：`explore` / `prepare` / `sprint`（由 `utils/stage.to_stage_slug()` 从中文阶段映射，未知值兜底 `explore`） |
| `stage_label` | string | 附加字段：阶段中文名（探索期/准备期/冲刺期），方便前端直接展示，可不用 |
| `profile` | object | 画像精简版；**不含 tags/user**（tags 平铺在顶层，避免响应过重） |
| `profile.tested` | bool | 是否做过基础测试表。前端守卫必须用它（见 §4.7） |
| `tags` | array | 画像标签，按权重降序，最多 20 条 |
| `daily_question` | object \| **null** | 今日一问；无题时整个对象为 `null`（契约允许） |
| `daily_question.options` | array | 已把 `daily_questions.options` 的 JSONB（`{"options": [...]}`）**归一化成数组** |
| `ai_findings` | array | AI 主动发现，最多 **3** 条（取 `痛点` 维度权重最高的）；没有则**空数组，不报错** |
| `ai_findings[].reason` | string | 优先引用标签 `extra` 里的证据原文；没有证据时给中性说明，**不编造经历** |
| `ai_findings[].target_route` | string | 点了去哪：`/chat` `/task` `/resume` `/interview`（关键字规则见下） |
| `ongoing_tasks` | array | 进行中任务，最多 **2** 条 |
| `ongoing_tasks[].done_steps` / `total_steps` | int | 由**一条 `GROUP BY` 查询**批量算出（不是每条任务查一次） |
| `ongoing_tasks[].current_step_title` | string \| null | 第一条未完成步骤的标题（**一条批量查询**取出所有未完成步骤后每任务取首条） |
| `next_action` | object | **后端决定的下一步**，前端不要自己判断优先级 |

**痛点 → 建议落点（`ai_findings[].target_route`）的规则**

按关键字命中，先匹配到的先赢；都不命中落到 `/task`：

| 顺序 | 关键字 | 路由 |
|---|---|---|
| 1 | 迷茫 / 方向 / 认知 / 焦虑 / 不知道 | `/chat` |
| 2 | 简历 / 经历 / 量化 / 成果 / 表达 | `/resume` |
| 3 | 面试 / 紧张 / 沟通 / 提问 | `/interview` |
| 4 | 缺项目 / 项目 / 实习 / 技能 / 证书 / 竞赛 | `/task` |
| — | 其它 | `/task`（默认） |

定义在 `home_service.PAIN_ROUTE_RULES`，改动请同步本表。

**`next_action` 判定规则（按顺序取第一个命中，这就是产品「AI 主动性」的落点）**

| 顺序 | 条件 | `text` | `route` |
|---|---|---|---|
| 1 | `tested == false`（没做测评） | 先花 5 分钟做个小测试 | `/test/intro` |
| 2 | 有进行中的任务 | 继续：`<任务名>` | `/task/<id>` |
| 3 | `stage == explore` | 和 AI 聊聊我的方向 | `/chat` |
| 4 | `stage == prepare` | 继续完善我的简历 | `/resume` |
| 5 | `stage == sprint` | 来一次全真模拟面试 | `/interview` |
| 6 | 其它（异常/空数据） | 和 AI 聊聊我的方向 | `/chat` |

`reason` 字段每个分支都给了给用户看的一句话解释。规则**写死在
`home_service.decide_next_action()`**（附优先级注释），后续可替换为 AI 生成
（`HomeNextAction` 结构不变，前端无需改动）——这就是产品「AI 主动性」的落点。

**可靠性**：`get_home_summary()` 外层有 `try/except`，聚合失败时返回兜底结构
（`_fallback_summary`）+ 记 error 日志，**绝不会因为首页聚合失败让用户看到空白或 500**。
兜底时会再单独试一次「有没有做测评」，连它也失败就保守返回 `tested=false`，
即引导用户去做测评（对任何用户都无害）。

**性能**：一次请求内的查询数是固定的（画像 1 + tested 1 + 标签 1 + 任务 1 +
步骤统计 1 + 未完成步骤 1 + 每日一问 1~2），**没有任何 N+1**。

### 4.9 `POST /api/v1/events` 行为埋点上报

> 来源：设计说明书 5.4，手册 10.2 未列，按用户要求补实现（第 6 节 ⑩）。
> 实现：`app/api/v1/events.py` + `app/services/event_service.py` + `app/schemas/event.py`。

用途：采集「无感采集」的原始信号（跳题、放弃任务、忽略建议、每日一问、对话轮次），
后续用于画像回流参考。需要登录，事件归属当前用户。

**两种请求形状都接受**（前端可能单条也可能批量）：

```jsonc
// 单条
{ "event": "test_skip", "payload": { "question_id": "..." }, "client_ts": "2026-09-18T10:00:00Z" }

// 批量
{ "events": [ { "event": "test_skip", "payload": {}, "client_ts": "2026-09-18T10:00:00Z" } ] }
```

**union 解析写法**（`app/schemas/event.py::EventSubmitRequest`）：
用 `model_validator(mode="before")` 在入参进模型之前**做形状归一化**，
把单条塞进 `events` 列表，下游只有一条代码路径；再用
`model_validator(mode="after")` 校验「至少有一条」。

没有用 `Union[EventItem, EventBatchRequest]` 的原因（写在代码注释里）：

1. pydantic v2 的 union 是"smart mode"逐成员尝试，两个成员字段高度重叠时
   报错信息会退化成难以定位的 union 错误，前端拿到没有指向性的 422；
2. 单条与批量本质只是「列表长度为 1」的差别，归一化后逻辑更简单；
3. 校验必须**宽松**（埋点失败不能影响业务）。

**约束**

| 项 | 规则 |
|---|---|
| 鉴权 | 必须登录（`get_current_user`） |
| 事件名 | **不做白名单校验**，未知事件名照收（前端会持续新增事件） |
| `payload` | 任意 JSON，宽松校验（`dict = Field(default_factory=dict)`，不 strict） |
| `client_ts` | 可选 ISO8601（支持 `Z` 后缀）；缺失时服务端只记 `server_ts` |
| 单批上限 | **50** 条，超出**截断**并记 warning（不静默丢弃也不报错） |
| 响应 | 固定 `{"code":0,"message":"success","data":null}`（统计值只进服务端日志） |
| 失败影响 | **零**：路由与 service 双层 try/except，任何异常只记 warning |

**存储策略（重要限制）**：骨架阶段**只写结构化日志，不建表、不持久化**。
手册 5.3 没有事件表，擅自建表属于范围扩张。日志格式：

```
EVENT user_id=<uuid> event=test_skip client_ts=<iso> server_ts=<iso> payload={...}
```

（`payload` 走 `utils/logger.sanitize` 脱敏，单条限长 2000 字符，见 14.6。）

**要做真正的行为分析，需要补一张 `events` 表**（属于手册 5.3 变更）：
建议字段 `id / user_id / event VARCHAR(100) / payload JSONB / client_ts / created_at`，
然后改 `event_service.record_events()` 落库、`count_events_today()` 从占位变成真查询。
当前接口签名已经为这一步留好了（`record_events(db, user, items)` 收了 `db` 但暂未使用）。

### 4.10 简历文件访问：只走鉴权端点，**禁止静态目录直出**（安全修复）

#### 4.10.1 曾经的漏洞

`app/main.py` 里曾经有这么一行：

```python
application.mount("/uploads", StaticFiles(directory=str(get_upload_root())), name="uploads")
```

它把整个 `uploads/` 目录变成了**公开静态资源**。后果：

- **任何人（未登录也行）**只要请求 `GET /uploads/resumes/{user_id}/{uuid}.pdf`
  就能下载别人的简历；
- 简历含姓名、手机号、学校、专业、实习与项目经历 —— 典型 PII；
- `resumes.file_path` 形如 `resumes/{user_id}/{uuid}.pdf`，**路径里就带 user_id**，
  攻击者连猜用户名都不用，遍历 UUID 即可；
- 直接违反手册 **14.5「用户只能访问自己的数据」** 与 **14.1「数据保密」**。

**为什么不能"只在 DEBUG 挂载"**：开发库/演示环境里同样放的是真实简历，
而且前端一旦依赖了这个路径，上线时改起来更贵。**一刀切掉。**

#### 4.10.2 现在的做法

`uploads/` 不再有任何静态挂载（`main.py` 里删掉了 `StaticFiles` 那一段，
nginx 里也删掉了 `/uploads/` 的 location，compose 里不再把它挂给 nginx 容器）。
简历文件**只有**一个读取入口：

```http
GET /api/v1/resume/{resume_id}/file
Authorization: Bearer <access_token>
```

```python
@router.get("/{resume_id}/file", summary="下载/预览简历文件（鉴权）", response_class=FileResponse)
async def download_resume_file(
    resume_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    info = resume_service.get_resume_file(db, current_user, resume_id)
    return FileResponse(
        path=info.path,
        media_type=info.media_type,
        filename=info.filename,
        content_disposition_type="inline",   # 内嵌预览；要强制下载改 "attachment"
    )
```

服务层 `resume_service.get_resume_file()` 做了四件事：

| # | 检查 | 行为 |
|---|---|---|
| 1 | 归属 | 不存在**或不属于当前用户**都抛 `2001`（**不是 1003**），由 `app.core.errors.not_found_unless_owner` 统一实现（全仓库规则，见 §8） |
| 2 | 路径越界 | 交给 `file_utils.resolve_download_path()`，规范化后必须仍在 `UPLOAD_DIR` 之内，越界按"不存在"拒绝 + error 日志 |
| 3 | 文件缺失 | 数据库有记录但磁盘文件没了 -> `2001` + `logger.warning` 记 `resume_id`（便于排查误删/迁移丢文件） |
| 4 | 下载名 | `file_utils.build_download_filename(title, ext)` 清洗后再进响应头 |

响应头：`Content-Type` 按扩展名给
（`.pdf` → `application/pdf`；`.docx` →
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`），
`Content-Disposition: inline; filename="..."`（中文名由 Starlette 按 RFC 5987 编码）。

这是二进制响应，**不套** `ApiResponse` 信封（与 SSE 同理）。

#### 4.10.3 目录穿越校验的写法（`app/utils/file.py`）

```python
def is_within_upload_dir(path: Path) -> bool:
    """path 规范化之后是否仍位于 UPLOAD_DIR 之内（含其自身）。"""
    try:
        root = get_upload_root().resolve()
        candidate = path.resolve()          # 展开 .. 与符号链接
    except OSError as exc:
        logger.warning("路径规范化失败: %s (%s)", path, exc)
        return False
    # 用「父目录链里有没有 root」判断，而不是字符串 startswith
    # （后者会把 /data/uploads-evil 误判为在 /data/uploads 之内）
    return candidate == root or root in candidate.parents


def resolve_download_path(stored_path: str) -> Path:
    """把数据库里的 file_path 解析成可下载路径，并强制校验不越界。"""
    if not stored_path or not str(stored_path).strip():
        raise BusinessException.not_found("简历文件不存在")
    candidate = resolve_stored_path(str(stored_path))
    if not is_within_upload_dir(candidate):
        logger.error("拒绝越界的文件路径（疑似目录穿越）: %s", stored_path)
        raise BusinessException.not_found("简历文件不存在")   # 不向调用方暴露真实原因
    return candidate.resolve()
```

两个关键点：① 先 `resolve()` 再比较，`../` 和符号链接都被展开；
② 用路径层级（`root in candidate.parents`）而不是字符串前缀比较，
否则 `uploads-evil/` 这种同前缀目录会被错误放行。
绝对路径逃逸（`file_path = "C:\\Windows\\win.ini"`）同样会被这一步拦下。

#### 4.10.4 上传侧的限制（手册 13.2，本次核对）

三项都已落地（**不是本次新加**，是核对确认）：

**① 扩展名白名单：只允许 `.pdf` / `.docx`，旧版 `.doc` 明确拒绝并给中文提示**
（`app/utils/file.py::validate_upload`）：

```python
ALLOWED_EXTENSIONS = {".pdf", ".docx"}

def validate_upload(filename, size, content_type=None) -> str:
    ext = Path(safe_filename(filename)).suffix.lower()
    if ext == ".doc":
        # 单独提示：python-docx 读不了旧的二进制 .doc
        raise BusinessException.param_error("不支持旧版 .doc，请在 Word 里另存为 .docx 后重新上传")
    if ext not in ALLOWED_EXTENSIONS:
        raise BusinessException.param_error("仅支持 PDF / .docx 文件")
    if content_type and content_type not in ALLOWED_CONTENT_TYPES:
        logger.warning(...)          # content_type 由客户端控制，只记日志不拒绝
    if size > settings.MAX_UPLOAD_SIZE:
        raise BusinessException.param_error(f"文件超过大小限制 {...}MB")
    return ext
```

**② 大小上限取 `MAX_UPLOAD_SIZE`（默认 10MB），超限报 1001 而不是 500**
（`app/api/v1/resume.py::_read_upload`，**边读边判**，避免先落盘一个大文件）：

```python
_CHUNK_SIZE = 1024 * 1024

async def _read_upload(file: UploadFile) -> bytes:
    chunks, size = [], 0
    while True:
        chunk = await file.read(_CHUNK_SIZE)
        if not chunk:
            break
        size += len(chunk)
        if size > settings.MAX_UPLOAD_SIZE:
            raise BusinessException.param_error(f"文件超过大小限制 {...}MB")   # code 1001
        chunks.append(chunk)
    return b"".join(chunks)
```

`BusinessException.param_error` → HTTP 400 + `code 1001`（不是 500）。
上传接口还会对空文件单独判一次（`code 1001`）。
Nginx 侧另有 `client_max_body_size 12m` 兜住超大请求体。

**③ 落盘文件名用 `{uuid}.{ext}`，不用用户提交的原始名**
（`app/utils/file.py::build_resume_path`）：

```python
def build_resume_path(user_id, ext) -> Tuple[Path, str]:
    target_dir = get_resume_dir(user_id)               # uploads/resumes/{user_id}/
    name = f"{uuid.uuid4().hex}{ext}"                  # 丢掉用户原始名
    absolute = target_dir / name
    relative = str(Path("resumes") / str(user_id) / name)
    return absolute, relative
```

这样天然免疫"原始名里带 `../`"和"同名覆盖"，13.1 的命名规则也得以保持。
用户原始名只经 `safe_filename()` 清洗后作为**标题兜底**使用。

### 4.11 `stage` 字段全接口统一：slug + label

**问题**：`GET /home/summary` 的 `stage` 是英文 slug，而 `GET /profile`、
`GET /test/result` 的 `stage` 是中文阶段名 —— 同一个概念两种编码，早晚出错。

**决策（全接口统一）**：

- `stage` **一律是英文 slug**，枚举固定为 **`explore` / `prepare` / `sprint`**，
  未知值兜底 `explore`（前端 `normalizeStage` 两种都认，改完仍兼容）；
- 另加 `stage_label` 为**中文展示名**（探索期/准备期/冲刺期），由 `stage` 自动派生。

**存储层用哪种编码（避免以后两处再分叉）**：

> **数据库列里存的是中文**：`profiles.stage`、`test_results.stage` 都是
> `探索期 / 准备期 / 冲刺期`（手册 5.3 的原定义 + 附录B 的判定区间用中文表述）。
> **转换在 schema 层做**，不动存量数据编码。

| 层 | 编码 | 说明 |
|---|---|---|
| 数据库 `profiles.stage` / `test_results.stage` | **中文**（探索期/准备期/冲刺期） | 手册 5.3 原定义，不改 |
| 服务端内部 `profile_service.get_stage()` | **中文** | 给 Prompt 变量用（Prompt 里写的是中文） |
| 对外 JSON（所有接口） | **slug** `explore`/`prepare`/`sprint` | 本文档规定的对外契约 |
| 对外 JSON 的 `stage_label` | 中文 | 展示用，前端可直接渲染 |

转换函数在 `app/utils/stage.py`（`to_stage_slug()` / `to_stage_label()`，
中文↔slug 的唯一映射表 `STAGE_SLUGS`）；**schema 层自动归一化**，
所以任何构造路径（`model_validate(profile)` 读 ORM 实体、手工构造）出来都是 slug：

```python
# app/schemas/profile.py（TestResultResponse / HomeProfileSummary / HomeSummaryResponse 同款）
@field_validator("stage", mode="before")
@classmethod
def _normalize_stage(cls, value: object) -> str:
    return to_stage_slug(value if isinstance(value, str) else None)

@model_validator(mode="after")
def _fill_stage_label(self) -> "ProfileResponse":
    self.stage_label = to_stage_label(self.stage)   # 只在这一处派生，不会分叉
    return self
```

受影响的接口与字段：

| 接口 | 字段 |
|---|---|
| `GET /profile`、`POST /profile/feedback` | `data.stage`（slug）+ `data.stage_label` |
| `GET /test/result`、`POST /test/submit` | `data.stage`（slug）+ `data.stage_label` |
| `GET /home/summary` | `data.stage` + `data.stage_label`、`data.profile.stage`（slug） |
| `GET /report` | `data.content.stage`（slug）+ `data.content.stage_label` |

> 提示：`profile_service.get_stage()` 仍然返回**中文**（它是给 Prompt 用的内部函数），
> 不要把它直接塞进对外 schema。report 的历史快照里 stage 可能是中文，
> 比较 `stage_changed` 前会先统一归一化成 slug。

### 4.12 面试追问到底算"同一题再问"还是"新题"

**结论：追问 = 同一道题的再问，不新建题目行。** 全部挂在这一行
`interview_questions` 上（主问题回答存 `answer`，追问存 `followups` JSON 数组）。

前端**唯一需要看的判别字段是 `action`**，不要靠猜、也不要靠 `next_question` 是否变化。

**请求**（`POST /api/v1/interview/{interview_id}/answer`）：

```jsonc
{
  "question_id": "3f2a...",   // 你在答哪一题（追问时仍传同一个 question_id）
  "answer": "我在那个项目里负责前端"   // 1..5000 字
}
```

**响应**（`data` 内）：

| 字段 | 类型 | followup | next_question | finished |
|---|---|---|---|---|
| `action` | `"followup" \| "next_question" \| "finished"` | `followup` | `next_question` | `finished` |
| `is_followup` | bool | `true` | `false` | `false` |
| `finished` | bool | `false` | `false` | `true` |
| `question_id` | uuid \| null | **与上一题相同** | 新题 id | `null` |
| `parent_question_id` | uuid \| null | 主问题 id（= `question_id`） | `null` | `null` |
| `display_content` | string \| null | **追问句**（要显示/播报这个） | 新题原文 | `null` |
| `followup_round` | int | 本次作答对象的追问轮次（1..2） | `0` | `0` |
| `next_question` | object \| null | 同一行题对象 | 新题对象 | `null` |
| `message` | string | `请回答追问` | `next question` | 题目已全部作答，请调 finish |

**前端处理规则**

```ts
switch (res.action) {
  case 'followup':
    // ⚠️ 不要追加新题！在 res.question_id 这一题上就地续问
    updateQuestionInPlace(res.question_id, res.display_content, res.followup_round);
    break;
  case 'next_question':
    appendQuestion(res.next_question);       // display_content 与它的 content 相同
    break;
  case 'finished':
    await finishInterview(id);               // 去 POST /interview/{id}/finish
    break;
}
```

**`next_question` 为 `null` 的含义**：只出现在 `action === "finished"` 时，
表示所有题目都已作答完，**该调 `POST /interview/{id}/finish`** 生成复盘报告
（没调 finish 之前 `GET /{id}/review` 会返回 2001「尚未生成复盘报告」）。

**追问上限**：每题最多 **2 轮**（`MAX_FOLLOWUP_PER_QUESTION = 2`，11.9「每题后 1-2 轮追问」）。
到顶后即使 AI 还想追问也会被服务端截断，直接进入下一题。

**题目对象里的追问状态**（`InterviewQuestionResponse`，`GET /{id}/questions` 也会返回）：

| 字段 | 说明 |
|---|---|
| `content` | **主问题原文**（追问不会覆盖它） |
| `answer` | 学生对主问题的回答（不会被追问回答覆盖） |
| `followups` | `[{"round":1,"q":"追问句","a":"学生回答"}]`，答完的追问问答记录 |
| `current_followup` | 当前**待回答**的追问句；`null` 表示没有待答追问 |
| `followup_round` | 这一题已追问过的轮数（0 起） |
| `kind` | `main` / `followup`（这行当前处于什么状态） |

> **本次修复的两个实现 bug**（原实现细节，记录备查）：
> ① 原代码用 `extra["kind"] == "followup"` 判断"这次答的是不是追问"，但那个字段
> 出题时写死 `"main"`、之后从未置成 `"followup"`，导致**主问题的回答会被第二次作答
> 覆盖**且 `followups` 永远为空；现在以 `extra["followup_question"]` 是否待答为唯一真源。
> ② `followups` 的类型标注曾是 `Dict`（实际存的是 `List`），且追问句只藏在 `extra` 里
> 没暴露给前端；现在类型改正并平铺出 `current_followup` / `followup_round` / `kind`。

### 4.13 数据库：SQLite（默认）与 PostgreSQL 的差异

> **[已决策：用户拍板] 数据库由 PostgreSQL 改为 SQLite**（第 6 节 ⑯）。
> 原因：本机既没有 PostgreSQL 也没有 Docker，联调根本起不来；SQLite 能让后端
> 起得来、跑得通、真正被验证。**代码一套，两种库都能跑**，切换只改 `DATABASE_URL`。

#### 4.13.1 一句话切换

```env
# 默认（本机联调）
DATABASE_URL=sqlite:///./data/app.db

# 生产 / 想切回 PostgreSQL（不需要改任何代码）
# DATABASE_URL=postgresql://ai_user:your_password@localhost:5432/ai_career
```

切回 PG 时需要：① `pip install psycopg2-binary`（要求在 requirements.txt 里是**注释掉的可选项**）；
② 用 Alembic 而不是 `create_all` 建表（见 §4.13.5）。

#### 4.13.2 JSONB → 跨方言 JSON（**最容易翻车的地方**）

手册 5.3 有 9 个 JSONB 列（`profile_tags.extra`、`conversations.conclusion`、
`resumes.parsed_data`、`interviews.report`、`interview_questions.followups` / `extra`、
`daily_questions.options`、`reports.content`、`badges.condition`、`test_results.answers`）。
`postgresql.JSONB` 在 SQLite 上**建表直接失败**。

做法：**集中在 `app/models/types.py`，不要在模型里散写 JSONB**：

```python
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

# PostgreSQL 用 JSONB（保留索引与 ->/->>/@> 查询能力），其它方言退回通用 JSON
JSON_VARIANT = JSONB().with_variant(JSON(), "sqlite")

def json_column(nullable: bool = True, **kwargs) -> Column:
    return Column(JSON_VARIANT, nullable=nullable, **kwargs)
```

全部 9 个列统一写成 `sa_column=json_column()`。
**已实测**（`python -m app.db.init_db`）：SQLite 下 16 张表全部建成，
DDL 里这些列是 `JSON`（不是 `JSONB`），例如：

```sql
CREATE TABLE profile_tags (
    id CHAR(32) NOT NULL, ..., extra JSON, updated_at DATETIME NOT NULL, ...
)
```

#### 4.13.3 排查出的 PostgreSQL 专有写法清单（逐条处置）

| # | 项目 | 处置 |
|---|---|---|
| 1 | `postgresql.JSONB` ×9 列 | **已改**：`with_variant(JSON(), "sqlite")`，集中到 `models/types.py` |
| 2 | `postgresql.UUID` / `ARRAY` / `INET` | **本来就没有**。`uuid.UUID` 字段由 SQLModel/SQLAlchemy 2.0 映射成通用 `Uuid`，实测 SQLite 下 DDL 是 `CHAR(32)` |
| 3 | JSON 路径查询（`.op('->')`、`->>`、`jsonb_*`、`@>`） | **一处都没有**。所有 JSON 内容都是取出来在 Python 侧读（如 `question.extra.get(...)`），所以 SQLite 的 JSON1 限制完全不影响 |
| 4 | `DISTINCT ON` | **没有** |
| 5 | `ILIKE` | **没有**（也没用 `.ilike()`）；模糊匹配目前都在 Python 侧做 |
| 6 | `func.now()` / `server_default` | **没有**；时间戳统一由 `app.models.user.utcnow()` 在 Python 侧生成（也正因此在两种库上行为一致） |
| 7 | `RETURNING` | **没有手写**；SQLAlchemy 的 `insert().returning()` 未使用，`db.refresh()` 走的是普通 SELECT |
| 8 | `onupdate` | **没有**；`updated_at` 由 service 层显式赋值 |
| 9 | `TIMESTAMP WITH TIME ZONE` | **没有**；全部是 naive UTC `DateTime`（SQLite 存 TEXT，格式 `YYYY-MM-DD HH:MM:SS.ffffff`） |
| 10 | 大小写敏感排序 / 比较 | 用户名等唯一约束在两库上行为一致（SQLite 默认 `BINARY` 排序规则 = 大小写敏感，与 PG 一致）；**未做** `COLLATE NOCASE` 之类的方言特化 |
| 11 | `case()` + `func.sum` 分组统计（首页任务进度） | SQLAlchemy 会按方言翻译，SQLite 下实测通过（`done_steps=1/total_steps=2`） |

结论：**除了 JSONB 之外没有需要改写的 PG 专有写法**，"没有任何查询因切 SQLite 而不可用"。

#### 4.13.4 时区语义（**注意**）

- 所有时间戳都是 **naive UTC**（`utcnow()` 返回 `datetime.now(timezone.utc).replace(tzinfo=None)`）。
- SQLite 没有真正的时间类型，`DATETIME` 落库是 TEXT，格式固定为
  `YYYY-MM-DD HH:MM:SS.ffffff`；**该格式下字符串比较等价于时间比较**，
  所以 `created_at > ?`、`answered_at BETWEEN ? AND ?`、`ORDER BY created_at` 都是对的
  （已实测：跨会话/日内边界查询、排序均正确）。
- **不要**把带时区的 `datetime`（`tzinfo=UTC`）写进这些列：SQLite 会写成带 `+00:00`
  后缀的字符串，与既有数据的比较会错位；项目内统一用 `utcnow()` 就不会有这个问题。
- PostgreSQL 下这些列是 `TIMESTAMP WITHOUT TIME ZONE`，语义与 SQLite 的 TEXT 一致。

#### 4.13.5 Alembic 在 SQLite 下的注意事项

- `migrations/env.py` 已按方言自动开启 **`render_as_batch=IS_SQLITE`**：
  SQLite 的 `ALTER TABLE` 不能 DROP COLUMN / ALTER COLUMN，batch 模式会走
  "建新表 → 拷数据 → 删旧表 → 改名"，**不加这个以后任何改列都会失败**。
- `env.py` 还会用 `normalize_database_url()` 把 `sqlite:///./data/app.db` 解析成
  backend 下的**绝对路径**，保证 `alembic upgrade head` 与运行时操作的是同一个库文件。
- 现在 `migrations/versions/` 是空的，所以 `alembic upgrade head` 是**空操作**；
  SQLite 联调请用 `python -m app.db.init_db`（内部 `create_all`，幂等）。
  生成首个迁移后（`alembic revision --autogenerate -m "init"`），两种库都能用 Alembic。
- ⚠️ `create_all` 与 Alembic **不要混用**：`create_all` 不写 `alembic_version`，
  混用会导致 autogenerate 认为"表不存在"而重复建表。二选一，并在团队内统一。

#### 4.13.6 SQLite 特有参数

| 参数 | 值 | 为什么 |
|---|---|---|
| `connect_args.check_same_thread` | `False`（`SQLITE_CHECK_SAME_THREAD_FALSE`） | FastAPI 同步路由跑在线程池、SSE 生成器还会复用连接；不开会报 `SQLite objects created in a thread can only be used in that same thread` |
| `poolclass` | 内存库用 `StaticPool` | 否则每个连接看到各自的空库（仅测试/临时试跑用内存库） |
| 库文件目录 | 自动创建 `backend/data/` | 相对路径按 backend/ 解析；已在 `.gitignore` 忽略 |
| 并发写 | 默认 rollback journal，写会锁库 | 单人联调够用；多人/高并发请切 PG（见 §4.13.7） |

#### 4.13.7 已知差异与风险（SQLite vs PostgreSQL）

| 维度 | SQLite | PostgreSQL | 影响 |
|---|---|---|---|
| 并发写 | 库级写锁，写多会 `database is locked` | MVCC 行级锁 | 联调/单用户无感；多人同时写要切 PG |
| JSON 查询 | JSON1 扩展，能力有限（且本项目没用） | JSONB + GIN 索引 | 目前只做整体读写，**无影响** |
| 类型严格性 | 弱类型（`VARCHAR(50)` 不真限制长度） | 严格 | 超长字符串在 SQLite 上不会报错，逻辑校验仍需在应用层做 |
| `Uuid` 存储 | `CHAR(32)`（无连字符的 hex） | 原生 `UUID` | 对代码透明（SQLAlchemy `Uuid` 负责转换） |
| `NULL` 唯一性 | 多行 NULL 不冲突（与 PG 相同） | 同 | `messages` 的 `(conversation_id, client_msg_id)` 唯一约束在 SQLite 上语义一致（**已实测**：两条 assistant 消息 `client_msg_id=NULL` 可共存，重复的 `client_msg_id` 被拒绝） |
| 时间精度 | 微秒（TEXT 存储） | 微秒 | 见 §4.13.4；**已修复**并列时间戳问题（§4.13.8） |
| 布尔 | `BOOLEAN`（实为 0/1） | 真布尔 | 对代码透明 |

#### 4.13.8 顺带修掉的一个真 bug：并列时间戳

实测发现：**同一批 flush 插入的多行会拿到完全相同的 `created_at` 微秒**
（三条消息都是 `2026-09-18 13:08:54.745818`）。这会破坏两处逻辑：

1. `idempotency.find_assistant_reply()` 用 `created_at > user.created_at` 找回复 →
   并列时**一个都匹配不上**，幂等回放错误地降级成 `pending`；
2. `chat_service._recent_messages()` 按 `created_at` 排序拼 Prompt → 并列时顺序由数据库决定，
   可能把用户/助手的话说反。

修法（不改表结构）：`app.models.user.utcnow()` 改成**严格单调递增**（新值不大于上一个就在
上一个基础上 +1 微秒，带线程锁），并给消息相关查询加 `Message.id` 次级排序键 +
一个并列兜底分支。实测：

```
时间戳: [...486619, ...486620, ...486621, ...486622, ...486623]
严格递增: True
find_assistant_reply -> '回复1'      # 修复前是 None
```

> 仍需注意：显式传 `created_at` 的调用方（导入历史数据/测试）会绕过单调保证；
> 那种情况下排序是未定义的（查询里已加 id 次级键，至少保证同一次查询结果稳定）。

---

## 5. 尚未验证 / 已知未实现

### 5.1 验证边界（哪些已实际运行，哪些还没有）

#### 5.1.1 已实际运行（Python 3.12.10 + `backend/venv` + SQLite）

环境：`C:\Users\15972\AppData\Local\Programs\Python\Python312\python.exe`（3.12.10），
依赖装在 `backend/venv`（`pip check` 无冲突：`sqlmodel 0.0.22` + `pydantic 2.10.4`、
`passlib 1.7.4` + `bcrypt 4.0.1`、`fastapi 0.115.6` + `starlette 0.41.3`）。

**四条基础命令**

| # | 命令 | 结果 |
|---|---|---|
| ① | `python -c "from app.main import app; print(len(app.routes))"` | `routes= 46` |
| ② | `python -m app.db.init_db` | **17 张表**建成 + 种子落库（30 测试题 / 30 每日一问 / 2 奖章），幂等重跑无错 |
| ③ | `python -c "app.openapi()"` | `paths= 37`，`components.schemas= 82` |
| ④ | `python -m uvicorn app.main:app --port 8000` | 启动成功；`/api/v1/health` 200、`/docs` 200、`/` 200 |

**端到端链路（20 项断言全部 PASS，原始 JSON 见提交记录）**

注册 → `GET /profile`(tested=false) → `GET /home/summary`(next=`/test/intro`)
→ `GET /test/questions`(30 题，id=`q_clarity_01`) → `POST /test/submit`
→ `GET /profile`(tested=true) → `GET /home/summary`(next 切到 `/chat`)
→ `POST /task/generate`(3 步) → 打卡 → `GET /daily/today`(真实题目 id)
→ `POST /daily/answer` → 反例校验。

关键数值（**submit 与 GET /profile 逐字段一致**）：

```
clarity_score   submit=62.5   profile=62.5   一致=True
action_score    submit= 0.0   profile= 0.0   一致=True
resume_score    submit= 0.0   profile= 0.0   一致=True
total_score     submit=25.0   profile=25.0   一致=True
stage           submit='explore'  profile='explore'  一致=True

打卡前：action_score=0.0  total_score=25.0
打卡后：action_score=8.0  total_score=27.8     # 缺陷 2 修复验证
```

反例：全零 UUID 答题 → `HTTP 404 code=2001`；同日重复答题 → `HTTP 400 code=1001`；
不存在的简历文件 → `HTTP 404 code=2001`。

**运行中被抓出并修复的 8 个真 bug**

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | `ImportError: cannot import name 'SessionLocal'` | 重构 `session.py` 时弄丢了 `SessionLocal`（只加了 `session_scope`/`get_session`） | 恢复为**唯一**会话工厂 `SessionLocal()`（函数形式，避免 `init_engine()` 换引擎后 `sessionmaker` 绑旧引擎）；删掉没人用的 `get_session()`，3 个定时任务统一过来 |
| 2 | `app.openapi()` 抛 `PydanticUserError: ... ForwardRef('Optional[str]') is not fully defined` | `deps.py` 用**可调用类实例** `oauth2_scheme = _Bearer()`；该模块有 `from __future__ import annotations`，注解是字符串，FastAPI 用 `getattr(call, "__globals__", {})` 取命名空间 —— **类实例没有 `__globals__`** | 改成普通函数 `def oauth2_scheme(...)`，docstring 写明"不要改回类实例" |
| 3 | 启动日志先"数据库连接正常"再"连接失败：This Connection is closed" | `inspect(conn).get_table_names()` 写在了 `with engine.connect()` **块外** | 移进 `with` 块内 |
| 4 | `find_assistant_reply()` 返回 `None`（幂等回放降级） | **同一批 flush 插入的多行 `created_at` 完全相同**（实测三条消息同为 `...745818`） | `utcnow()` 改为**严格单调递增**（+1µs + 线程锁）；消息查询补 `Message.id` 次级键 + 并列兜底（§4.13.8） |
| 5 | 无 token / 伪造 token 返回 **HTTP 200** | `deps.py`、`security.py` 里 6 处**裸构造** `BusinessException(ErrorCode.UNAUTHORIZED, ...)` 没有 `status_code`；根因是只有 `HTTP→code` 表、没有 `code→HTTP` 表 | 由父 agent 修复：新增 `CODE_TO_HTTP_STATUS` 并在 `__init__` 里**按 code 推导**（唯一落点），便捷构造不再各传 `status_code`；`RequestValidationError` 也统一成 400 |
| 6 | 新用户 `POST /test/submit` **必然 500**（M1 主链路全坏） | `recompute_stage` 里 `latest_resume.completeness`，而新用户没有简历 → `AttributeError: 'NoneType'` | 由父 agent 修复 `if latest_resume is not None else 0.0`；本轮进一步把 `submit_test` 改成**原子事务**（见下） |
| 7 | `POST /test/submit` 响应 `sprint/100/100/100`，紧接 `GET /profile` 是 `prepare/40` —— **响应与落库不一致** | 响应取自"测试原始分"，而 `apply_tags → recompute_stage` 在同一请求里又按真实行为重算并落库（新用户没任务没简历 → action/resume=0） | 改为**先重算、再把落库后的画像值写回 `test_results`**，最后只提交一次；现在 submit 响应 == 该行记录 == `GET /profile`（实测 62.5/0/0/25/explore 三处一致） |
| 8 | 打卡后 `action_score` 仍是 **0.0**（用户看到进度条前进但画像不动） | `recompute_stage` 只统计 `status == "已完成"` 任务的步骤，进行中任务的打卡被忽略 | 改为统计**全部任务**的已完成步骤（每步 +8），整单完成再 +20；注释写明"行动力来自行动本身"（11.6）。实测 0.0 → 8.0 |

**另外实测确认的点**

- `JSONB().with_variant(JSON(), "sqlite")` 在 SQLite 下**确实能建表**（17/17，列为 `JSON`）；
- `field_validator(mode="before")` 在 `model_validate(ORM实体)` 路径上**确实拿得到中文 `stage`**
  并转成 `prepare`；未知值兜底 `explore`；手工构造 `stage="冲刺期"` 也归一化成 `sprint`；
- `model_validator(mode="after")` 里给 `stage_label` 赋值**确实生效**；
- `ApiResponse[None]`（`/events`）与 `Literal[...]`（面试 `action`）在 OpenAPI 里**都不报错**，
  三态字符串出现在 `components` 里；
- `GET /daily/today` 的 OpenAPI 里 `question` 是
  `{"anyOf": [{...DailyQuestionResponse}, {"type": "null"}]}`（可为 null 的契约真的生效）；
- 幂等：`client_msg_id` 重复插入被唯一约束拒绝；两条 `client_msg_id=NULL` 的 assistant
  消息可共存；
- 追问状态：`extra` / `followups` **整体赋值**后能读到；**就地修改不持久化**（坑确认存在）；
- 首页聚合：`stage` slug、`tested`、`ai_findings`（`reason` 引用 `extra.evidence`）、
  任务步骤 1/2、`current_step_title`、`next_action` 分支切换全部正确；
- **SQLite 外键强制**：`PRAGMA foreign_keys = 1`（应用引擎连接上实测），
  插入指向不存在题目的 `daily_answers` 被 `FOREIGN KEY constraint failed` 拒绝；
- **原子性**：题库为空/答案全无效时提交返回 1001，且**没有写入任何 `test_results`**；
- 目录穿越：`../../etc/passwd`、`resumes/../../../../windows/win.ini`、`C:/Windows/win.ini`、
  空串**全部被拒为 2001**；合法路径正常；下载文件名清洗掉换行与路径分隔符。

#### 5.1.2 仍未验证

- **AI 链路**：没有 DeepSeek API Key，Prompt 未真实调用过模型，结构化输出契约未实测
  （任务生成走的是 7.6 兜底任务，能在离线状态下产出可打卡的步骤）；
- **PostgreSQL 路径**：本机没有 PG，`psycopg2` 方言、JSONB DDL、`alembic upgrade` 均未跑过；
- **Alembic**：`migrations/versions/` 为空，`alembic upgrade head` 是空操作，未生成过迁移；
- **Docker / Nginx**：`docker-compose` / `nginx -t` 未跑（本机没有 Docker）；
- **前端联调**：SSE 的真实字节流没有被前端消费过（只验证了路由与 OpenAPI 存在）；
- **SSE 生成器内的 Session 生命周期**：只在单请求里验证过路由可用，
  没有在前端消费流的同时观察 `SessionLocal()` 的关闭时机；
- **未写测试**：没有任何 pytest 用例（骨架阶段要求不写），验证用的都是一次性脚本（已删除）；
- **定时任务**：APScheduler 注册成功（4 个 job），但没有等到实际触发时间；
- **未验证的边界**：并发打卡/并发提交（SQLite 库级写锁下的表现）、
  多处同时 `apply_tags` 的权重融合竞争。

### 5.2 数据落库现状（哪些在库里，哪些在代码里）

> 早期骨架出现过"接口看起来有数据、数据库里却是空的"（题库在 Python 常量里，
> 占位题甚至用全零 UUID），已经改掉。现在的规则是：**用户可见的数据一律落库，
> 只做内部参考的数据可以是代码常量，而且必须在本节写清楚**。

| 数据 | 位置 | 手册依据 | 说明 |
|---|---|---|---|
| 基础测试题（30 题） | ✅ **DB** `test_questions` | 5.4「30-50 题」 | 种子在 `app/db/seed_data.py::TEST_QUESTIONS`；`GET /test/questions` **从 DB 读**，空库返回 `[]` 并提示 `init_db` |
| 每日一问题库（30 题） | ✅ **DB** `daily_questions` | 5.4「30 题，四维度轮换」 | 种子 `DAILY_QUESTIONS`；`GET /daily/today` **从 DB 读**，题库为空/答完时返回 `question: null` |
| 奖章（2 枚） | ✅ **DB** `badges` | 5.4「起步行动家」+ 11.12 | 种子 `BADGES`（起步行动家、坚持打卡者）；`GET /badge` 从 DB 读 |
| 单用户作答/任务/画像 | ✅ **DB** | 5.3 | 运行时数据 |
| 成长任务模板（4 个） | ⚠️ **代码常量** `task_service.TASK_TEMPLATES` | 附录E「6 个」 | **未落库的理由**：它只作为 `task_generate` Prompt 的参考样例喂给模型，不是用户可见数据，手册 5.2 也没有模板表。**影响**：数量少于附录E 的 6 个；管理员无法在线编辑模板；换模板要改代码重启 |
| 岗位关键词库（3 个岗位） | ⚠️ **代码常量** `ai/schemas.py::JOB_KEYWORDS` | 附录F | **未落库的理由**：ATS 评分用到的词表，同样不是用户可见数据，5.2 无对应表。**影响**：加岗位要改代码；`resume_optimize` 传给模型的词表是硬编码的 |

**待办**：如果要让上面两项也能在线维护，需要按手册 5.3 变更流程新增
`task_templates` / `job_keywords` 两张表，并把 `TASK_TEMPLATES` / `JOB_KEYWORDS`
搬成种子数据（`init_db.py` 里已经预留了 `seed_task_templates` / `seed_job_keywords`
两个函数，现在只打"跳过"日志）。

### 5.3 仍未实现 / 有明确 TODO 的部分

| 位置 | 现状 |
|---|---|
| `profile_service.submit_test()` 的文字补充 | 只落库 `free_text`，**没有**在提交时同步调 AI 抽标签（同步 route 里没法 await）；AI 抽取入口 `extract_tags_from_text()` 已就绪，接的时候把 route 改 async 即可 |
| `chat_service` 的追问计数（7.7 ≤3 轮） | **已实现**：`conversations.followup_direction` / `followup_round` 两列 + `dominant_dimension()` / `update_followup_state()`；SSE 事件返回真实轮次（见第 6 节 ⑥、§4.6.5） |
| `client_msg_id` 幂等 | **已实现**：独立列 `messages.client_msg_id` + 复合唯一约束（第 6 节 ⑤），已实测（重复插入被拒） |
| `resume_service.keyword_coverage()` | 规则版关键词覆盖是降级实现；ATS 评分主要靠 AI |
| 任务模板 / 岗位关键词 | 代码常量，未落库（理由与影响见 §5.2） |
| Electron / 站内通知 | 12.2 的「任务提醒」只返回提醒列表，没有推送通道（手册没有通知表） |
| `admin` / 分页 | 10.2 没有分页与后台接口，未自创端点 |
| `event_service` 埋点 | 只写结构化日志，未持久化（第 6 节 ⑬） |
| 并发场景 | 没有做并发测试（SQLite 库级写锁、`apply_tags` 权重融合竞争都未验证） |

---

## 6. 与手册冲突或手册缺失的点（待确认 / 已决策）

> 标记含义：**[已决策]** = 已有明确结论并在代码里落地（保留记录，便于回溯）；
> **[待确认]** = 仍需人工拍板。

① **[已决策] 统一响应 vs 6.2 示例冲突**：6.2 写 `response_model=ChatResponse` 直接返回业务对象，
6.5/10.1 要求包 `{code,message,data}`。本实现按 **6.5/10.1 统一包信封**
（`response_model=ApiResponse[XxxResponse]`），因此 6.2 的示例写法在本仓库不适用。
前端按信封 `code` 判业务成败。

② **[已决策] 6.5 与 6.6 的 `data` 不一致**：6.5 示例 `data: {}`，6.6 示例 `data: None`。
本实现按 6.6：成功时 `data` 是业务对象（无数据时 `null`），失败时恒为 `null`。

③ **[已决策] HTTP 状态码分层（FIX 3）**：原实现把所有异常都压成 HTTP 200，属于对 6.6 的
过度应用。现在：

- `BusinessException`（默认）→ **HTTP 200** + 信封 code（照 6.6）；
- `BusinessException.param_error / unauthorized / forbidden / not_found / internal`
  → **HTTP 400 / 401 / 403 / 404 / 500**（认证、授权、资源不存在必须有真实状态码，
  否则前端 401 拦截器、Nginx 重试策略、监控告警全部失效）；
- `RequestValidationError` → **HTTP 200** + code 1001（提交数据问题，非服务故障）；
- `HTTPException` → **保留原始状态码**，code 按 `HTTP_STATUS_TO_CODE` 映射；
- 未捕获 `Exception` → **HTTP 500** + code 5000。

传输层语义用 HTTP 状态码，业务语义用信封 `code`。**HTTP 200 仍可能携带失败的业务码**，
前端不能"拿到 200 就算成功"。映射表在 `app/core/errors.py::HTTP_STATUS_TO_CODE`。

④ **[已决策] SSE 端点的入参形式（FIX 1）**：手册 10.2 定义
`GET /chat/conversations/{id}/stream`，8.4 用 `new EventSource(...)` 只发 GET。
但 `EventSource` 既不能带 `Authorization` 头也不能带 body，前端已按
**fetch + ReadableStream** 实现，因此新增：

- `POST /api/v1/chat/conversations/{id}/stream`（**前端正式使用**，JSON body = `ChatRequest`）；
- 原 `GET` 端点**保留**，`summary`/`description` 标注「调试用，前端不调用」；
- 两者**共用同一份事件生成器**（`app/api/v1/chat.py::_event_generator`），事件序列完全一致；
- 两者都先把用户消息落库（`chat_service.prepare_stream`）再开流。

契约全文见 §4.6「SSE 契约」。

⑤ **[已决策：偏离手册 5.3 补列] `Message.client_msg_id`（幂等）**：
设计文档 4.3 要求同一 `client_msg_id` 不得产生「两条用户消息 + 两次 AI 回复」。
手册 5.3 的 `messages` 字段表里**没有**这个列，属于遗漏。补列（已授权）：

```python
# app/models/conversation.py -> Message
__table_args__ = (
    UniqueConstraint("conversation_id", "client_msg_id", name="uq_messages_conversation_client_msg"),
)

client_msg_id: Optional[str] = Field(default=None, max_length=64, index=True)
```

- **为什么补列而不是内联进 `content`**：内联标记会跟着 `MessageResponse.content`
  一起发给前端，污染纯文本气泡渲染、历史消息（`GET /messages`）、搜索与长度统计。
  用数据污染换去重不划算。现在 `content` **永远存纯原话**。
- 「曾用内联标记」的历史方案已完全删除（`wrap_content` / `strip_client_marker` /
  `extract_client_msg_id` 三个函数与 README 里对应的 strip 说明都已移除），
  所有读 `content` 的地方（`MessageResponse`、`build_history_text`、`_build_llm_messages`）
  **不再需要任何 strip 动作**。
- 唯一约束的语义：PostgreSQL 里 `NULL` 不参与唯一性判断，所以 assistant 消息
  （`client_msg_id` 为 NULL）不会互相冲突；同一会话内同一个 `client_msg_id`
  二次插入会被数据库直接拒绝（应用层已先做幂等查询，DB 约束是最后一道保险）。
- 前端拿得到：`MessageResponse.client_msg_id` 已暴露，供前端把自己的临时消息
  与后端落库消息对上（乐观更新）。
- 命中语义：上一轮已完成 → 回放上次回复（`/messages`）或发 `pending` +
  `replay_message_id`（SSE）；上一轮仍在生成 → 不重复调 AI，SSE 发 `pending`，
  `/messages` 返回 code 1001。

⑥ **[已决策：偏离手册 5.3 补列] `Conversation.followup_direction` / `followup_round`（7.7 追问计数器）**：
7.7 要求「同一方向连续追问 ≤3 轮」。追问计数本质是**会话级状态**，
不属于单条消息，而手册 5.3 的 `conversations` 表只有 `title/conclusion/created_at/updated_at`，
`messages` 表也没有方向列。补两列（已授权）：

```python
# app/models/conversation.py -> Conversation
followup_direction: Optional[str] = Field(default=None, max_length=50)  # 当前挖掘维度
followup_round: int = Field(default=0)                                  # 同方向已追问轮数（1 起）
```

计数器实现（`app/services/chat_service.py`）：`dominant_dimension()` 从本轮抽到的标签里
算主导维度（权重和 → 条数 → 固定优先级 `DIMENSION_PRIORITY`），
`update_followup_state()` 按「同方向 +1 / 换方向重置为 1 / 拿不到标签保持不变」推进，
`FollowupState.warning` 在满 3 轮时让 `_build_llm_messages()` 往 system Prompt 注入
「本轮必须换到另一个维度」的硬约束。SSE 事件的 `followup_round` 现在返回**真实值**：
`start`/`delta` 是这一轮开始前的值，`done` 是更新后的值。详见 §4.6.5。

⑦ **[已决策] SSE 生成器里的 Session 生命周期（FIX 2）**：原实现在生成器内部使用
`Depends(get_db)` 的请求级 Session，而 FastAPI 在**响应开始返回时**就清理依赖，
`StreamingResponse` 的 body 之后才被消费 —— 生成器里的 `commit()` 极可能作用在
已关闭的 Session 上；`current_user` 也会 detached。现在：

- 生成器内部自开 `SessionLocal()`，`finally` 里 `close()`；
- `current_user` 降级为纯数据 `user_id`（在请求级 Session 还活着时取出）；
- service 层签名同步改成只收 `conversation_id` / `user_id`（`stream_reply`、
  `_save_assistant_message`、`_extract_round_tags`）；
- 完整说明与代码注释在 `app/api/v1/chat.py::_event_generator`
  与 `app/services/chat_service.py::prepare_stream` / `stream_reply`。

⑧ **[已决策] 「有没有画像」不能看对象是否存在**：`GET /profile` 走
`get_or_create_profile`，**永远创建并返回一个画像对象**，所以「有没有 profile 对象」
这个判据恒为 true —— 前端用它做「新用户强制去 `/test/intro`」的守卫会导致漏斗永不触发。
现在 `ProfileResponse.tested` 表示是否做过基础测试表（依据 `test_results` 是否存在，
只查一列 `LIMIT 1`，一次算好复用，无 N+1）。

> **前端注意：判断用户做没做过测评，必须看 `profile.tested`，不要看画像对象是否存在。**
> `GET /profile/tags`、`POST /profile/feedback` 返回的 `ProfileResponse` 语义一致
> （`feedback` 内部就是 `get_profile()`）；`POST /test/submit` 成功后
> `test_results` 落库，`tested` 自然变 `true`，无需额外写入。

⑨ **[待确认] 测试表没有独立 service 文件**：4.1 的 `services/` 清单里没有 `test_service.py`，
但 10.2 有 `/test/*` 三个端点，11.2/11.3 也有明确流程。本实现把测试表逻辑放进
`profile_service.py`（因为测试结果直接生成初始画像）。若希望文件与路由一一对应，
需要新增 `tests_service.py`——手册 4.1 未列出，故未自创。

⑩ **[待确认] 追问轮数的口径**：`followup_round` 现在按「画像标签的主导维度」推进，
即**一轮对话算一轮**（不是一问一答算一轮）。手册 7.7 只说「连续追问同一方向不超过 3 轮」，
没有定义「一轮」的粒度。若产品口径是「一句话算一轮」，需要改成按消息计数。

⑪ **[已决策：按用户要求补实现] `GET /api/v1/home/summary`（首页聚合）**：
设计说明书 5.4 的需求，手册 10.2 的接口清单里没有，因此骨架初版未实现。现补：
`app/api/v1/home.py` + `app/services/home_service.py` + `app/schemas/home.py`，
挂在 `/api/v1/home`。把前端首页原本串行的 4 个请求合成一次调用，
并由后端统一决策 `next_action`（产品「AI 主动性」的落点）。
完整契约、`next_action` 判定规则表、痛点→路由规则见 §4.8。

⑫ **[已决策：按用户要求补实现] `POST /api/v1/events`（行为埋点上报）**：
同样来自设计说明书 5.4，手册 10.2 未列。现补：
`app/api/v1/events.py` + `app/services/event_service.py` + `app/schemas/event.py`，
挂在 `/api/v1/events`。单条与批量两种请求形状都接受（`model_validator(mode="before")`
做 union 归一化），事件名不做白名单，单批上限 50 条。
契约与限制见 §4.9。

⑬ **[待确认/限制] 埋点事件目前只落日志、未持久化**：手册 5.3 没有事件表，
建表属于范围扩张，所以 `event_service` 只写结构化日志
（`EVENT user_id=... event=... payload=...`），响应里也不回传统计值。
**要做行为分析必须先补 `events` 表**（建议 `id / user_id / event VARCHAR(100) /
payload JSONB / client_ts / created_at`），这属于手册 5.3 变更。
`record_events(db, user, items)` 已经预留了 `db` 参数，届时只改 service 内部。

⑭ **[已决策：安全修复] 删除 `/uploads` 无鉴权静态目录，改为鉴权下载端点**：

`app/main.py` 里曾用 `application.mount("/uploads", StaticFiles(...))` 把整个
`uploads/` 目录公开成静态资源 —— **任何未登录的人**只要遍历
`GET /uploads/resumes/{user_id}/{uuid}.pdf` 就能下载别人的简历
（姓名/手机号/学校/经历 = PII），而 `resumes.file_path` 里就带 user_id，路径可枚举。
违反 14.5「用户只能访问自己的数据」与 14.1「数据保密」。

**为什么不能用 `StaticFiles` 挂 `uploads`**：

1. `StaticFiles` 是**完全无鉴权**的，它不经过任何 FastAPI 依赖（`get_current_user`
   根本不会被调用），也无法做归属过滤 —— 目录里有什么就能拿什么；
2. 文件名虽然是 UUID，但**路径本身含 user_id**，且列表接口会返回 id，
   可枚举性足够高，"UUID 难猜"不构成保护；
3. 一旦泄露的是简历，就是可直接用于社工/诈骗的 PII，风险等级与"图片被爬"不同；
4. 也不该"只在 DEBUG 挂载"：开发环境同样有真实简历，前端也不该依赖这个路径。

现在：静态挂载已删除（含其 try/except 与 docstring 说明）；
nginx 与 docker-compose 里对应的静态 location / 卷挂载也已删除；
文件只能经 `GET /api/v1/resume/{resume_id}/file` 读取
（JWT 鉴权 + 归属校验「不属于自己按不存在处理」+ 路径越界校验 + 文件名清洗）。
完整实现与目录穿越写法见 §4.10。

⑮ **[已决策：安全修复] 越权一律按"不存在"，并扩到全仓库**：

原来 `GET/PUT /resume/{id}`、`/{id}/optimize`、`/{id}/report`、`task` / `interview` /
`chat` 的同类端点在「存在但不属于自己」时返回 **1003**，可用于反推 id 是否存在。
现已按「查私有资源时不存在与不属于你必须返回同一个 2001」统一改造
（编码规则见 §8.1，helper 是 `app.core.errors.not_found_unless_owner`）。

改造后的 `get_owned_*` 调用点清单（**全仓库已无归属类 1003**）：

| service 函数 | 覆盖端点 | 改动 |
|---|---|---|
| `resume_service.get_resume()` | `GET /resume/{id}`、`PUT /resume/{id}`、`POST /{id}/optimize`、`GET /{id}/report`、`GET /{id}/file` | `1003` → `2001`；同时删除了临时的 `get_owned_resume_or_not_found()`（已无必要，两个函数合一） |
| `task_service.get_task()` | `GET /task/{id}`、`POST /{id}/steps/{step_id}/complete`、`POST /{id}/abandon` | `1003` → `2001` |
| `interview_service.get_interview()` | `GET /{id}/questions`、`POST /{id}/answer`、`POST /{id}/finish`、`GET /{id}/review` | `1003` → `2001` |
| `chat_service.get_conversation()` | `GET/POST /conversations/{id}/messages`、`GET/POST /conversations/{id}/stream`、`GET /{id}/conclusion` | `1003` → `2001` |

顺带把 `interview_service.submit_answer()` 里「题目不属于本场面试」也统一成
`BusinessException.not_found("题目不存在")`（原来已经是 2001，只是改用 helper 语义一致）。
`BusinessException.forbidden()` 保留但收紧了 docstring：只允许用于"请求合法但操作本身
越权、与资源归属无关"的场景；当前业务里没有这种场景，所以归属类 1003 实际归零。

⑯ **[已决策] `stage` 全接口统一为 slug + label**：`GET /home/summary` 与
`GET /profile` / `GET /test/result` 原本一个用 slug 一个用中文。现统一成
`stage` = `explore`/`prepare`/`sprint`，另给 `stage_label` 中文；
**数据库列仍存中文**，转换只在 schema 层（详见 §4.11）。

⑰ **[已决策] 面试追问语义：同一题再问，不新建题目行**，并在
`InterviewAnswerResponse` 上补了判别字段 `action` / `is_followup` /
`question_id` / `parent_question_id` / `display_content`。同时修掉两个实现 bug
（主问题回答被追问回答覆盖、`followups` 类型标成 `Dict` 且没暴露追问句），
详见 §4.12。

⑱ **`interview_questions` 表有表名没字段表**：5.2 列出了这张表，
5.3 却没有给字段定义。本实现按 5.2 的描述「面试题目与回答」+ 11.9 的
"每题后 1-2 轮追问"补了字段（`question_order/content/answer/followups/score/extra`），
需要确认。

⑲ **`test_results` 表同样只有表名**：5.3 未给字段表，本实现按 11.2/11.3 补了
`answers/free_text/三个分项分/total_score/stage`。

⑳ **题库、任务模板、奖章没有对应的表**：5.2 的表清单里没有
`test_questions` / `task_templates` / `job_keywords`，但 5.4 要求灌这些种子数据。
本实现暂时放在 Python 常量里（`profile_service` / `task_service` / `ai.schemas`）。

㉑ **依赖清单缺 3 个必要包**：2.6 只列了 12 个包，但
- 6.4 要求 `get_settings`、3.5 要求 `.env` 驱动 → 需要 `pydantic-settings`；
- 5.5 / 17.6 要求 Alembic 迁移 → 需要 `alembic`；
- 2.3 说"JWT：python-jose + passlib"，passlib 的 bcrypt 后端需要 `bcrypt`。
这三个已加入 `requirements.txt`。

㉒ **`uploads` 路径在 16.2 与 13.1 之间不一致**：16.2 写 `- ./uploads:/app/uploads`，
13.1 要求文件落在后端 `UPLOAD_DIR`（即 `backend/uploads`）。
`docker-compose.yml` 对 **app 服务**用 `./backend/uploads:/app/uploads`。
（原先还给 nginx 挂过 `./backend/uploads:/usr/share/nginx/uploads:ro`，
已随第 6 节 ⑭ 的安全修复一起删除 —— 不再让 Nginx 直接读文件。）

㉓ **哪里执行迁移，16 章没写**：5.5 要求 Alembic，但 16.2/16.4 的启动流程没有迁移步骤。
`docker-compose.yml` 里 app 服务的 command 先 `alembic upgrade head` 再起 uvicorn，
并额外提供了 `migrate` 服务；这属于对 16.2 的补充。

㉔ **7.4 的 Prompt 清单缺结论卡片模板**：11.4 第 5 步与 11.11 都要求"结论卡片"，
但 7.4 表格里没有对应 Prompt。本实现新增了 `chat_conclusion.txt`。

㉕ **12.2「数据清理」没有对应文件**：4.1 的 `tasks/` 只列了 3 个 job 文件，
12.2 却有 4 条任务。本实现新增 `cleanup_job.py`。

㉖ **CORS 白名单不在 3.5 清单里**：3.10 说"后端配置CORS，允许 http://localhost:5173"，
但 3.5 没有 `CORS_ORIGINS`。本实现新增该变量（默认 5173），并在 DEBUG 下放开 `*`。

㉗ **`user_badges` / `profiles` 时间字段**：5.1 说"所有表带 created_at、updated_at"，
但 5.3 里 `profiles`/`profile_tags` 只有 `updated_at`，`messages`/`task_steps`/
`daily_answers`/`reports`/`badges`/`user_badges` 只有 `created_at` 或 `obtained_at`。
本实现**严格照 5.3 的字段表**，没有擅自加 `created_at`
（例外只有第 6 节 ⑤⑥ 明确授权的两个业务列，与时间字段无关）。

㉘ **画像初始化的时机未定义**：注册后是否立刻建空画像？手册没说。
本实现用懒创建（`profile_service.get_or_create_profile`），注册时也顺手建一条。
副作用见第 6 节 ⑧：因此**不能**用"画像对象是否存在"判断用户是否做过测评，要看 `tested`。

㉙ **[已决策：用户拍板] 数据库由 PostgreSQL 改为 SQLite**：

理由是这台机器没有 PostgreSQL 也没有 Docker，联调根本起不来；SQLite 让后端
起得来、跑得通、真正被验证（现在 4 条验收命令全部通过，见 §5.1.1）。

- **一套代码两种库**：切换只改 `DATABASE_URL`，不动任何代码；
- JSONB 通过 `JSONB().with_variant(JSON(), "sqlite")` 兼容，集中在
  `app/models/types.py`（**不要在模型里散写 JSONB**）；
- 排查结论：除 JSONB 外**没有**任何 PG 专有写法需要改写（无 `.op('->')`/`->>`/`@>`
  /`ILIKE`/`func.now()`/`DISTINCT ON`/`RETURNING`/PG 专有类型）；
- compose 里的 PG 服务**保留**但挪到 `--profile postgres` 下（生产可一键切回，
  默认 `docker-compose up` 不再启动它，也就不会因为依赖它而失败）；
- `psycopg2-binary` 在 requirements.txt 里改成**注释掉的可选项**（SQLite 不需要）；
- 完整差异清单、时区语义、Alembic batch 模式、切换步骤见 **§4.13**。

**手册需要回写的条款**（都属于"手册写 PG、现在默认 SQLite"）：
2.1 技术栈前端的"数据库 PostgreSQL"、2.3 后端选型的 "PostgreSQL" 与 "psycopg2-binary"、
2.6 最小依赖清单里的 `psycopg2-binary`、3.4 「创建数据库 createdb ai_career」、
3.5 环境变量里的 `DATABASE_URL` 示例、5.1「单库 PostgreSQL，不引入额外数据库」、
5.5 迁移步骤（SQLite 下建议先用 `python -m app.db.init_db`）、
16.2 docker-compose 的 db 服务与启动方式。

㉚ **[已决策：补 5.3 缺失的表] 新增 `test_questions` 表，题库真正落库**：

手册 5.2 只有 `test_results`（用户作答结果），没有题库表；5.4 却要求
"基础测试题 30-50 题"作为种子。早期骨架因此把题库硬编码在
`profile_service.TEST_QUESTION_BANK` 常量里，结果是**接口有数据、库里空着**：
`GET /test/questions` 返回 11 道常量题，`test_questions` 表根本不存在，
而且题目 id 是 `q_clarity_01` 这类"无源之水"。同类问题还有每日一问
（`FALLBACK_QUESTIONS` 常量 + 题库存空时返回**全零 UUID 的假题**，
前端拿这个 id 居然能写进 `daily_answers` —— 当时 SQLite 还没开外键强制）。

现在补一张题库表并让种子真正落库：

```python
class TestQuestion(SQLModel, table=True):
    __tablename__ = "test_questions"
    code: str          # 稳定业务编号（q_clarity_01），对外接口的 id 就是它
    dimension: str     # clarity/action/resume/interest
    content: str
    options: list      # [{"key","text","score"}]（跨方言 JSON 列）
    order_no: int      # 展示顺序（order 是 SQL 关键字）
```

- 种子在 `app/db/seed_data.py::TEST_QUESTIONS`（30 题，8/8/7/7 分布），
  由 `python -m app.db.init_db` 幂等灌入；同日还有 `DAILY_QUESTIONS`（30 题）与
  `BADGES`（2 枚）；
- `GET /test/questions`、`POST /test/submit` 的计分、`GET /daily/today`、`GET /badge`
  现在**全部读数据库**；空库时 `test/questions` 返回 `[]`、`daily/today` 返回
  `question: null`（**宁可为 null 也不造假**），提交时返回 1001 并提示先跑 `init_db`；
- 顺带把 `GET /test/questions` 的响应 schema 从 `TestQuestion` 改名为
  **`TestQuestionResponse`**（6.3 的 `XxxResponse` 命名规范，也避免与模型类同名）。

㉛ **[已决策] `submit_test` 改为原子事务 + 响应与落库一致**：

原实现是"写 test_results → commit → 写 profiles → commit → 写 tags → commit"，
于是：① 任何一步失败都会留下半成品（实测 500 之后 `tested` 已是 true、标签已落库，
用户看到失败但状态已变，重试还会产生重复 `test_results`）；
② 响应取自"测试原始分"，而 `apply_tags → recompute_stage` 在同一请求里又按真实行为
重算并落库，导致 **submit 返回 100/100/100/冲刺期，`GET /profile` 却是 40/准备期**。

现在：整个过程在**一个事务**里（`commit=False` 逐级传递 + 最后 `db.commit()`，
异常 `db.rollback()`），并且**先重算、再把落库后的画像值写回 `test_results`**，
使 `submit 响应 == test_results 行 == GET /profile`。实测：

```
clarity 62.5 / action 0.0 / resume 0.0 / total 25.0 / explore  —— 三处完全一致
```

㉜ **[已决策] `action_score` 把进行中任务的已完成步骤也计入**：

原实现只统计 `status == "已完成"` 的任务的步骤，实测"打卡后 `action_score` 仍是 0.0"，
用户看不到正反馈，与 11.6「完成步骤 → 打卡 → 更新画像」的意图相反。
现在分两部分：每个已完成步骤 +8（**无论任务是否结束**），每个整单完成的任务再 +20
（区分"有始有终"与"只是动了一下"）。实测打卡后 0.0 → 8.0，总分 25.0 → 27.8。

㉝ **[已决策：安全/正确性] SQLite 开启外键强制**：

SQLite 默认**不强制**外键，于是"FK 约束"只是装饰：实测往 `daily_answers` 插入
`question_id` 指向不存在题目的记录会成功（HTTP 200），留下永久孤儿数据。
现在 `app/db/session.py` 用 `event.listens_for(Engine, "connect")` 在**每条新连接**上
执行 `PRAGMA foreign_keys=ON`（只设一次是无效的，必须逐连接）。
实测：`PRAGMA foreign_keys=1`，孤儿插入被 `FOREIGN KEY constraint failed` 拒绝。
PostgreSQL 分支不需要（天生强制）。

㉞ **[已决策] HTTP 状态码由业务码统一推导（父 agent 修复，勿改回）**：

`deps.py` / `security.py` 里 6 处**裸构造** `BusinessException(ErrorCode.UNAUTHORIZED, ...)`
没有 `status_code`，导致"无 token 返回 HTTP 200 而不是 401"、伪造 token 也 200。
根因是只有 `HTTP→code` 表、没有 `code→HTTP` 表，于是同一个业务码两种状态码
（`.not_found()` 是 404，裸构造 `NOT_FOUND` 是 200）。
现在 `errors.py` 的 `CODE_TO_HTTP_STATUS` 是**唯一推导落点**，`__init__` 里按 code 推导，
便捷构造不再各自传 `status_code`；`RequestValidationError` 也统一成 400。
**编码规则：新增业务码时只在 `CODE_TO_HTTP_STATUS` 里登记一次。**

---

## 6.1 迁移与建表注意事项（与数据库相关的操作）

### 6.1.1 现在怎么建表（两条路，二选一）

| 场景 | 命令 | 说明 |
|---|---|---|
| **本机 SQLite 联调（已实测）** | `python -m app.db.init_db` | `create_all`，幂等可反复跑；**不写 `alembic_version`** |
| 正式库 / 想用迁移管理 | `alembic revision --autogenerate -m "init"` 然后 `alembic upgrade head` | 首选给 PostgreSQL；SQLite 下也可用（batch 模式已开） |

⚠️ **不要混用**：先 `create_all` 再用 Alembic 会导致 autogenerate 看不到表而重复建表；
反方向（先 Alembic 再 `create_all`）相对安全，`create_all` 会因为表已存在而跳过。
团队内统一一种即可 —— 现在本机默认走 `init_db`。

### 6.1.2 已补的 3 个列（授权偏离手册 5.3）

`migrations/versions/` 目前**是空的**（还没生成过迁移），这 3 个列都在**模型层**，
`create_all` 已经把它们真实建进 SQLite（DDL 实测见 §4.13.2）：

| 表 | 列 | 说明 |
|---|---|---|
| `messages` | `client_msg_id VARCHAR(64)` | 普通索引 + 与 `conversation_id` 组成复合唯一约束 |
| `conversations` | `followup_direction VARCHAR(50)` | 追问计数器：当前挖掘维度 |
| `conversations` | `followup_round INTEGER NOT NULL DEFAULT 0` | 追问计数器：同方向已追问轮数 |

另外**新增了一张表** `test_questions`（题库，见第 6 节 ㉚），所以首次迁移还会带上它。

因此：

1. **首次 `alembic revision --autogenerate -m "init"` 会直接带上这 3 个列与
   `uq_messages_conversation_client_msg` 唯一约束，无需手写任何 `ALTER TABLE`。**
   这也是当初趁早改表结构的原因 —— 等建完库再改就是数据迁移了。
2. 生成后请**人工核对**首次迁移：
   - `messages` 上是否出现 `client_msg_id` 列与 `uq_messages_conversation_client_msg`；
   - `conversations` 上是否出现 `followup_direction` / `followup_round`
     且 `followup_round` 是 `NOT NULL DEFAULT 0`；
   - **JSON 列的方言差异**：PG 迁移里是 `postgresql.JSONB`、SQLite 迁移里是 `JSON` ——
     Alembic 的 `compare_type` 对这两者不敏感，跨库复用同一份迁移时要留意；
   - SQLModel/SQLAlchemy 对 `UniqueConstraint` 的 autogenerate 支持是可靠的，
     但 `create_index` 与 `create_unique_constraint` 有时会分成两条语句，属正常。
3. 如果（且仅当）你在别的机器上已经建过库：需要手工写一个迁移补齐这 3 列，
   并且 `messages` 的唯一约束在建之前要先确认没有重复的 `(conversation_id, client_msg_id)`。
   骨架阶段不存在这种情况。
4. 老版本曾把幂等标记内联在 `content` 里（`<!--cmsg:xxx-->前缀`）。
   **没有任何生产数据**，所以不需要写数据清洗脚本；如日后真出现存量数据，
   清洗 SQL 形如（PostgreSQL）：
   `UPDATE messages SET content = regexp_replace(content, '^<!--cmsg:[^>]*-->', '') WHERE content LIKE '<!--cmsg:%';`
   SQLite 没有 `regexp_replace`，改用 `substr`/`replace` 或直接在 Python 里清洗。

---

## 7. 接口清单（手册 10.2 全部端点 + 3 个补实现/变体，其余未自创）

> 与手册 10.2 的差别（均已 [已决策]，见第 6 节 ④⑪⑫）：
> 1. Chat 的 SSE 端点**多了一个 POST 形式**（手册只有 GET）；
> 2. **新增** `GET /api/v1/home/summary`（首页聚合，把首页 4 个请求合成 1 个）；
> 3. **新增** `POST /api/v1/events`（行为埋点上报，当前只落日志、未持久化）。

| 模块 | 方法 | 路径 |
|---|---|---|
| Auth | POST | `/api/v1/auth/register` |
| Auth | POST | `/api/v1/auth/login` |
| Auth | GET | `/api/v1/auth/me` |
| Test | GET | `/api/v1/test/questions` |
| Test | POST | `/api/v1/test/submit` |
| Test | GET | `/api/v1/test/result` |
| Profile | GET | `/api/v1/profile` |
| Profile | GET | `/api/v1/profile/tags` |
| Profile | POST | `/api/v1/profile/feedback` |
| Chat | POST | `/api/v1/chat/conversations` |
| Chat | GET | `/api/v1/chat/conversations` |
| Chat | GET | `/api/v1/chat/conversations/{id}/messages` |
| Chat | POST | `/api/v1/chat/conversations/{id}/messages` |
| Chat | **POST** | `/api/v1/chat/conversations/{id}/stream`（SSE，**前端使用**） |
| Chat | GET | `/api/v1/chat/conversations/{id}/stream?content=...`（SSE，**调试用，前端不调用**） |
| Chat | GET | `/api/v1/chat/conversations/{id}/conclusion` |
| Resume | GET | `/api/v1/resume` |
| Resume | POST | `/api/v1/resume` |
| Resume | GET | `/api/v1/resume/{id}` |
| Resume | PUT | `/api/v1/resume/{id}` |
| Resume | POST | `/api/v1/resume/upload` |
| Resume | POST | `/api/v1/resume/{id}/optimize` |
| Resume | GET | `/api/v1/resume/{id}/report` |
| **Resume** | **GET** | `/api/v1/resume/{id}/file`（**鉴权下载**，安全修复，见 §4.10） |
| Interview | POST | `/api/v1/interview/start` |
| Interview | GET | `/api/v1/interview/{id}/questions` |
| Interview | POST | `/api/v1/interview/{id}/answer` |
| Interview | POST | `/api/v1/interview/{id}/finish` |
| Interview | GET | `/api/v1/interview/{id}/review` |
| Task | GET | `/api/v1/task` |
| Task | POST | `/api/v1/task/generate` |
| Task | GET | `/api/v1/task/{id}` |
| Task | POST | `/api/v1/task/{id}/steps/{step_id}/complete` |
| Task | POST | `/api/v1/task/{id}/abandon` |
| DailyQuestion | GET | `/api/v1/daily/today` |
| DailyQuestion | POST | `/api/v1/daily/answer` |
| Report | GET | `/api/v1/report` |
| Badge | GET | `/api/v1/badge` |
| **Home** | **GET** | `/api/v1/home/summary`（补实现，设计说明书 5.4，见 §4.8） |
| **Events** | **POST** | `/api/v1/events`（补实现，设计说明书 5.4，见 §4.9） |
| System | GET | `/api/v1/health`（骨架附加，探活用） |

---

## 8. 安全与隐私自查（第 14 章）

### 8.1 编码规则（写进规范，新人照做）

> **规则 1：查用户私有资源时，「不存在」与「不属于你」必须返回同一个错误码 `2001`。**
> 禁止用 `1003` 区分二者，否则错误码成为可枚举的 oracle。
>
> 为什么：如果"不属于你"返回 1003、而"不存在"返回 2001，攻击者遍历 id 时凡是回 1003
> 的即说明该记录**真实存在**（只是不属于自己），等于白送一份"哪些 id 有效"的清单；
> 结合其他信息还能进一步推断（谁在用、何时创建）。这也是 OWASP 对 IDOR 的通行建议
> （返回 404 而不是 403）。
>
> **怎么做**：不要手写 `if resource.user_id != user.id: raise ...`，统一用
> `app/core/errors.py` 的 helper：
>
> ```python
> from app.core.errors import not_found_unless_owner
>
> def get_xxx(db: Session, user: User, xxx_id: UUID) -> Xxx:
>     return not_found_unless_owner(db.get(Xxx, xxx_id), user.id, "xx不存在")
> ```
>
> `resource is None` 与 `owner_id != current_user_id` 走同一条 `2001` 分支。
> `BusinessException.forbidden()`（1003）**只允许**用在"请求合法但操作本身越权、
> 与资源归属无关"的场景（管理员接口、被封禁用户等）；当前业务里没有任何这种场景，
> 因此**用户私有资源相关的 1003 应当为零**。

> **规则 2：私有文件不得经静态目录暴露。** 一律走带鉴权的下载端点（§4.10）。

> **规则 3：对外 `stage` 一律 slug + `stage_label`**（§4.11），转换只在 schema 层做。

### 8.2 自查清单

- 密码只存 bcrypt 哈希，`UserResponse` 不含 `password_hash`；`User.__repr__` 不打印哈希。
- JWT `SECRET_KEY` 来自环境变量，默认值显式标注为"必须修改"。
- 所有"按 id 取用户私有资源"的 service 都过 `not_found_unless_owner`
  （14.5：用户只能访问自己的数据）—— 见 §6 ⑮ 的完整端点清单。
- **简历文件一律经鉴权端点读取，禁止静态目录直出**：
  `uploads/` 不挂 `StaticFiles`、nginx 不配 `/uploads` location、
  compose 不把 uploads 挂给 nginx；唯一入口是
  `GET /api/v1/resume/{resume_id}/file`（JWT + 归属 + 路径越界校验 + 文件名清洗）。
  详见 §4.10 与第 6 节 ⑭。
- **目录穿越防护**：下载前 `Path.resolve()` 规范化，并校验仍在 `UPLOAD_DIR` 之内
  （用路径层级比较，不用字符串前缀），越界按"不存在"拒绝。
- `utils/logger.sanitize()` 对 `sk-*`、password、Authorization、secret_key 做脱敏（14.6）。
- 系统 Prompt 与用户输入分不同 message role（14.7），AI 输出全部过 Pydantic 校验。
- 上传校验扩展名 + 大小（13.2），磁盘文件名用 `{uuid}.{ext}`（丢弃用户原始名），
  用户原始名清洗后仅作标题兜底（`utils/file.py`）。
- 埋点 `payload` 写日志前同样过 `sanitize()` 并限长（14.6）。

---

## 9. 需要人工确认的下一步

1. ~~统一响应策略与前端拦截器是否匹配~~ **[已决策]**：见第 6 节 ①②③。
   前端需注意：成功路径按信封 `code` 判，错误路径读 `error.response.data` 里的信封；
   **HTTP 200 也可能带失败业务码**。
2. ~~SSE 入参方案~~ **[已决策]**：前端用 `POST .../stream` + JSON body（第 6 节 ④、§4.6）。
   GET 版本保留为调试入口。
3. ~~补 `messages.client_msg_id` 列与追问计数两列~~ **[已决策]**：
   见第 6 节 ⑤⑥ 与 §6.1「迁移注意事项」。**首次 `--autogenerate` 会自动带上，
   无需手写 ALTER**；请人工核对首个迁移里这 3 列与
   `uq_messages_conversation_client_msg` 唯一约束都在。
4. ~~「有没有画像」的判据~~ **[已决策]**：前端看 `ProfileResponse.tested`，
   **不要**看画像对象是否存在（第 6 节 ⑧）。
5. ~~`/uploads` 无鉴权静态目录~~ **[已决策：安全修复]**：已删除静态挂载，
   简历文件改为 `GET /api/v1/resume/{id}/file` 鉴权下载（第 6 节 ⑭、§4.10）。
6. ~~其余端点的 1003/2001 不一致~~ **[已决策：安全修复]**：全仓库统一为
   「不存在与不属于你都返回 2001」，helper 是 `not_found_unless_owner`，
   规则见 §8.1、端点清单见第 6 节 ⑮。
7. ~~`stage` 编码不一致~~ **[已决策]**：全接口 slug + `stage_label`，见 §4.11。
8. ~~面试追问语义不明~~ **[已决策]**：追问=同一题再问，响应带 `action` 判别字段，
   见 §4.12。
9. **待办**：把补的 3 列（`messages.client_msg_id`、`conversations.followup_direction`
   / `followup_round`）回写到手册第 5 章（否则下一个读手册的人会漏列）。
10. **待办**：把 `/home/summary`、`/events`、`/resume/{id}/file` 补进手册第 10 章的
    接口清单（前两个目前只在设计说明书 5.4 里有）。
11. **待办**：把「越权一律 2001」与「stage 统一 slug」写进手册第 6 章后端规范
    （目前只在本文件 §8.1 / §4.11 里）。
12. **待办**：补齐第 6 节 ⑱⑲⑳ 涉及的表结构缺口（`interview_questions` /
    `test_results` 字段表、题库/任务模板/奖章表）。
13. **待办（想清埋点分析前必须做）**：补 `events` 表让埋点真正落库
    （第 6 节 ⑬：现在只写日志）。
14. **待办**：在装有 Python 3.12 的机器上执行 `pip install -r requirements.txt` + `pip check`，
    把版本号从"待验证"变成"已验证"。
15. **待办**：生成第一个 Alembic 迁移并核对 16 张表的 DDL（含 §6.1 的核对清单）。
16. **待办**：补题库（30-50 题 / 30 题每日一问 / 6 个任务模板）与种子数据。
17. **待办**：前端「追问进度环」按 §4.6.5 的语义实现
    （`start`/`delta` 用旧值、`done` 用新值、`followup_direction` 变化即重置、`null` 时隐藏）。
18. **待办**：前端首页改用 `GET /home/summary` 一次拿全，并按 §4.8 直接消费
    `next_action`（不要再自己拼「下一步」的逻辑）。
19. **待办**：前端读取简历文件一律用 `GET /resume/{id}/file`（带 Authorization），
    **不要**再拼 `/uploads/...` 这类路径（该路径已不存在）。
20. **待办**：前端面试流程按 §4.12 的 `action` 字段分派（`followup` 就地续问、
    `next_question` 追加、`finished` 调 finish）。
21. **待办**：前端 `stage` 一律按 slug 处理，展示用 `stage_label`
    （`normalizeStage` 可以简化成只认 3 个 slug 了）。
22. **待确认**：追问轮数的粒度（一轮对话算一轮 vs 一句话算一轮，见第 6 节 ⑩）。
