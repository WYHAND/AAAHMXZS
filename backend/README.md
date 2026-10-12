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
| ✅ 已有 DeepSeek API Key（`backend/.env`，不提交） | AI 链路已真机验证（开场白/对话/画像抽取），失败时仍走 7.6 兜底 |

**因此：结构、import、建表、OpenAPI、HTTP 冒烟均已验证；AI 链路已用真 Key 跑通；
L1（证据归属 + 素材带原话）与 L2（具体化追问 / 跨会话泄漏）的实现与已知局限见 §4.16.9~§4.16.11。**

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
#    --reload-include '*.txt' 是必须的：prompt 都是 .txt，而 --reload 默认只监听 .py，
#    不加这个参数时改了 prompt 不会重启进程，load_prompt 的 lru_cache 会一直吐旧文本
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-include '*.txt' --host 0.0.0.0 --port 8000
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
│   │       ├── chat_system.txt     # 7.5 原文；★规则 8/11/12 已改、新增 13/14 反杜撰（见 §4.16.3 / §4.16.7 / §6 ㊴）
│   │       ├── profile_extract.txt  resume_polish.txt
│   │       ├── interview_question.txt  interview_followup.txt
│   │       ├── interview_review.txt  task_generate.txt  daily_question.txt
│   │       └── chat_conclusion.txt # ★新增（11.11 结论卡片用，7.4 未列）
│   │           chat_opening.txt    # ★新增（新会话 AI 先开口，7.4 未列，见 §4.16）
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
├── uploads/                        # 历史上传文件目录（老简历链路已移除，见 §4.10；目录与历史文件保留）
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
| 测试表提交 | `profile_service.submit_test()`（选择题映射标签；`free_text` 在提交后 `await extract_tags_from_text(..., source="test")` 抽标签，见 §5.3） | `test` |
| 每轮对话 | `chat_service._extract_round_tags(conversation_id, user_id)`（`send_message` 与 SSE `stream_reply` 都调用） | `chat` |
| ~~简历解析 / 优化~~ | **已移除**（老的「上传 PDF -> 解析 -> ATS 评分 -> 报告」链路，2026-11 整体删除，见 §4.10） | — |
| 面试复盘 | `interview_service.finish_interview()`（复盘结果自带 `tags`；复盘 Prompt 负责产出） | `interview` |
| 任务打卡 | `task_service._extract_task_tags()`（行动力规则 + 反馈 AI 抽取） | `task` |
| 每日一问 | `daily_question_service.answer_question()`（累计 7 题触发，11.7） | `daily` |
| 简历完整度 | `profile_service.update_resume_score()`（现行调用点：`resume_service.polish_resume` / `save_my_resume` -> `resume_score`；`recompute_stage()` 仍直接读 `resumes` 表） | — |

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

| # | event | data（信封内的 data） | 说明 |
|---|---|---|---|
| 1 | `start` | `{"type":"start","conversation_id":"<uuid>"}` | 流已建立，前端切「生成中」态 |
| 2..n | `delta` | `{"type":"delta","content":"增量文本","conversation_id":"<uuid>"}` | 追加到当前气泡；可能 0..n 次 |
| n+1 | `tag` | `{"type":"tag","data":{"tags":[{"dimension":"痛点","label":"缺项目","weight":0.8,...}]}}` | 仅当本轮抽到新画像标签时出现，可能没有 |
| n+2 | `done` | `{"type":"done","message_id":"<uuid>","conversation_id":"<uuid>","conclusion_ready":false}` | 本轮结束 |
| n+3 | `end` | 字面量 `[DONE]`（非 JSON） | 流结束标记；前端据此关闭 ReadableStream |

各事件的完整线上样例（含信封）：

```
event: start
data: {"code":0,"message":"success","data":{"type":"start","conversation_id":"5c0f..."}}

event: delta
data: {"code":0,"message":"success","data":{"type":"delta","content":"嗯，我理解了。","conversation_id":"5c0f..."}}

event: tag
data: {"code":0,"message":"success","data":{"type":"tag","data":{"tags":[{"dimension":"痛点","label":"缺项目","weight":0.8}]}}}

event: done
data: {"code":0,"message":"success","data":{"type":"done","message_id":"a1b2...","conversation_id":"5c0f...","conclusion_ready":false}}

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

#### 4.6.5 字段说明（FIX 4）

| 字段 | 类型 | 出现位置 | 说明 |
|---|---|---|---|
| `type` | string | 所有事件 | `start`/`delta`/`tag`/`done`/`error`/`pending` |
| `content` | string | `delta` | 增量文本，直接追加 |
| `conversation_id` | uuid | `start`/`delta`/`done`/`pending` | 便于前端校验是否串了会话 |
| `message_id` | uuid | `done` | 本轮 assistant 消息 id，用于对齐消息列表 / 触发「结论卡片」拉取 |
| `conclusion_ready` | bool | `done` | 本轮结束后是否已有结论卡片。`true` 时前端调 `GET /chat/conversations/{id}/conclusion` 直接命中缓存（否则该接口会现生成一次，较慢） |
| `data.tags` | array | `tag` | 本轮新抽到的画像标签（已写库） |

> ⚠️ **已移除的字段：`followup_round` / `followup_direction`（7.7 追问计数器）**。
> 它们曾经出现在 `start`/`delta`/`done` 三个事件里，用于前端画「追问进度 1/3 · 达到 3 轮后
> 我会换一个方向继续挖」的进度环。用户已明确要求把这套「同一方向追问 3 轮后换维度」的机制
> 整体删除（"要保证代码都是有用的"），所以**事件里不再有这两个字段**，
> `conversations` 表上的同名两列也已通过 `scripts/drop_followup_columns.py` 物理删除。
> 前端**不要**再读它们（读到的一定是 `undefined`）。
>
> ⚠️ 注意别和 11.9 面试的追问搞混：`app/services/interview_service.py` 的
> `MAX_FOLLOWUP_PER_QUESTION = 2` 与 `InterviewAnswerResponse.followup_round`
> **是另一套东西，保留不变**。这里删掉的只是**聊天**侧的计数器。

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
        "target_route": "/task",
        "weight": 0.8
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
    "activity": [
      { "date": "2026-09-28", "steps": 0 },
      { "date": "2026-09-29", "steps": 2 },
      { "date": "2026-09-30", "steps": 1 }
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
| `ai_findings[].weight` | float | 证据强度，取自该痛点标签的 `ProfileTag.weight`（0-1）；没有标签权重时为 `0.0` |
| `ongoing_tasks` | array | 进行中任务，最多 **2** 条 |
| `ongoing_tasks[].done_steps` / `total_steps` | int | 由**一条 `GROUP BY` 查询**批量算出（不是每条任务查一次） |
| `ongoing_tasks[].current_step_title` | string \| null | 第一条未完成步骤的标题（**一条批量查询**取出所有未完成步骤后每任务取首条） |
| `activity` | array | **近 14 天**每日完成步数时间序列（含今天，按 `date` **升序**，缺数据的天**补 0**，固定 14 条）；异常时为空数组 |
| `activity[].date` | string | 日期 `YYYY-MM-DD`（口径见下） |
| `activity[].steps` | int | 当天完成的任务步骤数（`TaskStep.completed == true` 且 `completed_at` 落在该日） |
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
步骤统计 1 + 未完成步骤 1 + **活动序列 1** + 每日一问 1~2），**没有任何 N+1**。
其中 `activity` 用 `task_steps JOIN tasks` 的**一条 `GROUP BY`** 按天聚合，
不是按天查 14 次。

**`activity` 的按天口径**：与成长报告的活跃天数（`report_service._count_active_days`）
**完全一致** —— 直接对 `completed_at`（naive UTC 时间戳）取日期、**不做时区换算**，
`date` 就是该时间戳的 UTC 日期。要改口径时两处必须一起改，不能各写一套。
取不到活动数据时降级为**空数组**（`_load_activity_points` 自带 `try/except`），
不会让首页聚合失败。

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

### 4.10 简历文件访问（**老链路已移除**，2026-11）

> **该功能已移除**：老的「上传 PDF -> 解析 -> ATS 评分 -> 报告 -> 文件下载」整条链路已删除。
> 删掉的端点是 `GET/POST /resume`、`POST /resume/upload`、`GET|PUT /resume/{id}`、
> `POST /{id}/optimize`、`GET /{id}/report`、`GET /{id}/file`；服务层的
> `get_resume_file` / `get_resume_report` / `parse_uploaded_resume` / `optimize_resume` 等，
> 以及 `utils/file.py` 里的 `get_resume_dir` / `build_resume_path` / `resolve_download_path`
> 等文件工具一并删除。现行简历功能是「模板 -> 用户填 -> AI 只润色」：
> `GET /resume/template`、`GET|PUT /resume/mine`、`POST /resume/polish`（见 §4.2 / §7）。
> **现在没有任何对外读文件 / 导出文件的简历端点。**

#### 4.10.1 曾经的漏洞（历史记录，仍然不要重蹈）

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
静态挂载已删除（nginx / docker-compose 里的对应配置也删了）；虽然现在没有任何
读文件的端点，这条"不挂 `StaticFiles`"的决策**继续保持**（`uploads/` 下仍有历史文件）。

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
- **「今天是哪天」按用户日历日算，不按 UTC 日历日**：时间戳是 UTC，但「今日一问是否已答」
  「连续打卡几天」这类判断用的是用户所在时区的日历日。换算集中在
  `app/utils/time.py`（`APP_TZ_OFFSET` 默认 +8 小时，可用环境变量
  `APP_TZ_OFFSET_HOURS` 覆盖；`local_date_of()` / `local_day_range_utc()`），
  service/task 层**不要**再自己写 `datetime.now().date()` 拼窗口 ——
  本地日历日的 [`start`, `end`) 边界必须先换算回 naive UTC 才能和 `answered_at`
  这类 UTC 列比较（拿本地边界去比 UTC 值会整体错位 8 小时，本地 00:00–08:00
  答的题会被判成"今天没答"）。反过来，只比"过了多久"的地方（如
  `reminder_job` 的 STALE_DAYS）用 `utcnow()` 做差即可，与日历日无关。

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

### 4.14 会话标题规则与「删除会话不影响画像」

#### 4.14.1 标题只在创建时确定：`新对话 N`

- 创建会话（`POST /chat/conversations`）**未传 `title`** 时，服务端生成 **`新对话 N`**；
- `N` 以"该用户**已有会话数 + 1**"为起点，并往后跳过已被占用的编号
  （用户可以删会话，纯计数会撞名：有 1/2/3 后删掉 2，纯计数再建就会得到重复的"新对话 3"）；
- 传了 `title` 就用传来的值（会 `strip()`，全是空白视为未传）。

实现：`chat_service.next_default_title()`；**唯一的标题写入点**就是
`create_conversation()` 里那一行 `Conversation(user_id=..., title=title)`。

#### 4.14.2 决策：**不做**「用首条消息自动命名」

曾实现过"首条消息到达时把标题改成消息前 14 个字"，**已按用户要求完整回退**
（代码、辅助函数、注释、以及本节的相关描述都已删干净）。

> **决策理由（用户明确要求）**：标题行为必须**可预测**。
> 序号命名至少能确定"这是第几个会话"；而自动命名会在用户没预期的时候改变标题 ——
> 刚发一句话，列表里的名字就变了，用户会觉得"这东西自己乱改东西"。

因此 `send_message`、`prepare_stream`、`stream_reply` 里**没有任何修改 title 的代码**
（各留了一条注释说明"这里刻意不改标题"）。实测确认：建会话 → 发第 1 条 → 发第 2 条 →
`GET /chat/conversations` 与直接查库，标题始终是 `新对话 1`。

#### 4.14.3 决策：**删除会话绝不影响画像**

`DELETE /chat/conversations/{id}` 只删 `conversations` 与 `messages` 两类数据，
**一行 `profiles` / `profile_tags` 都不碰**。

> 为什么这是刻意的产品决策（不是实现遗漏）：
> 画像标签按 `user_id` 独立存储，它回答的是"**对这个人**已经了解到什么"，
> 与"这些信息是在哪次聊天里说的"无关。用户清理聊天记录是**界面整理行为**，
> 不该连带丢掉他积累的画像 —— 否则删一次记录就得重新测评，
> 而画像又是后续所有推荐（任务、简历、面试）的输入。
> 所以 `delete_conversation()` 里只出现 `Message` 与 `Conversation` 两种模型，
> 并写明了这条决策；以后若有人想"顺手清理画像"，请先看这一节。

实测：删会话前后 `GET /profile` 的 `tags` **5 条 → 5 条且内容逐字段完全一致**，
四个分数与阶段也完全一致（原始 JSON 对照见 §5.1.1）。

#### 4.14.4 删除会话的实现细节：显式删消息

```python
conversation = get_conversation(db, user, conversation_id)   # 不存在/越权 -> 2001

db.execute(sa_delete(Message).where(Message.conversation_id == conversation.id))  # ① 先删消息
db.delete(conversation)                                                          # ② 再删会话
db.commit()                                                                       # ③ 只提交这两类
```

**为什么显式删而不用级联**：模型里 `messages.conversation_id` 只是 `foreign_key`，
**没有** `ondelete="CASCADE"`；而且 SQLite 的外键行为取决于 `PRAGMA foreign_keys`
（本项目已在 `app/db/session.py` 逐连接开启 —— 见第 6 节 ㉝，但换个部署或迁移工具就可能没开）。
显式删除在"开不开外键强制"的库上行为一致，也顺带兼容 PostgreSQL 的 `NO ACTION`
（PG 上先删父行会直接报外键冲突）。

---

### 4.15 成长报告的新语义：GET 永远实时，保存才是快照

> **[已决策：用户拍板]** 三个产品改动（第 6 节 ㊲㊳）。原来的语义有问题：
> `GET /report` 是"有历史就返回最近一份、**完全不重算**"，
> 所以用户打了卡、改了分数，报告页还是旧数据。

#### 4.15.1 `GET /report` = 实时计算，从不落库

```
GET /api/v1/report  →  每次重新聚合当前数据（画像分数 + 任务统计 + 亮点 + 建议）
```

- **不写库**：实测连续 8 次 GET，`reports` 表**新增 0 行**（见 §5.1.1）；
- 改一个分数（打卡 / 提交测评）后**立刻**反映：实测 `action_score 0.0 → 8.0`
  而期间没有保存过任何报告；
- 查询参数 `refresh` **已废弃且被忽略**（保留只为不破坏老调用）。
  它在旧语义里表示"重算并落一份新报告"，也就是让 GET 产生写副作用 ——
  GET 不应该写库，需要快照请用下面的 `POST /report/save`。

#### 4.15.2 `POST /report/save` = 保存一份里程碑

```
POST /api/v1/report/save
body: { "user_note": "可选，最多 500 字" }      # 超长 -> 400 + code 1001
→ 把**当前实时数据** + user_note 落成 reports 一行（type="growth"）
→ 返回 data 形状与 GET 完全一致，其中 last_saved_at 是新时间、user_note 是刚存的
```

- 保存后这份快照成为**下一次 `score_delta` 的基线** → 紧跟其后的 GET `delta` 全为 0；
- 不传 `user_note` 也能保存（存空串）。

#### 4.15.3 `score_delta` 的语义与「没有基线」怎么判断

`score_delta` = **当前实时分数 − 最近一次「保存」的报告里的分数**。

- **从未保存过 → delta 全为 0**，但这**不代表"真的没变化"**：
  前端必须用 `saved` / `last_saved_at` 判断是否有基线
  （`saved=false` 时不要显示"变化 0"，应显示"暂无可对比的基线"）。
- 旧实现那行 `previous_content.get(x) or profile.x` 在"没有上一份"时会拿当前值当基线，
  结果必然得 0 —— 代码看起来像"真的对比过"，容易被误读；现在显式分成
  "没有基线 → 0" 与 "有基线 → 相减"两条路径。
- 实测：改分数 → 保存（基线 `action=8.0, total=2.8`）→ 再改（`clarity 0→100`）→ GET
  → `delta = {clarity: 100.0, action: 0.0, resume: 0.0, total: 40.0}`，与手算一致。

#### 4.15.4 `suggestions` 带 `pain_point`，让「报告 → 行动」闭环

`suggestions` 从 `List[str]` 改成对象数组：

```json
{ "text": "优先做一件能在 3 天内完成的小事，把行动分拉起来",
  "pain_point": "行动力不足" }
```

前端点这条建议时，把 `pain_point` 原样作为 `POST /task/generate` 的 `pain_point` 传过去，
就能让 AI 针对这个痛点拆任务。当前 4 条建议与对应痛点：

| text（给用户看） | pain_point（喂给任务生成） |
|---|---|
| 优先做一件能在 3 天内完成的小事，把行动分拉起来 | `行动力不足` |
| 先补齐简历的项目/实习描述，再考虑精修 | `简历没有可写的经历` |
| 多聊两个具体岗位的日常，把方向缩小到 1-2 个 | `职业方向不明确` |
| 保持节奏，下一步可以尝试一次全真模拟面试（兜底建议） | `缺乏面试经验` |

`task_service.TASK_TEMPLATES` 已补上这 4 个痛点对应的模板，
并用 `template_for_pain()` 做"精确命中 → 互相包含 → 默认模板"的降级匹配
（这样画像标签里的 `缺项目经验` 也能命中 `缺项目` 模板）。
实测：把 `行动力不足` 喂给 `POST /task/generate` 成功生成了 4 步任务（AI 真实参与）。

#### 4.15.5 产品红线：用户能改自己的补充说明，**不能改分数**

- `user_note` 存在 `content.user_note`，**与 AI/规则生成的 `highlights` / `suggestions` 分开存**，
  避免"哪些是用户写的"说不清；
- ⚠️ **分数（`clarity_score` / `action_score` / `resume_score` / `total_score`）不可编辑**：
  它们是对"行为证据"的度量，由测评、打卡、简历、面试算出。
  让用户手改就失去意义（想涨分只能真的去做事）。
- 代码层面的保证：`ReportSaveRequest` 里**根本没有分数字段**，
  `save_growth_report()` 只写 `content.user_note`；
  `report_service` 模块 docstring 也写明了这条红线。
  实测：保存请求里塞分数字段不会生效（Pydantic 直接忽略未知字段，分数仍来自实时计算）。

#### 4.15.6 为什么 `action_score` 应该靠"做任务"涨、而不是靠"聊天"

用户反馈"聊一百轮阶段也不动"，这是**设计如此**（"声称 ≠ 证据"）：
聊天只写画像标签（`profile_tags`），不碰分数；分数只由**可验证的行为**产生 ——
打卡涨 `action_score`、简历涨 `resume_score`、测评定 `clarity_score`。
所以正确的解法不是"聊天就涨分"（那样可以吹牛刷分），
而是**让 AI 引导用户去做任务证明**：`suggestions` 带 `pain_point` 就是为了这个闭环。

---

### 4.16 让 AI 先开口：`POST /chat/conversations/{id}/opening`

> **[已决策：用户提出]** 原来的流程是「AI 被动应答」：新建会话 → 空白输入框 →
> 用户先说话 → AI 才回复。问题出在**空白输入框**上：本系统的主要用户恰恰是
> "还没想清楚方向"的学生，面对一个空框最容易卡住，要么随便打一句、要么直接退出。
> 改成一个**具体、好回答**的第一个问题，冷启动成本立刻降下来。

#### 4.16.1 接口契约

```
POST /api/v1/chat/conversations/{conversation_id}/opening     （需鉴权）
→ data: MessageResponse        # 开场白**就是一条普通消息**，形状与 /messages 里的一模一样
```

> ⚠️ **响应格式没有变**：模型侧虽然改成了 JSON（`text` + `used`，见 §4.16.7），
> 但 `used` 是**服务端校验用的内部字段**，不落库、不返回。前端拿到的仍然只是
> 一条普通的 `MessageResponse`（`content` 就是那句话），不需要任何改动。

| 情况 | 行为 |
|---|---|
| 会话里**已有开场白** | 回放同一条（**幂等**，重复调用不会产生第二条） |
| 会话**没有任何消息** | 生成开场白并落库，返回这条消息 |
| 会话**有消息但没有开场白**（用户先说了话） | `{"code":0, "message":"会话已有消息，未生成开场白", "data":null}`，**不补开场白** |
| 会话不存在 / 不属于当前用户 | `HTTP 404` + `code 2001`（沿用 §8.1 的归属规则） |

"有消息就不补"的理由：开场白是**对话的第一句**。用户已经说过话之后再插一句
"你好呀，最近……"，它会排在用户消息**后面**，变成 AI 在自问自答 —— 语义是错的。
所以前端应该在**创建会话后立刻**调用本接口（见 §4.16.4）。

#### 4.16.2 为什么落库成一条真正的 assistant 消息

前端自己拼一句"你好，我是你的就业助手"最省事，但会同时丢掉三件事：

| 不落库会怎样 | 落库后 |
|---|---|
| 刷新页面 / 换设备就没了 | 它就是历史消息，`GET /messages` 一定读得到 |
| 模型不知道"自己说过这句"，下一轮会重复问 | 它进 `_build_llm_messages` 的历史，AI 有上文 |
| `conversation.message_count` 还是 0，列表显示"0 条" | `message_count = 1`（实测，见 §5.1.1） |

所以 `ensure_opening_message()` 走的是和普通回复完全相同的落库路径
（`messages` 表的 `role="assistant"` 行），只是多带了一个系统保留的
`client_msg_id = "sys:opening"`：

- 它**不是**内联进 `content` 的标记，`content` 存**纯文本**（§4.6 的同一原则）；
- 它的作用是让**数据库层**保证"一个会话最多一条开场白"：
  `messages` 表上已有 `UniqueConstraint(conversation_id, client_msg_id)`，
  两个请求同时进来时第二个 `INSERT` 会被唯一约束挡下，我们捕获 `IntegrityError`
  后**回滚并回放先落库的那条** —— 无需加锁、无需新表新列。
  实测两个并发请求都返回 `code 0` 且 `id` 相同，库里只有 1 行（见 §5.1.1）。
- 代价：并发时有一次 AI 调用被浪费。开场白一个会话只发生一次，这个代价
  远小于给每个会话加锁的复杂度。

#### 4.16.3 内容怎么来：一句人话、只问一件事、**绝不给选项**

> ⚠️ **2026-11 已被 §4.16.12 取代**：下面第 1 条（"有标签或有任务 → 必须引用背景"）、
> 第 5 条（"像人回忆起上次的事"）以及 `{stage}`/`{profile_tags}`/`{ongoing_tasks}` 三个占位符
> **都已经删除** —— 第一句话**只聊日常**，画像素材从第 2 轮起才可以用。
> 保留本节作为决策痕迹；当前语义以 §4.16.12 为准。

> ⚠️ **v2（用户否掉了 v1 的调性）**：v1 的开场白要求"必要给 2-3 个选项"，用户反馈
> **"这和让用户做选择题有什么区别"** —— 要的是**活人感**、**循序渐进**。
> 现在改成一个真人顺口问出来的一句话。

Prompt 模板 `app/ai/prompts/chat_opening.txt`（占位符 `{stage}` / `{profile_tags}` /
`{ongoing_tasks}`）由 `_opening_context()` 填充，数据源与 `chat_system` 完全一致
（阶段 / 画像标签 / 进行中的任务）。模板里的硬约束：

1. **第一步先分路，分错就全错**：有标签或有进行中任务 → **必须引用背景**；
   两个都是"暂无" → 只聊日常。（"有背景却问了一句'最近在忙什么'这种谁都能收到的通用问候"
   被明确写成最常见的错误。）
2. **一句话、≤60 字**（服务端 `truncate(text, 60)` 兜硬闸）；**一次只能问一件事**。
3. **硬性禁止任何选项**：`A/B/C`、`1/2/3`、`①②③`、"更接近哪种""选一个""以下哪种"
   "直接回字母"，以及任何"挑选腔/问卷腔/清单腔"。
4. **全新用户必须从日常小事切入**：可以问最近在忙什么、这周怎么样、有没有新鲜事；
   **严禁**一上来聊专业、方向、规划、职业目标、兴趣方向、求职/实习/简历
   （用户原话："刚开始聊天的时候可以不聊专业问题"）。「当前阶段」对全新用户没有参考价值。
5. **有背景时要像人回忆起上次的事**，不要像核对工单：允许"想起来你上次提过……"
   "还在弄吗"这种铺垫与一点点自我暴露，但**不要问"推进到哪一步了""现在什么状态"**。
6. 不许念系统术语（探索期/准备期/冲刺期）、不许念 `weight`/`source` 之类字段、
   不许要长文本（"详细说说""展开讲讲"）、不许自我介绍（"我是你的AI助手"）。

真实输出举例（**实测原文**，完整 6 条见 §5.1.1）：

```
全新用户：嗨，刚刷到你，最近这阵子都在忙啥呀？        （18 字，日常切入）
          嗨，最近在忙些什么呢？                      （11 字）

有标签：  嗨，想起来你之前提过喜欢剪片子，最近还有在剪吗？  （24 字，引用了标签「剪辑」）
有任务：  嗨，上次你说想先拿个现成模板搭个小网页练手，后来动手了没？（29 字，引用了任务）
```

#### 4.16.4 前端怎么接（建议时序）

```
① POST /chat/conversations                 -> 拿到 conversation_id
② POST /chat/conversations/{id}/opening    -> 拿到开场白消息，立刻渲染成一个 AI 气泡
③ 用户回复时走 POST /chat/conversations/{id}/stream（§4.6）
```

② 可以放心重试（幂等）。如果前端漏调了 ②，用户直接发了第一句，
再调 ② 会拿到 `data:null` —— 这是**预期行为**，前端此时只要忽略即可，
不要把它当成错误弹提示。

⚠️ 开场白**不写任何画像标签**：它是 AI 单方面说的话，没有任何用户输入，
就没有可回流的证据（"声称 ≠ 证据"，同 §4.15.6）。
实测：一个只被调用过开场白、从未发过消息的用户，`profile_tags` 与 `tasks` 都是 0 条。

#### 4.16.5 AI 不可用时：用**开场专用**的模板兜底（7.6）

> ⚠️ **2026-11 已被 §4.16.12 取代**：下面的"按有任务 / 有标签 / 全新用户三档"已经**不存在**了
> —— 三档模板现在**全是日常搭话**（不再引用任务标题/标签），`opening_fallback()` 也不再接受素材参数。
> 保留本节是为了留下"为什么曾经这么做"的决策痕迹。

`chat_text()` 的契约是"不抛异常，失败返回 `FALLBACK_CHAT_REPLY`"。
那句话术是**中途断线**用的（"我这边刚刚卡了一下，先说一句辛苦你了……"），
放在会话第一句非常突兀。所以 `_compose_opening()` 会显式判掉它，
换成 `ai/fallbacks.py::opening_fallback()` 里按背景丰度分档的模板：

| 背景 | 兜底开场白（**都是一句话、≤60 字、没有选项**） |
|---|---|
| 有进行中的任务 | 想起来你上次说想弄「{任务标题}」，还在弄吗？ |
| 有画像标签 | 想起来你之前提过「{标签}」，最近还有在琢磨吗？ |
| 都没有（全新用户） | 嗨，先随便聊聊吧，你最近在忙什么呀？ |

三档都遵循和 Prompt 同一套约束（**一句人话 + 只问一件事 + 绝不出现选项**，
全新用户那档从日常切入），所以**AI 挂了体验也只是"话术变固定"，不会退化成空白、
报错或一张选择题**。实测用假 Key 打这三档：全部 `HTTP 200` + `code 0`
且引用的任务标题/标签与库里一致（见 §5.1.1 的上一轮记录）。

#### 4.16.6 新会话不许重问同一件事（跨会话信息 = **禁止清单**，不是素材）

> ⚠️ **2026-11 修订（见 §4.16.12）**：开场白路径**不再注入**这份禁止清单了（它含**用户原话**，
> 与"第一句不许出现任何旧内容"直接冲突），开场白 Prompt 现在什么都不接收。
> 本节描述的注入块只剩**对话**路径（`as_prompt_block`）；`as_opening_block()` 已删。
> 候选剔除（`_drop_already_asked` / `_looks_referenced`）仍然保留，但只用于开场白的
> **生成后自检**（"提到已问过的素材就换模板"），不再用于喂 Prompt。

> **[已决策：用户报 bug]** "新的对话问的问题和旧的一样" —— 相隔 90 秒的两个新会话，
> 开场白问的是同一件事；用户已经在别的会话里答过"在"、又说了"突然不想搞了"，
> 新会话照样问"还在搞吗"。
>
> **[已决策：用户第二次报 bug —— "新对话 4 继承了新对话 3"]** 上一轮修完重复提问后，
> 又把**用户最近说过的话**当成"可以拿来发问的素材"注入开场白 Prompt，
> 于是模型顺着素材提问：用户在会话 3 里说过『健身，刷视频，看短句』，
> 新会话 4 的开场白就变成"嗨，你平时健身都练点啥呀"。用户的原话是
> **「新建对话就是用户自己想切换聊天内容了」**。
> 结论：跨会话信息**只有一个语义 —— 已经聊过、禁止再提**；它绝不能出现在"素材/候选"位上。

两个根因，**都不允许只靠"模型自觉"**来解决：

| 根因 | 修法 |
|---|---|
| 选材确定：`tags[0]`（权重最高）、`tasks[0]`（`updated_at` 最新）永远同一条 | 候选放宽（任务 ≤5 条**按标题去重**、标签 ≤8 条），并**硬剔除**已经聊过的候选 |
| "不重复提问"只看得见当前会话 | 注入**跨会话信息**：其它会话最近 ≤3 条开场白 + 用户最近 ≤6 句话，**一律只作禁止清单** |

代码落点（都在 `app/services/chat_service.py`）：

- `_collect_cross_session()`：查其它会话（排除当前会话）的开场白与用户原话，截断去重；
- `_looks_referenced()`：判断某段文本是否"提到了"某个任务/标签。三条信号，
  **宁可多剔不可漏剔** —— ① 最长公共子串 ≥3（『…通讯录小项目』-> "通讯录"）；
  ② 短词单字覆盖率 ≥0.5（标签『剪辑』-> "剪视频"）；③ 短词里的英文词根出现
  （标签『C语言』-> 开场白只写了"用C做个…"，**这条是实测漏网后补的**）；
- `_drop_already_asked(candidates, asked)`：把命中 `asked` 的候选剔除并打日志。
  ⚠️ **`asked` 有两个来源，缺一不可**：
  1. 其它会话的**最近 N 条开场白**（只剔最近一条的话，第 3 个会话还会捡起第 1 个问过的事）；
  2. **用户最近说过的话**（第二次修正新增）。用户刚聊过的话题即使还没被任何开场白引用过，
     也必须从候选里剔掉 —— 否则模型会顺着用户原话提问。判定复用同一个 `_looks_referenced`。
  剔完若候选为空，`tags_text`/`tasks_text` 退回"暂无"，Prompt 自动走"聊日常"那一路
  （这正是"新会话 = 新话题"想要的结果）；
- 注入块分两种：**开场白**路径用 `as_opening_block()`，**只给点名禁止清单、
  不给开场白原句**（实测给原句时模型会改几个字再用一遍）；其中的"用户最近说过的话"
  被明确写成「**已经聊过 = 禁止再提** …… **不是**可以拿来发问的素材，也不许拿它当铺垫」。
  **对话**路径用 `as_prompt_block()`，原句照给（对话中途那是有用的上下文）；
- **输出自检兜底**：生成后如果开场白又碰到了被剔除的候选，直接换成模板
  （模板只引用**保留下来的**候选）。**不额外调 AI**，所以不加延迟和成本。

Prompt 侧（`chat_opening.txt`）第二步已改写为「**新会话 = 用户想换一个话题**」的硬规则：
禁止清单里列过的一切不许再提、不许当铺垫，必须问一件和它们都无关的事
（换一个画像维度，或聊一件日常的小事）。它与原来那条"不许重问/换个说法也算重复"
**合并成了同一条**，不是两份互相打架的规则。
`chat_system.txt` 的跨会话规则同步（三处核对：当前历史 / 画像标签 / 跨会话区块）。

> **不能把"有背景就引用背景"搞死**：全新用户照旧只聊日常；有背景时**仍然必须真的引用背景**
> （`chat_opening.txt` 里"最常见的错误是明明有背景却问'最近在忙什么'"那句继续成立），
> 只是**不许引用最近刚聊过的那部分** —— 那部分已被服务端从候选里剔除，
> 所以 `tags_text`/`tasks_text` 变"暂无"时走日常是**正确**行为，不是退化。

#### 4.16.7 反杜撰：开场白必须**声明依据**，服务端逐字核对（机械保证）

> ⚠️ **2026-11 修订（见 §4.16.12）**：本节描述的"素材清单 + 三条校验"里，
> **素材清单现在恒为空**，`used` 也**必须是空数组**；`_validate_opening` 的 ③ 从
> "只在 `used=[]` 时生效"改成**无条件生效**，引导语表由 26 条扩到 **48 条**。
> 下面这张表和示例描述的是**当时**的语义，保留作为决策痕迹。

> **[已决策：用户提出]** 用户原话：
> **「没有的事情坚决不要杜撰，要严厉禁止这种事情」**。
>
> **真实事故**（就是这么被抓到的）：在解释"把标签里的 `extra.evidence` 喂给 AI 会怎样"时，
> 演示用的开场白写成了「你上次说帮同学修电脑，**那次是哪出问题**？」—— 两处都是编的：
> ①"帮同学修电脑"来自某次验收时**探针账号的测试文本**（agent 自己造的假输入），不是用户的真实数据；
> ②更要紧的是"**遇到过故障**"这件事**用户根本没说过**：素材里只有"帮同学修电脑"一个片段，
> 模型把它**加工成了一个新事件**。

Prompt 规则（`chat_opening.txt` 第四步 / `chat_system.txt` 规则 13、14）写得再硬，
也终究是"靠模型自觉"。所以开场白这一侧**多了一道机械保证**：

```
① 模型输出 JSON：{"text": "那句话", "used": ["这句话依据了哪条素材"]}（chat_prompt_json）
② 服务端拿 used 去和**本轮真实素材清单**逐字核对（chat_service._validate_opening，纯本地、不额外调 AI）
③ 任何一项对不上 -> 判杜撰 -> logger.warning 留痕 + 换成本地模板 opening_fallback
```

| 环节 | 落点 |
|---|---|
| 输出契约 | `app/ai/schemas.py::OpeningResult`（`text` + `used`，`used` 允许空数组） |
| 素材清单 | `OpeningContext.materials` = 本轮真的喂进 Prompt 的字符串（标签 label + **通过证据过滤的用户原话片段** + 任务标题），**逐条**存放 |
| 三条校验 | 见下面的表 |
| 兜底出口 | `_opening_fallback_for()`：日志里同时打出**素材清单、模型原文、换成哪条模板**，一条 warning 就能复盘 |

`_validate_opening()` 的检查（顺序即优先级；**2026-10 追加了 ③ 的并列分支与 ④⑤**，
完整说明见 §4.16.9 / §4.16.10）：

| # | 检查 | 判定为杜撰的例子 |
|---|---|---|
| ① | `used` 里每一项都必须能在素材清单里**找到**（原样包含，或 >=4 字的素材走 `_looks_referenced` 模糊匹配） | `used=["不存在的标签"]` |
| ② | `used` 非空时，`text` 必须**真的提到**其中至少一条（复用 `_looks_referenced`：模型改写措辞也算，"剪辑"→"剪视频"）。**并列分支**：或者话里**原样引用**了某条通过过滤的用户原话（`_quoted_user_evidence`，L1 的主路径） | `used=["看短句"]` 而话里既没有"看短句"、也没有它的原话 |
| ③ | `used` **为空**却在陈述关于用户的具体事实 -> 加严规则 | `text="你上次说帮同学修电脑，那次是哪出问题？"`（命中引导语「你上次」） |
| ④ | **跨会话**：话里出现了别的会话用户原话里的具体内容词（>=4 字）-> 判"复述其它会话"（`_restated_cross_session_item`） | `text="哦对，你之前说过是短剧哈哈"`（"短剧"来自另一个会话） |
| ⑤ | **内容兜底**：引导语后引用的那件事在 `materials` 里找不到出处（`check_reply_for_cross_session_leak`） | `text="你之前说过想用C做个通讯录，那次是哪出问题？"`（"哪出问题"没出处） |

⚠️ ④ 放在 ② 前面，且**无论 `used` 是否为空都跑**：模型只要随手申报一个合法标签
（`used=["看短句"]`），就能绕过 ③ 那条"只在 `used` 为空时生效"的启发式 —— 真实事故里
泄漏的"短剧"必须靠 ④ 才拦得住。

③ 的启发式（`_USER_FACT_HINTS`，26 条引导语：你上次/你之前/你说过/你提过/你做过/你负责/你会/
标签里/任务里……）**刻意偏保守：宁可误判成可疑而换成模板，也不许放过杜撰**。取舍写死在注释里：

- 假阳性（其实没杜撰却换了模板）-> 用户看到的只是**措辞变固定的模板话术**，体验不坏；
- 假阴性（真杜撰被放行）-> 用户看到"他从没说过的事"，这是**信任级事故**。

已知代价：`"你平时……"`这类**纯习惯性问法**（"你平时都忙些什么呀？"）**不入清单** ——
它在聊日常那一路太常见，拦掉会把聊天体验削得很难看，而它通常也不陈述具体事件。
另外，这条启发式**只在 `used` 为空时**才生效：正常路径（引用了素材）由 ①② 管，
不会误伤"你之前提过剪视频，最近还在剪吗？"这类**有依据**的正常开场白。

**接口契约不变**：`used` 只是服务端校验用的字段，不落库、不返回；`text` 照旧落成
`assistant` 消息、照旧 `truncate(text, 60)`；"绝不 500、永远有一句话可用"的契约也不变
（`chat_prompt_json` 的 `default=OpeningResult()` 保证任何解析失败都退化成模板）。

> ⚠️ **对话正文（`chat_system`）**：这一侧**只有 Prompt 层约束，没有机械保证** ——
> 对话是 SSE **逐字流式**输出的，做不到"先声明依据、服务端校验、再给用户看"。
> 详见 §4.16.8。

#### 4.16.8 ⚠️ 已知局限：对话正文只有 Prompt 层约束

必须说清楚，不要以为正文也做到了机械保证：

| | 开场白 | 对话正文（SSE） |
|---|---|---|
| 输出形态 | 一次性 JSON（先拿到完整结果再校验） | `stream_chat` **逐字 yield**，边生成边显示 |
| 机械校验 | ✅ 声明依据 + 服务端逐字核对，判杜撰就换模板 | ❌ **没有**，只有 `chat_system.txt` 规则 13/14 的 Prompt 约束 |
| 失败时的用户可见性 | 用户看到的永远是校验过的那一句 | 等到能校验时，话**已经显示给用户了** |

如果要给正文也上机械检查，代价是：**只能等整段生成完再做一次事后校验**
（把完整回复和素材清单比对，判杜撰后……），而那时：
① 用户已经逐字看完了整段回复，事后改写会"话在眼前跳一下"；
② SSE 的 delta 已经发出去了，服务端无法撤回（要么再补一条"更正"消息，要么做一个
"生成完先静默、校验通过再一次性推"的**伪流式**，那就把流式的体验收益丢掉了）。
所以这一轮**没有做**，只把 Prompt 规则加到最严；要上机械检查需要用户先拍板代价。

> **2026-10 追加（本节的"Partial"补丁）**：正文侧现在**有一个只留痕的事后检查**
> （`audit_reply_for_leak`），它不改写、不打断流，只记 warning。见 §4.16.10。

#### 4.16.9 L1：让 AI 看见用户自己说过的原话（证据归属 + 素材带证据）

> ⚠️ **2026-11 修订（见 §4.16.12）**：**证据归属（`evidence_for_tags` + `profile_extract.txt`
> 要求原样复制）保留**，因为画像档案里的原话从**第 2 轮**起仍然有用；
> 但**开场白路径不再使用它**（`OpeningContext` 没有 `tag_evidence` 字段了）。
> 本节里"开场白 Prompt 的 `{tag_evidence}` 一栏"只描述当时。

> **[已决策：用户拍板]** 用户原话：
> **「让 AI 看见你的原话（L1）可以……对话一定要向这样充满人的味道，要让用户有和人在对话的感觉」**。

**先修的前置坑（证据归属）**：`profile_tags.extra.evidence` 的语义是"用户原话"，
但历史数据里混进了 **AI 自己说过的话**（真实脏数据，全部在 `admin` 名下）：

| 标签 | 存的 evidence | 真相 |
|---|---|---|
| 能力/学习 | `会Java和C，说明你编程底子不算白纸` | AI 说的话 |
| 兴趣/产品 | `AI：你之前提过对技术/产品有点兴趣` | AI 的话（连 `AI：` 前缀都在） |
| 痛点/缺项目 | `有没有做过完整的小项目？` | AI 的问句 |
| 焦虑/中 | `比空焦虑强多了` | AI 的安慰 |
| 兴趣/健身·刷视频·看短句 | `健身，刷视频，看短句` | AI 的复述（用户原话是"我最近在看短句啊"） |

把这些"原话"喂回 Prompt，模型就会说「你上次说'有没有做过完整的小项目？'」——
**把 AI 的话安到用户头上**，正是用户明令禁止的那类杜撰（形式更隐蔽）。两道修法：

1. **写入端（修根因）**：证据只能来自**用户侧文本**。
   `chat_service._extract_round_tags()` 曾经传的是 `build_history_text(最近 8 条消息)` ——
   **整段 transcript**（`学生：…` 与 `AI：…` 拼在一起），这是"AI 的话被当成用户原话"的根因。
   现在它只传最后一条用户消息；而 `profile_service.extract_tags_from_text()` 在
   `source="chat"` 时**自己从库里取 `messages.role='user'`** 拼成抽取输入
   （`_user_side_text`），即使调用方哪天又传整段 transcript 也不会污染画像。
   测评文字补充 / 每日一答 / 任务反馈这三个来源本来就是"用户在表单里写的那一段"，不受影响。
   `profile_extract.txt` 同步写死"evidence 必须是学生原话、AI 的话不算、带 `AI：` 前缀就别抽"。
2. **读侧（挡历史脏数据）**：`profile_service.evidence_for_tags()` 要求每条准备进 Prompt 的
   evidence **必须能在该用户自己发过的消息里原样找到**（`app.utils.text` 做去空白/全半角/大小写
   归一化后子串匹配），找不到就丢弃并留痕（一条汇总 INFO + 逐条 DEBUG，带 user_id / 标签 / 片段）。
   **只认 `extra["evidence"]`，不认 `evidence_log`**（后者是历次追加的证据流水，混着大量模型改写）。
   **本函数只读，不改历史数据**。

**真实库统计**（`admin` / `wyh` / `wyh1` / `wyh2`，2026-10 实测）：
有 evidence 的标签 24 条（全部 `source=chat`）-> **通过 7 条 / 被挡 17 条**；
按 evidence 条数算是 **通过 30 / 被挡 37**（合计 67 条，含 `evidence_log`）。
被挡清单见 `README` 的提交记录或 `evidence_for_tags` 的 INFO 日志；
被挡的典型就是上表那 5 条 + `我想学习ai`（用户实际打的是"我想学ai"，一字之差也不放行）。

**素材呈现（L1 的产出）**：`_opening_context()` 给通过过滤的标签附上原话，渲染成 Prompt 的
`{tag_evidence}` 一栏，格式刻意做成"容易原样抄"：

```
看短句（兴趣）｜他说过："健身，刷视频，看短句"
```

没有可引用原话的标签**只给标签**（真实数据里测评/每日一答/任务来源的标签没有一条有原话，
**不许伪造**）。这些原话片段**必须并进 `OpeningContext.materials`** —— 否则模型按 Prompt
要求原样引用它时，`_validate_opening` 检查①会判"依据在本轮素材里不存在"而**误杀合法引用**
（这是本轮最容易踩的联动 bug）。

`_validate_opening()` 因此多了一条**并列分支**（`_quoted_user_evidence`）：检查②除了
"话里提到申报的那条素材"，还接受"话里原样引用了某条通过过滤的用户原话"——
因为**标签与它对应的原话是同一件事的两种粒度**（申报 `used=["看短句"]`、引用
"健身，刷视频，看短句"是合法输出）。传 `evidence=None` 时行为与加 L1 之前**逐字节一致**。

**对话路径（`_build_llm_messages`）同样带证据**，并且这里要分清两件**不冲突**的事：
「上一段对话的内容」是**禁止清单**（一个字不许提，见 §4.16.6）；而
「画像档案里沉淀下来的原话」来自 `profile_tags`、跨会话存在（`delete_conversation` 明确不删
profile_tags），引用它是"记着这个人"，**不是**承接上一个话题。证据同样过 `evidence_for_tags`，
并排除当前会话（历史里本来就有）。

Prompt 侧（`chat_opening.txt` 情况一）新增：优先引用「他本人写过的原话」那一栏、
**必须原样照抄**、没有原话的标签就只提标签，并给了两条用户点名的风格例句
（「你标签里有『看短句』这一条，这块是怎么来的？」/「你提过帮同学修电脑 —— 愿意多讲讲吗？」）。

#### 4.16.10 L2：逼它往具体里挖 + 正文跨会话泄漏的只留痕自检

> **[已决策：用户拍板]** 用户原话：
> **「让 AI 追问往具体里走（L2）可以这样解决：这是解决问题不够深的一步」**。

`chat_system.txt` 的改动（**编号勘误**：任务里说的"规则 9 先问进展"实际是文件里的**规则 8**，
原规则 9 是"绝不让用户写长文本"，那条没动语义、只把"一进只问一个问题"写得更硬）：

- **规则 8 重写**：不许把聊天变成"核对进度"或"做选择题"（出现即失败）——
  ① **只禁止"进度核对式的是非题"，不是禁止所有带"吗"的问句**（2026-11 二次收紧：
     上一版写成"禁止是非题"被收过头，连用户亲口给的正例都会被禁掉，用户原话：
     「**规则应该精确到"禁止是非题式的进度核对"，而不是"禁止所有带'吗'的问句"**」）。
     判定口径写进 Prompt，只有一条：**这个问题的答案能不能自然地展开成一段话？**
     能展开（他答完还愿意多说两句）-> **放行**，哪怕带"吗"；只能回"是/否/嗯/还行"、
     答完没下文 -> **禁止**。禁止清单：还在弄吗 / 还在搞吗 / 推进到哪了 / 做得怎么样了 /
     有进展吗 / 动了吗 / 做完了吗 / 试了吗 / 是不是卡住了 / 找到方向了吗。
     允许清单（明确写出，避免下次又收过头）：带**方向猜测**的「大三学 Java，是打算往开发方向走吗？」
     （用户亲口正例）与**日常好答**的「你们学校食堂好吃吗？」（`chat_opening.txt` 示范例句）。
  ② **二选一/多选一，哪怕不带编号**（"是A还是B""A 还是 B""要么…要么…"）。
  用户最早否掉的就是问卷腔，真实事故里三句被投诉的话有两句是这个形态：
  「你平时去健身吗，**还是**就偶尔动一动？」「卡在哪了，**是**看课程看不懂，
  **还是**跑代码的时候报错搞不定？」。**正面替代形态**也写进去了：开放式、具体、不带预设
  （「具体卡在哪一下？」「上次动手的时候，第一步就卡住，还是写到一半才卡？你先说说当时在干嘛。」
  「那个报错长啥样，你还记得吗？」），并明确"**不是**换一种说法再问一遍进度"。
  同时写明与规则 7 的边界：**重复提问 = 同一件事的同一层（禁止）；往下追 = 同一件事的更深一层（鼓励）**，
  允许顺着同一件事追 2-3 层。
- **规则 12** 补：用户答得很短（"嗯""还好"）时**不要硬追**，换一个更小的具体切口。
- **规则 16（新）**：**不许承接别的会话** —— 只能依据"当前这段对话里用户说过的话 + 画像档案"，
  其它会话的内容一个字都不许提、不许当铺垫、不许说成"你之前说过"。反例直接用真实事故：
  「哦对，**你之前说过是短剧**哈哈，我给记岔了」（"短剧"来自另一个会话，而且同句自相矛盾）。
- **规则 17（新）**：往下追只能问、不能替他补（"后来是不是没做成？"也是杜撰）。
- **规则 18（新）**：像个人一样说话 —— 口语、平等、可有一点自我反应/自我暴露，
  **不许油腻、不许卖惨、不许灌鸡汤、不许客服腔/问卷腔/系统术语**。
- **规则 19（新）**：**该换主题就换主题** —— 同一件事追到 2-3 层、或用户明显淡了
  （"你就没有什么别的想问我的吗"），就**从画像档案里换一个还没聊过的主题**；
  换的是主题不是同一层的浅问，且照样不许用选择题腔、不许从别的会话搬内容。

**正文注入块（`CrossSessionContext.as_prompt_block`）措辞升级**：从"别再重复确认状态"
升级为"**这些不是素材，是别再碰的清单**：一个字都不许提起、不许当铺垫、不许说成
'你之前说过/你上次提到/我记得你'"，并补一句"✅ 唯一允许依据的：当前对话里用户自己说过的话 + 画像档案"。
（与开场白路径 `as_opening_block` 的措辞对齐。）

**正文侧机械手段（只留痕，不改写、不打断流）**：`audit_reply_for_leak()` 在
`send_message` / `stream_reply` 落库之后跑一次「这句话里关于用户的事实有没有出处」自检
（`check_reply_for_cross_session_leak`）：扫 `_USER_FACT_HINTS` 的引导语，取引导语后 12 个字，
要求它跟**允许范围**（当前会话用户消息 + 画像档案）有连续 2 字的重叠；找不到出处就
`logger.warning("正文疑似跨会话泄漏 conversation_id=… ｜ 回复原文=…")`。
**它不是拦截**（正文是流式的，用户可能已经看到），只用于统计泄漏频率与事后复盘。

**开场白侧的机械拦截（`_compose_opening` 自检③）**：`_restated_cross_session_item()` 把
**别的会话里用户自己说过的话**抽成"内容词"（2-4 字、排除虚词与"健身/标签"这类没辨识度的
常见字组合），命中 >=4 字的具体内容词就判"复述了其它会话"，换本地模板。
真实事故原文 `哦对，你之前说过是短剧哈哈，我给记岔了` 会被拦住（依据 = "说错了，我说的是看短剧"）。
`_restated_cross_session_item` 的注释里记了**两条走过的弯路**（"整个注入块提到就判"、
"重合度比例"），都因为误杀率太高被否掉。

#### 4.16.11 ⚠️ 仍然拦不住的东西（别以为已经解决了）

- **正文侧没有拦截**，只有 warning 留痕（§4.16.10）。用户看到的内容**不会被改写**。
- **跨会话泄漏的判据是启发式**：靠"4 字内容词"识别，模型把别会话内容**完全改写**成自己的话
  （"你以前好像聊过追剧那事"）就抓不到。真正的防线是 Prompt 规则 16 + 画像素材只来自当前允许范围。
- **`"你每天……"` 这类频率/程度加工**：`_has_content_overlap` 只要求"有出处"，素材是
  "健身，刷视频，看短句"时"你之前每天都在看短句吧"仍可能过（"短句"有出处）。
  拦它靠 `_validate_opening` 检查②（申报的依据与话对不上）与 Prompt 第四步，不是这条兜底。
- **开场白证据只有"标签级"粒度**：`evidence_for_tags` 只认 `extra["evidence"]` 一条，
  `evidence_log` 里可能有也能通过过滤的原话，但**有意不用**（那里模型改写的比例很高）。
  所以某些标签会退化成"只给标签"——这是设计取舍，不是 bug。
- **过滤只认 `messages.role='user'`**：测评文字补充 / 每日一答 / 任务反馈里的用户文字
  （`test_results.free_text` / `daily_answers.answer` / `task_steps.feedback`）**不在认可范围内**。
  宁可漏（那些来源目前一条带 evidence 的标签都没有），也不放宽（一放宽就等于重新打开
  "非用户消息也能当证据"的口子）。

---

### 4.17 `POST /task/generate` 的服务端去重（不再只靠模型自觉）

> **[已决策：用户报 bug]** 同一个痛点连点几次「生成任务」，库里就多出标题几乎一样的任务
> （实测 `admin` 名下 7 个「进行中」里有 2 对同题）。根因：`task_service.generate_task()`
> 只是把已有标题塞进 prompt，**服务端不做任何校验**，模型照样吐同题，然后无条件 `db.add()`。

**接口契约（前端按这个接，不要去匹配 message 里的中文）**：`response_model` 从
`ApiResponse[TaskDetailResponse]` 换成 `ApiResponse[TaskGenerateResponse]`，
后者只多一个字段：

| 场景 | `data.reused` | `message` | `data` | 其它 |
|---|---|---|---|---|
| 正常新建 | `false` | `"success"` | 新任务详情 | 不变 |
| 命中同题「进行中」任务 | `true` | `"已经有一个类似的任务了，没有重复生成"` | **那条已有任务**的详情（`id` 不变） | **不新建、不写库** |

出错路径、`code`、HTTP 状态码规则（`app/core/errors.py` 的 `CODE_TO_HTTP_STATUS`）**一律没动**。

**判定规则（保守：宁可漏判，不可误判）**——实现在 `app/utils/similarity.py`，
`generate_task()` 生成后用 `_find_duplicate_task()` 校验：

1. **只比「进行中」**：已完成 / 已放弃的同题任务不算重复（放弃后想重做是合理的），
   它们只进 prompt 当"可承接/加深"的素材；
2. **只比标题，不比 `pain_point`**：同一痛点下产出两件不同的事是正常的
   （实测「迷茫」下有"技术方向小实验""用代码解决一个身边小问题""Java 命令行小工具"
   三件都要继续允许）。**按 pain_point 去重会让用户再也拿不到新任务，这是最容易改错的地方**；
3. 相似度就是 `cleanup_duplicate_tasks.py` 一直在用的 `normalize()` + 字符 bigram Jaccard，
   阈值 `0.6`。这次把它抽到 `app/utils/similarity.py`，**脚本改成 import 它**，
   避免"接口认为不重复、脚本认为是重复"的两套口径漂移；
4. `task_generate.txt` 同步把 `{existing_tasks}` 拆成
   `{active_tasks}`（进行中，同题红线）与 `{finished_tasks}`（已完成/已放弃，可承接）。

**实测**（真调 API，探针账号已清理）：`pain_point="职业方向不明确"` 连点 3 次 ——
第 1 次 `reused=false`（新建《用 3 天做一次职业方向小实验》），第 2、3 次 `reused=true`、
`data.id` 与第 1 次相同、进行中任务数 `1 -> 1 -> 1`；同一痛点下模型确实产出不同的事时
（「迷茫」连点 3 次得到 3 件不同任务）仍然全部新建 —— 去重没有把功能锁死。

---

### 4.18 `GET /api/v1/daily/history`（每日一问历史，前端历史区用）

> **[已决策：补端点]** 用户答过的每日一问一直在 `daily_answers` 里，但 10.2 没有
> 历史端点，前端历史区只能走空态（用户看不到自己答过什么）。契约由用户冻结，前端按此接。

**契约**（需登录；只查"当前 token 的用户"，不接收任何 id，因此不涉及 2001）：

```jsonc
// data
{
  "total": 1,                       // 该用户答过的真实总条数（不受 items 上限影响）
  "items": [                        // 按 answered_at 倒序（最新在前）
    {
      "id": "<daily_answers.id>",
      "question_id": "<daily_questions.id>",
      "content": "<题干原文>",
      "dimension": "<维度，如 兴趣/能力>",
      "answer": "<用户答案>",
      "answered_at": "<ISO 时间戳>"
    }
  ]
}
```

实现：`app/api/v1/daily_question.py::history` + `daily_question_service.get_history()`
+ `app/schemas/daily_question.py::DailyHistoryItem/DailyHistoryResponse`。

- **不分页**：10.2 没有分页约定，不自创 `offset`/`cursor`。只加服务端硬上限
  `HISTORY_MAX_ITEMS = 100`（`items` 最多 100 条，`total` 仍是真实总数）——
  纯粹是"极端脏数据别一次吐爆响应体"的兜底，不是分页。
- **容错 join**：题干/维度来自 `daily_answers` join `daily_questions`。外键虽然存在，
  但题库重建/历史脏数据可能让某条回答找不到题目：此时该条**照常返回**，
  `content` 给 `""`、`dimension` 给 `null` 并在日志里 warning（**不静默丢条目** ——
  丢了用户会以为自己的打卡消失），也不会因为一条脏数据让整个历史 500。
- 题干一次 `IN` 批量查出，没有 N+1。
- **实测**（真库真数据，探针已清理）：`wyh2` 那条 2026-09-25 16:04:45(UTC)
  「如果可以选，你更想做哪种工作？」返回 `total=1` 且字段逐字一致；探针铺 3 条不同日期
  → 严格倒序；铺到 104 条 → `total=104` / `items=100`；把 `question_id` 改成不存在的题
  → 该条 `content=""`、`dimension=null` 且仍在 `items[0]`；无答题记录的新用户 → `{"total":0,"items":[]}`。

#### 4.16.12 🆕 2026-11（第三次修正）：**开场只聊日常，画像从第 2 轮起才可以用**

> **[已决策：用户第三次报同一类问题]** 用户截图现场：`admin`（档案最丰富）新建对话，
> 第一句是「**你之前说想学ai，这块是怎么来的？**」。用户原话：
> **「新对话依旧没有解决问题，还是再问之前的东西，可以问，但是坚决不可以直接在第一句话的时候问」**
> 「我要的是**循序渐进**，第一个问题可以不问这些啊，**随便聊聊天**，比如你今年大几了，
> 比如你今天上的什么课啊」「**没有衔接上一个问题**，也完成了新对话的责任
> （换一个新的 AI 和用户聊天）」「要重视新对话这个问题」。
>
> **[追加：用户给的正反例]** 用户回「**我大三了，在学 Java**」——
> ✅ 第二句应该是「**大三学 Java，是打算走开发方向吗？**」（既是追问，也是画像引入）；
> ❌ 第二句变成「**你的标签里有'缺项目'，要不要聊聊这个？**」就是"档案回顾"，不对。

**这一版把"开场白引用画像"整条路撤掉了**（前两版的 `as_opening_block` 禁止清单注入、
L1 原话证据、任务/标签候选全部不再进 Prompt）：

| 环节 | 现在是什么 |
|---|---|
| 开场白 Prompt 变量 | 只有一颗**与用户无关**的随机「话题种子」（`{topic_seed}`，8 条日常话题池）。标签 / 任务 / 用户原话 / stage **一律不给** |
| `OpeningContext.materials` | **恒为空列表**（可断言）。`tag_evidence` / `first_tag_label` / `first_task_title` / `stage` / `recent_context` 字段已删 |
| 开场白兜底模板 | `OPENING_FALLBACK_VARIANTS` 三档**全是日常搭话**：「嗨，今天过得咋样？」「你今天上什么课了呀？」「你今年大几啦？」；`opening_fallback()` **不再接受素材参数** |
| `_validate_opening` | ① **无条件**扫用户事实引导语（48 条，旧版只在 `used=[]` 时才扫，模型申报一个标签就能绕过）；② `used` **必须为空数组**（素材恒空 -> 任何申报都对不上 -> 判违规）；③ 保留旧的"素材非空时"兼容分支 |
| `chat_system.txt` | 新增**规则 20**（第一句只聊日常、画像最早第 2 轮起才可以用、阶段永不说出口）、**规则 21**（画像只用来"理解与选题"、不许当"发言内容"、附**档案播报**句式黑名单与用户给的正反例）、**规则 22**（每一句都要锚在用户刚说的那句话上，禁止凭空切换话题） |
| 正文自检 | `audit_reply_for_leak()` 除"跨会话泄漏"外**再扩一类**：`_PROFILE_NARRATION_HINTS`（23 条"你的标签/你的画像/系统记录/档案里/根据你的测评…"）命中即 `logger.warning`，**只留痕、不改写、不打断流** |
| 跨会话拦截 | `_restated_cross_session_item` **保留**（它现在更该拦得住：第一句本来就不该提任何旧内容）；`CrossSessionContext.as_opening_block()` 已删（那段文字含用户原话，与"第一句不许有旧内容"冲突） |
| `profile_extract.txt` | evidence 必须是**用户原话的连续子串、一个字都不许改**；找不到可复制的片段就留空字符串，**不许概括**（修"我想学ai -> 我想学习ai"那类改写） |

实测（临时实例 8123/8124/8126，真 Key / 假 Key / 本机坏 JSON stub；**用户 8000 端口全程没动**；
探针与自造会话已清理，见 §5.1.1 的表格）：`admin` 名下 5 次 `/opening` 的模型原始返回
`used` **全部为 `[]`**、文本全是日常（9/9/12/16/18 字，无标签/任务/原话/选项）；
探针账号脚本化 6 轮（**非流式 `POST /messages`**）：第 1 轮日常，第 2 轮起以"用户刚说的那句话"
为锚点（"大三学 Java，是打算往开发方向走吗？"），**全程 0 次档案播报**。
（流式 `POST /stream` 的同一套规则**随后单独补验过** —— 见 §5.1.1 最新一轮；两条路径共用
`_build_llm_messages`，所以规则文本一致。）

⚠️ 仍然成立的老契约：`sys:opening` 幂等、`truncate(text, 60)`、绝不 500、
开场白不写任何画像标签（见 §4.16.1 / §4.16.7）。

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
| ① | `python -c "from app.main import app; print(len(app.routes))"` | `routes= 49` |
| ② | `python -m app.db.init_db` | **17 张表**建成 + 种子落库（30 测试题 / 30 每日一问 / 3 奖章），幂等重跑无错 |
| ③ | `python -c "app.openapi()"` | `paths= 40`，`components.schemas= 86` |
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

**最近一轮（删除会话 + 标题序号）：16 项断言全部 PASS**

| 验收项 | 实测结果 |
|---|---|
| 建 2 个会话的默认标题 | `新对话 1` / `新对话 2` |
| 发第 1 条消息后标题 | 仍是 `新对话 1`（**未变**） |
| 发第 2 条消息后标题 | 仍是 `新对话 1`；库里 `conversations.title` 也是 `新对话 1` |
| 删除前 `GET /profile` | `tags=5`：`[兴趣/产品, 痛点/迷茫, 认知/模糊, 兴趣/沟通组织, 焦虑/中]` |
| `DELETE /chat/conversations/{id}` | `HTTP 200` + `{"code":0,"message":"success","data":null}` |
| 删除后 `GET /profile` | `tags=5`，**内容逐字段完全一致**；分数/阶段也一致（`62.5/0/0/25/explore`） |
| 消息是否删干净 | 库里 `select count(*) from messages where conversation_id=?` = **0**；`GET /{id}/messages` → 404/2001 |
| 重复删除 | 404/2001（已不存在，符合预期） |
| 越权删除（B 删 A 的会话） | 404/2001，且 A 的会话**仍在**（剩余会话数=1） |
| 序号不重名 | 删掉"新对话 1"后再建 → `新对话 3`，标题集合 `['新对话 3','新对话 2']` 无重复 |

**AI 链路已不再是"未验证"**：这一轮 `backend/.env` 里配置了真实
`DEEPSEEK_API_KEY`，于是下面的链路被**真实调用**并成功返回（不是兜底话术）：

- `chat_text()`（非流式对话）：返回了贴合上下文的真实回复；
- `chat_prompt_json()` + `profile_extract` **结构化输出**：返回 4 条带 `evidence` 的标签
  （`兴趣/产品 0.9`、`痛点/迷茫 0.9`、`认知/模糊 0.8`、`焦虑/中 0.6`），
  并被 `apply_tags` 的权重融合规则写进 `profile_tags`（第二轮后权重 0.86，
  `evidence_log` 累积）—— 说明 **Pydantic 校验 + 兜底逻辑 + 回流入库整条链路都通**。

仍未验证的是**流式**（SSE）调用与其余 Prompt（`interview_*` / `task_generate`
真实调用；其中 `task_generate` 在本轮走的是兜底任务，因为当时未配 Key）。

> 更新（2026-11）：`resume_*` 里的 `resume_polish` 已用真 Key 跑通（见 §5.1 最新一轮）；
> `resume_parse` / `resume_optimize` 两个 Prompt 已随老 ATS 链路移除（见 §4.10），
> **不再是**"未验证"项。

**最近一轮（反杜撰：开场白"声明依据 + 服务端逐字核对"）：正例 1 条全过 + 反例 4 组全拦 + 回归 4 项全过**

改动见 §4.16.7；探针实例跑在临时端口 **8020**（真 Key）/ **8030**（假 Key + 独立临时库）/
**8031**（假 LLM stub + 独立临时库），**用户的 8000 端口进程全程没动**。探针账号已按 §5 清理。

| 验收项 | 实测结果 |
|---|---|
| **正例：探针 `opening_anti_fab_9f3c1a` 的真实素材** | `tags_text = 缺项目经历（痛点）、数据分析（兴趣）、行动力待提升（能力）、传媒（兴趣）`；`materials = ['缺项目经历','数据分析','行动力待提升','传媒']`（另跑一轮带 `看短句` + 任务`帮同学修电脑`） |
| 正例的模型**原始**结构化返回（打桩抓取，真 Key） | `{'text': '嗨，之前你提过对数据分析挺感兴趣，最近有在碰这块吗？', 'used': ['数据分析']}` —— `used` 不是空的，模型真的在申报依据 |
| 正例的完整 `POST /opening` 返回 | `{"code":0,"message":"success","data":{"id":"214b712d-…","conversation_id":"a3cd1555-…","role":"assistant","content":"嗨，你标签里有个看短句，平时都爱看哪些呀？","client_msg_id":"sys:opening","created_at":"2026-10-02T06:52:09.982067"}}`（HTTP 200） |
| **`used` 都在素材里（逐条对照）** | `used=["数据分析"]` -> 素材清单第 2 项完全一致 ✅；`used=["看短句"]` -> 素材清单第 1 项完全一致 ✅；`text` 里字面出现该素材（脚本断言：`text 里字面出现的素材 = ['看短句']`）；服务端日志**无**任何"判定不合格"warning |
| 反例① `used=["不存在的标签"]` | 判杜撰：`申报的依据在素材里不存在: ['不存在的标签']` |
| 反例② `used=[]` + `text="你上次说帮同学修电脑，那次是哪出问题？"`（**用户抓到的那句**） | 判杜撰：`未申报任何依据，却在陈述用户事实（命中引导语「你上次」）` |
| 反例③ `used=[]` + `text="嗨，最近有没有什么新鲜事呀？"` | **放行**（纯日常，不涉及用户事实） |
| 反例④ `used=["看短句"]` + text 里没有"看短句" | 判杜撰：`申报了依据但话里没提到: ['看短句']` |
| 反例（额外边界，同一套规则） | 编短标签 `used=['剪映']`（素材是`剪辑`）-> 拦；`used=[]`+"你提过想学吉他" -> 拦；有依据的改写措辞（`used=['剪辑']` + "剪视频"）-> 放行；`used=['技术方向小实验']` + 改写标题 -> 放行 |
| 判杜撰后是否真的换模板 | 打桩跑 `_compose_opening`：杜撰/空输出三种输入最终都落成本地模板 `想起来你上次说想弄「帮同学修电脑」，还在弄吗？`；warning 里带**素材清单 + 模型原文 + 模板**三项 |
| **回归① 假 Key** | HTTP 200 + `code 0`，`content = "嗨，先随便聊聊吧，你最近在忙什么呀？"`（全新用户档模板），消息 1 条；日志 `chat_json 全部失败 schema=OpeningResult` + `开场白判定不合格（AI 不可用或无有效输出）` |
| **回归② 同一会话连调两次 `/opening`** | 同一 `message_id`、内容一致、消息条数 1、`client_msg_id=['sys:opening']`（日志「开场白幂等命中」） |
| **回归③ 全新用户（真 Key）** | `嗨，刚打开就碰上你了，最近这阵子都在忙啥呢？`（22 字）；职业向禁用词（专业/方向/规划/职业/兴趣/求职/实习/简历）命中 **0** |
| **回归④ 模型返回非 JSON** | 用假 LLM（本机 stub）分四档打：① 只回一句人话 ② `used` 类型不对（字符串）③ JSON 被截断 ④ JSON 语法错（单引号+尾随逗号）—— **四档全部 HTTP 200 + `code 0`**，都落到模板；日志分别是 `chat_json 第 1/2 次解析失败` / `第 2/2 次` / `chat_json 全部失败`，**没有一次 500** |
| 回归（正文侧，`chat_system` 规则 13/14） | 真实跑一轮 SSE：把规则 13/14 原文送进 system prompt（日志抓取确认），流式回复正常 `done`；用户本轮说"电脑开不了机、我帮他重装了一下系统" -> 回复"哦重装系统，那挺行的啊…装完之后能正常开机了吗？"（**引用的是用户本轮真的说过的话**，没有凭空"你之前说过"） |
| 数据清理 | `scripts/cleanup_probe_data.py --apply`：第一次 **DELETE 26 行**（users 3 / profiles 3 / profile_tags 6 / tasks 1 / conversations 7 / messages 6，3 个探针账号）；补跑正文验收又建 1 个探针 -> **DELETE 7 行**（users 1 / profiles 1 / profile_tags 1 / tasks 1 / conversations 1 / messages 2）；再跑一次 **DELETE 0 行**（幂等）。落库后 `integrity_check=ok`、`foreign_key_check=0 行孤儿`、`users` 只剩 `admin` / `wyh` / `wyh1` / `wyh2`（各自行数与会话数在 `--apply` 输出里逐账号核对过，未被触碰） |
| 临时脚本 | 全部写在 `%TEMP%`（13 个 `dsh_*.py`）与 2 个临时库（`data/probe_*.db`），跑完**已删净**；仓库里**没有**新增测试文件 |

**最近一轮（新会话不重问同一件事：跨会话信息 = 禁止清单 + 服务端硬剔除）：4 条开场白全部不同题**

探针账号 `opening_repeat_*`：4 条标签 + **7 个进行中任务（标题大量重复**，模仿 `admin`
那批历次测试生成的任务）。连续建 4 个新会话各拉一次开场白，中间在第 1 个会话里
让用户答"在" → 再答"不想搞了"。

| 验收项 | 实测结果 |
|---|---|
| 会话 1 开场白 | "嗨，想起来你之前说想用 C 写个通讯录，最近还摸这个吗？"（28 字） |
| 会话 1 用户回答 | `在` → AI 追问到哪一步；`不想搞了` → "行，那先放着吧，不想弄就不弄。那这周你手上还有别的在忙的事吗？" |
| **会话 2**（用户已答过之后） | "嗨，之前听你说想用Java做点小工具放进简历，最近有动手写点啥不？"（33 字）——**没有**再问通讯录那件事 |
| 会话 3 | "嗨，最近有没有什么新鲜事，随手聊聊呗"（18 字，新素材用尽 → 走日常） |
| 会话 4 | "嗨，最近是不是被啥事拖住了，一直没动起来呀？"（22 字，换到痛点维度） |
| **两两重复判定** | 4 条两两比较：共用背景素材的对数 **0**，文本相似度最高 0.36（要求 0） |
| 会话 2 与 会话 1 的素材交集 | **空**；会话 2 也没有出现"还在弄/还在搞/推进到哪/什么状态" |
| 长度 / 选项 | 28 / 33 / 18 / 22 字，**全部 ≤60**；`A/B/C`、编号选项、"更接近哪种""选一个"命中 **0**；每条只问一件事 |
| **幂等（老契约）** | 会话 2 连调两次 → 同一个 `message_id`、消息条数 1（服务端日志两次「开场白幂等命中」） |
| 回归：全新用户 | "嗨，最近在忙什么呢？"（10 字，纯日常，禁用词 0） |
| 回归：有背景仍然真的引用 | 会话 1/2/4 分别引用了通讯录任务、Java 标签+简历工具任务、拖延标签 |
| 服务端剔除留痕 | 日志实测：会话 2 剔除 `['C语言']` + `['用 C 语言做一个能演示的通讯录小项目']`（依据最近 1 条）；会话 3/4 剔除 2 条标签 + 3 条任务（依据最近 2/3 条） |
| 输出自检是否触发 | 本轮 **0 次**（服务端日志无"改用本地模板兜底"）—— 4 条都是模型真实输出 |
| 数据清理 | `scripts/cleanup_probe_data.py --apply`：`DELETE 117 行`（messages 36 + conversations 20 + profile_tags 17 + profiles 8 + tasks 28 + users 8），8 个探针账号；落库后 `integrity_check=ok`、`foreign_key_check=0 行孤儿`、复扫 0 个探针账号；库里只剩 `admin` / `wyh` / `wyh1` |

**这一轮改错了两次，都是靠真跑发现的**（记下来免得下次再犯）：
① 只给"不要重复"的软规则时，模型会把上一轮开场白**改几个字再用一遍** —— 所以后来
把开场白原句从**开场白** Prompt 里拿掉了（对话 Prompt 仍保留）；
② 剔除启发式一开始漏掉『C语言』（模型只写"用C做个…"），导致连着三个会话都在聊 C ——
补了"短词英文词根"这条信号。

**再一轮（用户第二次报 bug：「新对话 4 继承了新对话 3」）：把"用户说过的话"从素材位挪到禁止位**

因由：上一轮把**用户最近说过的话**当"可以拿来发问的素材"注入开场白 Prompt，
于是模型顺着素材提问 —— 用户在会话里说过『健身，刷视频，看短句』，
新会话的开场白就变成"嗨，你平时健身都练点啥呀"。用户的原话是
**「新建对话就是用户自己想切换聊天内容了」**。

真实 API 复现 + 验收（临时实例跑在 8123 端口，**未动用户 8000 端口的服务**；
探针账号已清理）：

| 验收项 | 实测结果 |
|---|---|
| 会话 1（探针账号 `opening_probe_*`） | 用户说『我平时健身，刷视频，看短句』→『会写日记』；回流 4 条标签：`兴趣/健身 0.8`、`技能/写作 0.7`、`兴趣/刷视频 0.6`、`兴趣/阅读短句 0.6` |
| **会话 2 开场白** | "嗨，最近有没有什么新鲜事呀？"（14 字）—— 命中 健身/刷视频/短句/日记/视频 **0** |
| **会话 3 开场白** | "嗨，最近这周过得咋样呀？"（12 字）—— 命中 **0** |
| **会话 4 开场白** | "嗨，最近有没有什么新鲜事，说来听听呗。"（19 字）—— 命中 **0** |
| 服务端剔除留痕（关键证据） | 会话 2 生成时日志：`标签剔除=['健身', '写作', '刷视频', '阅读短句'] 任务剔除=[]（依据最近 **0** 条开场白 + 2 条用户原话）` —— **0 条开场白就把 4 条标签全剔光了，说明 `asked` 里确实并入了用户原话** |
| 回归①：全新用户 | 0 标签 0 任务 → "嗨，最近这周有什么新鲜事没？"（纯日常 ✅） |
| 回归②：有背景但**没有**任何其它会话 | 直接写 `兴趣/喜欢剪视频 0.9` + `痛点/缺项目经验 0.8` → "嗨，想起来你之前提过挺喜欢剪视频，最近还在剪吗？"（**真的引用了背景**，没退化成"最近在忙什么" ✅） |
| 回归③：同一会话连调两次 `/opening` | 同一个 `message_id`，内容一致（日志「开场白幂等命中」）✅ |
| 数据清理 | `scripts/cleanup_probe_data.py --apply`：`DELETE 32 行`（messages 12 + conversations 7 + profile_tags 7 + profiles 3 + users 3），3 个探针账号；复扫 0 个、`integrity_check=ok`、`foreign_key_check=0 行孤儿`；库里只剩 `admin` / `wyh` / `wyh1` |

**上一轮（开场白调性 v2：去掉选择题腔 + 只聊日常 + ≤60 字）：真实 API 6 条开场白 + 3 轮对话全过**

因由：用户否掉 v1 的**调性**（"这和让用户做选择题有什么区别"），要求**活人感 + 循序渐进**。
改的是 `chat_opening.txt`、`chat_system.txt` 规则 11/12/13、`fallbacks.py` 三档模板
与 `OPENING_MAX_CHARS`（见 §4.16.3）。探针跑在临时实例（8066，真实 Key），跑完自清。

| 验收项 | 实测结果 |
|---|---|
| 全新用户 × 2 | "嗨，刚刷到你，最近这阵子都在忙啥呀？"（18 字）/ "嗨，最近在忙些什么呢？"（11 字）——**都是日常，且两条不相同** |
| 有标签 × 2 | "嗨，想起来你之前提过喜欢剪片子，最近还有在剪吗？"（24 字）/ "嗨，想起来你之前说挺喜欢剪视频，最近还在剪吗？"（23 字）——都引用了真实抽出的标签「剪辑」 |
| 有任务 × 2 | "嗨，上次你说想先拿个现成模板搭个小网页练手，后来动手了没？"（29 字）/ "嗨，你上次说想用模板做个能演示的小网页，还在弄吗？"（25 字）——都引用了真实生成的 4 步任务 |
| **选项腔检测** | 6 条开场白 + 3 轮对话回复共 9 条，命中 `A/B/C`、"更接近哪种""选一个""以下哪种""直接回字母"、编号选项的次数 = **0** |
| 长度 | 6 条开场白全部 ≤60 字（最大 29 字）；全部 `HTTP 200` + `code 0` |
| 全新用户是否聊了专业 | 禁用词（方向/规划/职业/目标/兴趣/求职/实习/简历/专业/测评/岗位）命中 **0** |
| 有背景是否真的引用 | 4 条有背景的开场白**全部**引用了标签/任务（字符覆盖率 0.50–0.80；模型会改写措辞：「剪辑」→「剪视频」） |
| 3 轮连续对话 | 第 1 轮"期末确实挺磨人的，先熬过去再说～那你最近忙的这些事里，除了考试，有没有什么是做起来还比较带劲的？" → 第 2 轮"…那这些作业里，有没有哪个是你负责的部分做得还挺顺手的？" → 第 3 轮"哦？做前端页面啊，那你这部分算是自己从零搭出来的吗，还是套的模板改的？"——**每一步都只问一件事、都接着上一句往下走、全程没有选项** |
| 数据清理 | 4 个探针用户及其会话/消息/任务/画像全部删除；库里回到 `admin` / `wyh` / `wyh1`（当时另有 `probe4_*`、`probe7_*` 两个账号，当时判为"非本次产生"，实际是本轮测试留下的，已由用户复核后删除） |

**这一轮踩到的坑（值得记）**：`parser.load_prompt` 是 `lru_cache` 的，
改了 Prompt 不重启就会一直跑旧文本 —— 第一轮"改了没效果"就是这个原因
（`--reload` 只监听 Python 文件，`.txt` 变了不会重启，缓存自然也不会刷新）。

**已从根上堵掉**：`dev-backend.ps1` 与上面 2.1 的启动命令都加了
`--reload-include '*.txt'`，改 prompt 会正常触发重启；用别的方式手起 uvicorn
（例如 `python -m uvicorn` 不带这个参数）时，改完 prompt 仍要手动重启一次。
这个坑前后咬了两次（开场白调性一轮、任务生成一轮），所以值得写在这里。

**最新一轮（2026-11 二次修正：把"禁止是非题"改精确 + 补验流式路径）**

> 这一轮只做两件收尾：① 上一轮把"是非题"写得太宽（用户拍板："**规则应该精确到
> 『禁止是非题式的进度核对』，而不是『禁止所有带"吗"的问句"**"）；② 上一轮的 6 轮脚本化
> 对话走的是**非流式** `POST /messages`，而前端用的是**流式** `POST /stream` —— 必须真跑一次。

改动位置：`chat_system.txt` 规则 8①（+ 规则 22 的引用）、`chat_opening.txt` 第二步硬性禁止
（**只有这两个 prompt 文件含"是非题"措辞**；grep `是非题` 已无"不带限定的全面禁止"式旧口径）。
临时实例 **8765**（真 Key），**用户 8000 端口全程没动**。

| 验收项 | 实测结果 |
|---|---|
| **判定口径写进 Prompt** | 只有一条：**"这个问题的答案，能不能自然地展开成一段话？"** 能展开（他答完还愿意多说两句）-> **放行**，哪怕带"吗"；只能回"是/否/嗯/还行"、答完没下文 -> **禁止**。禁止清单（还在弄吗 / 还在搞吗 / 推进到哪了 / 做得怎么样了 / 有进展吗 / 动了吗 / 做完了吗 / 试了吗 / 是不是卡住了 / 找到方向了吗）与允许清单（「大三学 Java，是打算往开发方向走吗？」「你们学校食堂好吃吗？」）都写在规则原文里 |
| **口径可执行（模型判定 10/10）** | 直接把改后的规则 8 原文当判据，让模型逐条判定：`大三学 Java，是打算往开发方向走吗？`->allow；`你们学校食堂好吃吗？`->allow；`你那个小工具还在弄吗？`/`之前说的那个任务做完了吗？`/`你的开发方向找到了吗？`/`那个项目是不是卡住了？`->block(8① 进度核对)；`你更想往开发方向还是产品方向？`/`这个任务是打算继续，还是先放一放？`->block(8② 二选一)。**10/10 与预期一致** |
| **流式 6 轮（真实 SSE，`POST /chat/conversations/{id}/stream`）** | 探针 `sse_probe_8e5e7f`（9 标签 / 2 个「进行中」任务 / 8 个步骤，`profile_service.apply_tags` + `task_service.generate_task` 真造，`evidence_for_tags` 9/9 通过）。第 1 轮（`/opening`）「最近都在忙些什么呀？」→ 第 2 轮「**大三学 Java，是打算往开发方向走吗？**」→ 第 3 轮「课上学过、手上还没完整做过——那你自己有没有想动手做点啥小东西的念头？」→ 第 4 轮「那先不急着定。你平时刷视频、看短句的时候，有没有刷到过那种让你觉得"这玩意儿我也想搞一个"的东西？」→ 第 5 轮「那换个问的，你健身一般练啥？」→ 第 6 轮「哈哈行，那先不聊这个。你会 Java 也会 C，这俩是学校课上学的，还是自己私下折腾过？」。每轮事件序列都是 `start -> delta* -> tag -> done -> end`（delta 12/22/32/11/28），**无 error 事件** |
| **逐轮判定** | 第 1 轮纯日常（标签 / 任务 / 原话 / 阶段 / 回述引导语 命中 **0**）；第 2 轮就是用户亲口给的正例形态（**方向猜测句，属允许**）；全程**档案播报 0 次**、**进度核对式是非题 0 次**、**选项 / 二选一 0 次** |
| **`audit_reply_for_leak` 在流式路径真的跑了** | 进程内把 `deepseek_client.stream_chat` 换成 stub，喂违规文本「你的标签里有'缺项目'，要不要聊聊这个？」-> 日志打出 **1 条 `WARNING 正文疑似档案播报…`**；再喂正例「大三学 Java，是打算往开发方向走吗？」-> **+0 条**（0 误报）。也就是说流式路径上这条自检**是活的**，不是"只写在代码里" |
| **流式路径共用 `_build_llm_messages`** | 同一次 stub 抓到的 `llm_messages` = `[system, user]`（system 长 7889，含 `【当前用户背景】` 与新的规则 8① 原文）。调用点：`prepare_stream` 里 `llm_messages = [] if shortcut else _build_llm_messages(db, conversation, user)`（`chat_service.py:1595`），`stream_reply` 直接消费它发模型 |
| **开场白在流式场景由谁产生** | **独立端点** `POST /chat/conversations/{id}/opening`：前端 `ChatPage.tsx` 进入空会话时自动调一次（`chatStore.ensureOpening`），`/stream` 与 `/messages` **都不生成**开场白。本轮第 1 句就是它产的（日志 `开场白模型输出：text='最近都在忙些什么呀？' used=[] 本轮素材清单=[]`） |
| **回归①（开场白仍只聊日常）+ ②（幂等）** | 探针上 3 次 `/opening`：「同学，你今年大几啦？」「周末一般都怎么过呀？」「平时有没有哪件事，你觉得自己做起来比身边人顺手一点？」（10/10/26 字）——标签 / 任务 / 原话 / 阶段 / 职业向词 / 选项命中**全 0**；同一会话第二次 `/opening` 返回**同一 `message_id`**、内容一致、消息数 **1** |
| **回归③（反杜撰仍拦得住）** | 直接调 `_validate_opening`：`used=['不存在的标签']` -> 拦；`used=[]` +「你上次说帮同学修电脑，那次是哪出问题？」-> **拦**（命中引导语「你上次」）；`used=[]` +「嗨，最近有没有什么新鲜事呀？」-> 放行；`used=['看短句']` 而话里没提 -> 拦；另「你提过想学吉他…」「我们上次聊的那个还在弄吗？」-> 拦 |
| **回归④（用户点名的两句必须放行）** | 模型判定 A/B 两条 **allow**；本地侧 `_validate_opening("你们学校食堂好吃吗？", [], [])` 与 `_validate_opening("大三学 Java，是打算往开发方向走吗？", [], [])` **都放行**；真实流式第 2 轮还逐字产出了后者 |
| **回归⑤（进度核对 / 二选一仍拦）** | 见"口径可执行 10/10"：进度核对 **4/4 block**、二选一 **2/2 block** |
| **`_PROFILE_NARRATION_HINTS`（正文侧）只留痕、判据没动** | 23 条不变：「根据你的画像…」命中「你的画像」，「你的标签里有…」命中「你的标签」，两句正例命中 `None`。⚠️ **勘误**：上一轮表里把「根据你的画像…-> 拦」记在"反杜撰四组"下容易误读 —— 判它的是**正文侧** `audit_reply_for_leak`，**开场白侧** `_validate_opening` 的词表里**没有**这条（本轮实测确认） |
| **数据清理** | `cleanup_probe_data.py --apply`：**DELETE 72 行**（users 3 / profiles 3 / profile_tags 11 / conversations 11 / messages 34 / tasks 2 / task_steps 8），第二遍 **DELETE 0 行**；落库后 `integrity_check=ok`、`foreign_key_check=0 行孤儿`；四个账号逐字段与开工前**完全一致**：admin（profiles 1 / 标签 25 / 会话 1 / 消息 23 / 任务 5 / 步骤 23 / 每日答 2 / 测评 4 / 报告 1 / 奖章 1）、wyh（1/7/3/12/2/8/1/1/1/3）、wyh1（1/1/0/0/0/0/0/1/0/0）、wyh2（1/3/4/4/1/4/1/1/0/0） |
| 临时脚本 | 全部在 `%TEMP%`（`dsh_*.py`），跑完已删；仓库里没有新增测试文件（`backend/tests/` 仍只有 `README.md`） |

> 数据状态备注：本轮**开工时** `admin` 名下**只有 1 个会话**『新的职业对话』（23 条消息），
> 没有『新对话 2』；这是开工前的库状态，本轮没有删除过任何会话（`--delete-conversation` 未使用）。

**上一轮（2026-11：开场只聊日常 + 脚本化 6 轮"第 2 轮起自然过渡到画像"，走的是非流式 `POST /messages`）**

改动见 §4.16.12。临时实例 8123（真 Key）/ 8124（假 Key）/ 8126（本机坏 JSON stub，8125 是 stub），
**用户 8000 端口全程没动**；探针账号与 admin 名下自造会话已清理（见本表最后一行）。

| 验收项 | 实测结果 |
|---|---|
| **开场白 5 次（`admin`，档案最丰富：25 标签 / 5 任务）** | 「这周的课多不多呀？」「嘿，你今年大几啦？」「你们学校食堂味道咋样呀？」「你觉得自己哪方面比别人强一点呀？」「最近在忙些什么呀，感觉你好像挺忙的？」（9/9/12/16/18 字） |
| **模型原始 `used`（服务端日志逐条抓）** | 5 次全部 `used=[] 本轮素材清单=[]`；无任何"判定不合格/改用模板"warning → 全部是模型真实输出 |
| **是否碰画像** | 5 条里 0 次出现标签 / 任务 / 原话 / "你之前/你上次/你说过/你提过"；`_opening_context()` 实测 `materials=[]`、`forbidden_items=[]`、`as_prompt_variables()={'topic_seed': …}`（唯一变量，与用户无关） |
| **开场白 ≤60 字 / 无选项腔** | 9/9/12/16/18 字全部 ≤60；`A-D`/`1.`/还是/选一个/更接近哪种 命中 0 |
| **同一会话两次 `/opening`** | 同一 `message_id`、内容一致、该会话消息数 1（日志「开场白幂等命中」） |
| **假 Key（8124）** | HTTP 200 + `code 0`，2/2 落新的日常模板（`嗨，今天过得咋样？`） |
| **坏 JSON 四档（8126 + stub）** | stub 依次回：①只回一句人话 ②`used` 是字符串 ③JSON 截断 ④单引号+尾随逗号；**4 档全部 HTTP 200 + `code 0`**、全部落新模板，无一次 500（日志 `chat_json 第 1/2、2/2、全部失败`） |
| **反杜撰四组反例（新语义：`materials=[]`）** | ①`used=['不存在的标签']` -> 拦；②`used=[]`+「你上次说帮同学修电脑，那次是哪出问题？」-> 拦；③`used=[]`+「嗨，最近有没有什么新鲜事呀？」-> **放行**；④`used=['看短句']` 而话里没提 -> 拦。另加边界：`used=[]`+「你提过想学吉他」/「我们上次聊的那个还在弄吗？」/「根据你的画像…」-> 全拦；用户点名的三句日常 -> 全放行（共 14 条断言 0 失败） |
| **引导语表** | 26 -> **48 条**；用户点名的三句 + 8 条日常例句命中数 **0** |
| **脚本化 6 轮（探针 `zz_probe_trans_1`：8 标签 + 2 进行中任务，`apply_tags` 真造）** | 第1轮「这两天过得咋样呀，忙不忙？」→ 第2轮用户「我大三了，在学 Java」→ AI「**大三学 Java，是打算往开发方向走吗？**」（与用户给的 ✅ 正例逐字同形）；第3轮「课上学过、手上还没完整跑过一个 —— 那你自己有没有想做点啥小东西？」；第4轮「你平时用手机或者电脑，有没有哪个功能你觉得'要是我自己写一个就好了'？」；第5轮「那先不聊这个。你平时除了上课，最近在忙点啥？」；第6轮「哈哈有，那换个问法——你们这学期有哪门课是你上着还算带劲的？」 |
| **逐轮判定** | 第1轮纯日常 ✅；第2-6轮**每一句都锚在用户刚说的那句话上** ✅；**档案播报 0 次**（`_PROFILE_NARRATION_HINTS` 命中 0，服务端日志无该 warning）；进度核对式是非题 / 二选一：0 次（当时 Prompt 里还写成"禁止是非题"，口径过宽，已由下一轮改精确，见本节最新一轮） |
| **正文档案播报自检（新增）** | `audit_reply_for_leak` 对「你的标签里有'缺项目'，要不要聊聊这个？」「看你的画像…」「从系统记录里看到…」三条各打一条 `WARNING 正文疑似档案播报…`；对「大三学 Java，是打算往开发方向走吗？」「课上学过、手上还没完整跑过一个 —— 那你自己有没有想做点啥小东西？」**不报警**（0 误报） |
| **E 项：抽标签 evidence 通过率** | 老口径复算（admin/wyh/wyh1/wyh2）**25 条带 evidence -> 通过 7 条（7/25）**；新 Prompt 抽取的探针 `zz_probe_evid_1` **8/8**、`zz_probe_evid_2` **10/10**（合计 **18/18 = 100%**，证据全部能在用户消息里逐字找到） |
| **对照组（过滤器仍然拦得住）** | 手工在探针 `zz_probe_trans_1` 上铺的 8 条"用户没说过的" evidence（如 `会java和C语言`、`我好焦虑`）-> **只有 3 条通过**，5 条被 `evidence_for_tags` 挡下 |
| **数据清理** | 自造会话 + 3 个探针账号：`DELETE 80 行`（messages 38 / conversations 8 / tasks 2 / profile_tags 26 / profiles 3 / users 3）；再跑一次 **DELETE 0 行**（幂等）；`integrity_check=ok`、`foreign_key_check=0 行孤儿`；四个账号逐行数与开工前**完全一致**（admin 2/24/5/25/1、wyh 3/12/2/7/1、wyh1 0/0/0/1/1、wyh2 4/4/1/3/1），`admin` 原有 2 个会话（`新的职业对话` / `新对话 2`，含用户截图那条）**一字未动** |
| 临时脚本 | 全部在 `%TEMP%`（`dsh_*.py`），跑完已删；仓库里没有新增测试文件 |

> ⚠️ **实测到的两个"模型不听话"，都已用 prompt + 代码兜住**：
> ① 第一版改成纯日常后，模型把示范例句当模板（5 次里 3 次吐「嗨，今天过得咋样？」），
> 后来加了"**话题种子**"（`OPENING_TOPIC_SEEDS`，与用户无关的随机话题）才分散开；
> ② 用户台词「不知道做啥」会被 7.6 的 `looks_like_stuck` 命中走本地 stuck 模板
> （不经过模型），所以脚本化那一轮用了等义改写「还没想好做啥」。
> 另：「最近在忙些什么呀，感觉你好像挺忙的？」这类句子带了**轻微预设**（"你好像挺忙"），
> 不属于"事实陈述"但不理想，属于本轮**已知的小瑕疵**。

**上一轮（AI 先开口 v1）：28 项断言全部 PASS**

> ⚠️ 下面这一轮验证的是 **v1 的开场白**（≤120 字、带 A/B/C 选项）。
> v1 的**调性已被用户否掉**，文案不再是当前行为；但**接口契约与幂等/并发结论仍然有效**
> （那部分这轮没改）。

| 验收项 | 实测结果 |
|---|---|
| 新建会话调 opening | `HTTP 200` + `code 0`；`role=assistant`、`client_msg_id=sys:opening` |
| 是否落库 | `GET /{id}/messages` → 正好 1 条且 `id` 与返回值一致 |
| **`message_count` 是否算开场白** | `GET /chat/conversations` → 该会话 `message_count = 1`（**不是 0**） |
| 重复调用 | 第二次返回**同一个 `message_id`**，消息数仍为 1 |
| **并发**同时调两次 | 两个请求都 `code 0` 且 `id` 相同；库里该会话只有 1 条（唯一约束 + 回滚回放生效） |
| 老用户带背景 | 真实聊天抽出 6 条标签后，开场白引用了标签（v1 文案） |
| **AI 不可用** | 三档兜底全部 `HTTP 200` + `code 0`；分别引用任务标题 / 真实标签 / 低门槛问句；**都不是**"卡了一下"那句断线兜底 |
| 越权 / 不存在 | 访问别人的会话 → `HTTP 404` + `code 2001`；随机 UUID → 同样 404/2001 |
| 用户先说话后再调 opening | `code 0` + `message="会话已有消息，未生成开场白"` + `data=null`；消息角色仍是 `['user','assistant']`（没被插入第三句） |
| 开场白会话可否继续对话 | 继续 `POST /messages` → `code 0` 且返回了回复（开场白已在 LLM 上下文里） |
| **库层复核** | `select * from messages where client_msg_id='sys:opening'` → **12 行，角色全是 `assistant`**，**没有一个会话出现 2 条** |
| 开场白是否伪造画像 | 一个只被调过开场白、从未发消息的用户：`profile_tags = 0 条`、`tasks = 0 条`（"声称 ≠ 证据"） |

**那一轮运行的意义**：`chat_prompt_text()` **第一次被真实调用**（此前只有 `chat_text` /
`chat_prompt_json` 被真跑过）；Prompt `chat_opening` 与**假 Key 兜底路径**都在真实进程里验证过；
同时这是本项目**第一次做并发验证**（两个并发请求打同一个新会话）。

**最近一轮（成长报告改为实时 + 保存快照）：18 项断言全部 PASS**

| 验收项 | 实测结果 |
|---|---|
| 全新用户 `GET /report`（验收 3） | `HTTP 200`，`saved=false`、`last_saved_at=null`、`user_note=""`、delta 全 0，**不报错** |
| `GET` 是否实时（验收 1） | 打卡前 `action_score=0.0` → 打卡后**同一接口立刻**返回 `8.0`（`total 0.0 → 2.8`），期间**没有保存过任何报告**（`saved` 仍 false） |
| `GET` 是否落库 | 连续 8 次 GET，`reports` 表**新增 0 行**；4 次 `POST /report/save` 对应**恰好 4 行**（库里实测） |
| `POST /report/save`（验收 5） | `saved=true`、`last_saved_at=2026-09-22T03:26:25.299487`、`user_note` 回显正确；再 GET 能读回 |
| 保存后 delta | 全 0（基线 = 刚保存的这份） |
| delta 正确性（验收 2） | 基线 `{clarity 0, action 8.0, resume 0, total 2.8}` → 提交测评（clarity 0→100）→ GET：`delta = {clarity 100.0, action 0.0, resume 0.0, total 40.0}`，**与手算一致** |
| 第二次保存 | `last_saved_at` 更新、`user_note` 变成新内容、delta 再次归零 |
| `suggestions`（验收 4） | 3 条建议每条都带非空 `pain_point`（`行动力不足` / `简历没有可写的经历` / `职业方向不明确`） |
| pain_point 喂给任务生成 | `POST /task/generate {"pain_point":"行动力不足"}` → 成功生成《3 天做完一件小事》，4 个步骤、`pain_point` 回显一致（**AI 真实参与**） |
| `user_note` 超长 | 501 字 → `HTTP 400` + `code 1001` + `data.errors[0].loc="body.user_note"`；正好 500 字通过 |
| 不传 `user_note` | 也能保存，`user_note` 为空串 |

**本轮运行抓出的新 bug（静态检查发现不了）**：

| # | 现象 | 根因 | 修复 |
|---|---|---|---|
| 9 | `GET /report` 直接 **HTTP 500**：`TypeError: GrowthReportResponse() got multiple values for keyword argument 'score_delta'` | 我写成 `GrowthReportResponse(**content, score_delta=ReportScoreDelta(...))`，而 `content` 里**已经有** `score_delta` / `suggestions` 两个键 | 先 `payload = dict(content)`、**就地替换**这两个键再展开；`_compose_response` 的 docstring 写明了这个坑 |

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
- 目录穿越（**历史记录：被测代码已随老简历链路于 2026-11 删除，见 §4.10**）：
  `../../etc/passwd`、`resumes/../../../../windows/win.ini`、`C:/Windows/win.ini`、
  空串**全部被拒为 2001**；合法路径正常；下载文件名清洗掉换行与路径分隔符。

#### 5.1.2 仍未验证

- ~~**SSE 流式调用**：`app/ai/deepseek_client.py::stream_chat()` 尚未真实调用验证~~
  **已补验（2026-11 二次修正）**：真 Key 下 `POST /chat/conversations/{id}/stream` 跑了完整
  6 轮（`start -> delta* -> tag -> done -> end`，无 error），`stream_chat()` 逐块产出被
  `stream_reply` 累积后落库；详见 §5.1.1 最新一轮。**仍然没有前端进程消费过真实事件流**
  （本轮用 httpx 直接读 SSE 文本），前端 `ReadableStream` 解析仍是纸面契约。
  其余 Prompt（`interview_*`）同样未真实调用过；`resume_polish` 这一轮已用真 Key 跑通
  （见 §5.1 最新一轮）；老的 `resume_parse` / `resume_optimize` 已随 ATS 链路移除，不在此列；
  `task_generate` 在配 Key 之前的那轮走的是 7.6 兜底任务；
- **PostgreSQL 路径**：本机没有 PG，`psycopg2` 方言、JSONB DDL、`alembic upgrade` 均未跑过；
- **Alembic**：`migrations/versions/` 为空，`alembic upgrade head` 是空操作，未生成过迁移；
- **Docker / Nginx**：`docker-compose` / `nginx -t` 未跑（本机没有 Docker）；
- **SSE 生成器内的 Session 生命周期**：真实流式 6 轮里每轮都在生成器内 `SessionLocal()`
  自开会话、落库 assistant 消息与画像标签（日志 `开场白已写入` / `画像回流成功` 逐轮可见），
  没出现 `DetachedInstanceError`；但**没有在前端消费流的同时**观察会话关闭时机，
  也没做"客户端中途断开"的用例；
- **未写测试**：没有任何 pytest 用例（骨架阶段要求不写），验证用的都是一次性脚本（已删除）；
- **定时任务**：APScheduler 注册成功（4 个 job），但没有等到实际触发时间；
- **未验证的边界**：并发打卡/并发提交/并发删除（SQLite 库级写锁下的表现）、
  多处同时 `apply_tags` 的权重融合竞争；
- **反杜撰的已知盲区**（见 §4.16.8，这三条这轮**没有**解决）：
  1. **对话正文（SSE）没有机械保证** —— 只有 `chat_system` 规则 13/14 的 Prompt 约束。
     这一轮只跑了一轮真实 SSE 对话看它没退化成伪造回述，**没有**做"正文说了素材外的
     事实"的批量对抗测试。（补：`audit_reply_for_leak` 这个**只留痕**的自检在流式路径上
     确实会被调用 —— 已用 stub 喂违规文本验证过会打 warning、喂正例不误报，见 §5.1.1 最新一轮；
     但它仍然**不改写、不打断**，所以"没有机械保证"这句话依然成立。）
  2. `used` 是**模型自己申报**的：理论上它可以在引用素材 A 的同时申报素材 B
     （只要 B 也在素材清单里、且话里确实提到了 B，服务端就会放行）；
     "话里有没有**别处**杜撰"（例如引用了"看短句"却又补一句"你每天都看"）**检测不到** ——
     这一轮的机械保证只覆盖"申报与素材、申报与话"的一致性，不覆盖"话里每个细节"，
     后者仍靠 Prompt 规则；
  3. 开场白的用户事实启发式（`_USER_FACT_HINTS`）是**词表**，不是语义判断：
     `"你平时……"` 这类问法刻意不入表（假阳性取舍见代码注释），
     所以理论上存在"既没命中引导语、又陈述了用户事实"的漏网句式（未被实测抓到）；
- **`extra.evidence` 刻意没接进 Prompt**：标签里存的用户原话片段这一轮仍只作内部追溯，
  没有进开场白素材（用户尚未拍板，见 §4.16.7 最后一条）。

### 5.2 数据落库现状（哪些在库里，哪些在代码里）

> 早期骨架出现过"接口看起来有数据、数据库里却是空的"（题库在 Python 常量里，
> 占位题甚至用全零 UUID），已经改掉。现在的规则是：**用户可见的数据一律落库，
> 只做内部参考的数据可以是代码常量，而且必须在本节写清楚**。

| 数据 | 位置 | 手册依据 | 说明 |
|---|---|---|---|
| 基础测试题（30 题） | ✅ **DB** `test_questions` | 5.4「30-50 题」 | 种子在 `app/db/seed_data.py::TEST_QUESTIONS`；`GET /test/questions` **从 DB 读**，空库返回 `[]` 并提示 `init_db` |
| 每日一问题库（30 题） | ✅ **DB** `daily_questions` | 5.4「30 题，四维度轮换」 | 种子 `DAILY_QUESTIONS`；`GET /daily/today` **从 DB 读**，题库为空/答完时返回 `question: null` |
| 奖章（3 枚） | ✅ **DB** `badges` | 5.4「起步行动家」+ 11.12 | 定义源是 `badge_service.BADGE_RULES`（起步行动家 / 坚持打卡者 / 方向初现），`seed_data.BADGES` 由它派生、按 name **幂等 upsert** 落库（含 `condition.key` 前端美术标识）；`GET /badge` 返回全部奖章 + 进度 + 是否获得（`BadgeOverviewResponse`），定义读代码、获得记录读 DB |
| 单用户作答/任务/画像 | ✅ **DB** | 5.3 | 运行时数据 |
| 成长任务模板（4 个） | ⚠️ **代码常量** `task_service.TASK_TEMPLATES` | 附录E「6 个」 | **未落库的理由**：它只作为 `task_generate` Prompt 的参考样例喂给模型，不是用户可见数据，手册 5.2 也没有模板表。**影响**：数量少于附录E 的 6 个；管理员无法在线编辑模板；换模板要改代码重启 |
| 岗位关键词库（3 个岗位） | ⚠️ **代码常量** `ai/schemas.py::JOB_KEYWORDS` | 附录F | **未落库的理由**：原本是 ATS 评分用到的词表，不是用户可见数据，5.2 无对应表。**影响**：加岗位要改代码；⚠️ 用它的老 ATS 链路已于 2026-11 移除（见 §4.10），该常量现在只被 `db/init_db.py::seed_job_keywords` 的日志引用，保留备查 |

**待办**：如果要让上面两项也能在线维护，需要按手册 5.3 变更流程新增
`task_templates` / `job_keywords` 两张表，并把 `TASK_TEMPLATES` / `JOB_KEYWORDS`
搬成种子数据（`init_db.py` 里已经预留了 `seed_task_templates` / `seed_job_keywords`
两个函数，现在只打"跳过"日志）。

### 5.3 仍未实现 / 有明确 TODO 的部分

| 位置 | 现状 |
|---|---|
| `profile_service.submit_test()` 的文字补充 | ~~未接线~~ **已接线**：`submit_test()` 改为 `async def`，在落库并 `commit()` **之后**把 `free_text` 交给 `extract_tags_from_text(..., source="test")`（route `app/api/v1/test.py` 本来就是 `async def`，这次只是补上 `await`）。抽标签在**事务之外**：AI 不可用时只记日志、提交照样成功（实测 401 假 Key 场景 `code=0`）；`free_text` 为空/全空白直接短路不调 AI；`recompute_stage()` 沿用 `clarity_score`，分数口径未动 |
| ~~`chat_service` 的追问计数（7.7 ≤3 轮）~~ | **已整体移除**（用户要求"要保证代码都是有用的"）：`conversations.followup_direction` / `followup_round` 两列、`dominant_dimension()` / `update_followup_state()`、Prompt 换维度硬约束、SSE 的 `followup_round` / `followup_direction` 字段全部删掉；真实库的两列也已用 `scripts/drop_followup_columns.py` 物理删除。**11.9 面试的追问（`MAX_FOLLOWUP_PER_QUESTION`）不在此列，保留不变。** |
| `client_msg_id` 幂等 | **已实现**：独立列 `messages.client_msg_id` + 复合唯一约束（第 6 节 ⑤），已实测（重复插入被拒） |
| ~~`resume_service.keyword_coverage()`~~ | **该功能已移除**（规则版关键词覆盖是老的 ATS 降级实现，2026-11 随 ATS 链路删除，见 §4.10） |
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

⑥ **[已决策：先补列、后按用户要求删列] `Conversation.followup_direction` / `followup_round`（7.7 追问计数器）—— 已移除**：
7.7 原来要求「同一方向连续追问 ≤3 轮」，实现方式是在 `conversations` 上补两列
（`followup_direction` 当前挖掘维度 + `followup_round` 同方向已追问轮数），
配 `dominant_dimension()`（权重和 → 条数 → 固定优先级 `DIMENSION_PRIORITY`）与
`update_followup_state()`（同方向 +1 / 换方向重置为 1 / 拿不到标签保持不变），
并在满 3 轮时由 `_build_llm_messages()` 往 system Prompt 注入「本轮必须换到另一个维度」的硬约束。

**这一整套已按用户要求删除**（原话："可以把之前确认的三次换个目标继续挖的代码删掉了，
要保证代码都是有用的"）。删掉的东西：

| 位置 | 删掉的内容 |
|---|---|
| `app/models/conversation.py` | `followup_direction` / `followup_round` 两列 |
| `app/schemas/chat.py` | `ConversationResponse` 与 `SSEEvent` 上的同名字段 |
| `app/services/chat_service.py` | `FOLLOWUP_ROUND_LIMIT`、`FollowupState`、`DIMENSION_PRIORITY`、`dominant_dimension()`、`read_followup_state()`、`update_followup_state()`、Prompt 注入、`StreamPreparation.followup`、三个 SSE 事件里的两个字段 |
| `app/api/v1/chat.py` | 路由 docstring 里的事件示例与 `followup_round` 语义说明 |
| `app/utils/text.py` | `MAX_FOLLOWUP_ROUNDS`（无其它调用点） |
| `app/ai/prompts/chat_system.txt` | 规则「连续追问同一方向不超过3轮。」（其余规则保留并重新编号） |
| 真实库 | `scripts/drop_followup_columns.py` 把两列**物理删除**（已执行，备份见 §6.1.2） |

⚠️ **不要把它加回来**，也不要和 11.9 面试的追问混为一谈：
`MAX_FOLLOWUP_PER_QUESTION = 2` / `InterviewAnswerResponse.followup_round` / `interview_followup.txt`
是"每题后追问 1-2 轮"，属于模拟面试的核心功能，**一行未动**。

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

⑩ ~~**[待确认] 追问轮数的口径**~~ **[已作废：该功能已整体移除]**：
原来 `followup_round` 按「画像标签的主导维度」推进（一轮对话算一轮），
口径问题（一轮对话 vs 一问一答）不再存在 —— 计数器本身已按用户要求删除（见 ⑥）。
若将来有人想重新引入"换维度"机制，请先把粒度口径定死再动手。

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
nginx 与 docker-compose 里对应的静态 location / 卷挂载也已删除。
**2026-11 更新：老的简历链路（含唯一的读文件端点 `GET /api/v1/resume/{id}/file`）
已整体移除（见 §4.10），现在没有任何对外读简历文件的端点；"不挂 StaticFiles" 的
决策继续保持。**

⑮ **[已决策：安全修复] 越权一律按"不存在"，并扩到全仓库**：

原来 `GET/PUT /resume/{id}`（已移除）、`/{id}/optimize`（已移除）、`/{id}/report`（已移除）、
`task` / `interview` / `chat` 的同类端点在「存在但不属于自己」时返回 **1003**，可用于反推 id 是否存在。
现已按「查私有资源时不存在与不属于你必须返回同一个 2001」统一改造
（编码规则见 §8.1，helper 是 `app.core.errors.not_found_unless_owner`）。

改造后的 `get_owned_*` 调用点清单（**全仓库已无归属类 1003**）：

| service 函数 | 覆盖端点 | 改动 |
|---|---|---|
| ~~`resume_service.get_resume()`~~ | ~~`GET /resume/{id}`、`PUT /resume/{id}`、`POST /{id}/optimize`、`GET /{id}/report`、`GET /{id}/file`~~ | **该函数已移除**（2026-11 随老简历链路删除，见 §4.10）；当年这里的改动是 `1003` → `2001` 并删掉临时的 `get_owned_resume_or_not_found()`。现行简历端点（`/resume/mine`、`/resume/polish`）按 `user_id` 取"唯一一份"，不做按 id 的归属查询 |
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
  `BADGES`（3 枚，按 name upsert，定义变了会更新 `condition`）；
- `GET /test/questions`、`POST /test/submit` 的计分、`GET /daily/today`、`GET /badge`
  现在**全部读数据库**（`GET /badge` 读 DB 里的 `badges` / `user_badges`；空库时
  奖章定义仍按代码里的 `BADGE_RULES` 返回、`obtained` 全为 false）；空库时
  `test/questions` 返回 `[]`、`daily/today` 返回
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

㉟ **[已决策] 新增 `DELETE /api/v1/chat/conversations/{id}`，且删除会话不影响画像**：

手册 10.2 的 Chat 端点清单里没有删除会话，但界面上必须有"清理对话"的能力。
实现要点：

- 需登录；**不存在或不属于当前用户 -> 404 + 2001**（沿用 §8.1 规则，不做 oracle）；
- **显式先删 `messages` 再删 `conversation`**，不依赖数据库级联
  （模型没有 `ondelete="CASCADE"`，且 SQLite 的 FK 行为取决于 `PRAGMA foreign_keys`）；
- ⚠️ **只删 `conversations` + `messages`，一行 `profiles` / `profile_tags` 都不碰** ——
  这是产品决策：画像按 `user_id` 独立存储，清理聊天记录不该连带丢掉画像
  （否则删一次记录就得重新测评）。详细理由见 **§4.14.3**；
- 响应 `{code:0,message:"success",data:null}`；重复删除第二次返回 2001（已不存在，符合预期）。

㊱ **[已决策] 会话标题只做序号命名，不做"首条消息自动命名"**：

默认标题从写死的"新的职业对话"改成 **`新对话 N`**（`N` = 该用户已有会话数 + 1，
并跳过被占用的编号，保证同一用户下不重名）。

曾实现过"首条消息到达时把标题改成消息前 14 个字"，**已按用户要求完整回退**：
`send_message` / `prepare_stream` / `stream_reply` 里不再有任何写 title 的代码。
**决策理由（用户明确要求）**：标题行为必须可预测 —— 自动命名会在用户没预期的时候
改标题（刚发一句话名字就变了）。详见 §4.14.1 / §4.14.2。

㊲ **[已决策：用户拍板] `GET /report` 改为实时计算，`POST /report/save` 保存里程碑**：

旧语义是"有历史就返回最近一份、完全不重算"，导致用户打了卡改了分数、报告页还是旧数据。
现在：

- `GET /report` **每次实时聚合、从不落库**（实测 8 次 GET → 0 行；`refresh` 参数废弃且被忽略，
  因为 GET 不该有写副作用）；
- `POST /report/save` 把当前数据 + `user_note` 存成 `reports` 一行，成为下次 delta 的基线；
- `score_delta` 对比"最近一次**保存**的报告"；**没有基线时全为 0**，
  前端必须用 `saved` / `last_saved_at` 判断（不能只看 delta 是不是 0）；
- `suggestions` 从 `List[str]` 改成 `[{text, pain_point}]`，
  `pain_point` 可直接喂 `POST /task/generate`（`TASK_TEMPLATES` 已补上这 4 个痛点模板）。

详见 §4.15。

㊳ **[已决策：产品红线] 用户可编辑「我的补充说明」，但不可编辑分数**：

`user_note` 存在 `content.user_note`（与 AI 生成的 highlights/suggestions 分开存），
通过 `POST /report/save` 提交。

**分数（`clarity/action/resume/total`）不可由用户编辑** —— 它们是对"行为证据"的度量，
由测评、打卡、简历、面试算出；让用户手改就失去意义（想涨分只能真去做事）。
代码保证：`ReportSaveRequest` 里没有分数字段，`save_growth_report()` 只写 `content.user_note`。

**相关的设计澄清**（用户曾反馈"聊一百轮阶段也不动"）：这是**设计如此**（"声称 ≠ 证据"）——
聊天只写 `profile_tags`，不碰分数。正确解法不是"聊天就涨分"（可吹牛刷分），
而是让 AI 引导用户去做任务证明，靠打卡涨 `action_score`（见 §4.15.6）。

㊴ **[已决策：用户提出] 新会话由 AI 先开口（`POST .../opening`），不让用户面对空白输入框**：

> ⚠️ **2026-11 修订（见 §4.16.12）**：本节末尾"内容由背景信息驱动"那一串已经**全部作废** ——
> 开场白只聊日常、不给画像素材；"有背景仍然必须真的引用背景"这条**已按用户要求推翻**。
> 幂等 / `sys:opening` / ≤60 字 / 绝不 500 / 不写画像标签这些契约仍然有效。

原流程是"用户先说话 → AI 才回复"，而本系统的主要用户恰恰是**还没想清楚方向**的学生，
面对空白输入框最容易卡住。现在：

- 新增 `POST /api/v1/chat/conversations/{id}/opening`，返回一条 `MessageResponse`；
- 开场白**落库成真正的 `assistant` 消息**（不是前端假气泡）——因此它进历史、
  进 LLM 上下文、也计入 `message_count`（实测开场白会话 `message_count = 1`）；
- 内容由背景驱动（阶段/画像标签/进行中的任务），Prompt 里硬约束
  "**一句人话 ≤60 字、只问一件事、绝不出现选项、全新用户只聊日常**"；
  ⚠️ v1 曾是"≤120 字 + 必要给 2-3 个选项"，被用户否掉（"这和让用户做选择题有什么区别"），
  v2 已按"活人感 + 循序渐进"重写（见 §4.16.3）；
- **幂等**：重复调用回放同一条；并发时靠 `messages` 上已有的
  `UniqueConstraint(conversation_id, client_msg_id)` + 保留值 `sys:opening` 挡住，
  第二个请求回滚后回放先落库的那条（实测两个并发请求同 `id`、库里 1 行）；
- 会话**已有消息**时不补开场白（会变成 AI 自问自答），返回 `data:null` + 说明；
- AI 不可用时用**开场专用**的兜底模板（不是"我这边刚刚卡了一下"那句中途断线话术），
  按"有任务 > 有标签 > 全新用户"三档给不同开场（假 Key 实测全部 200 + `code 0`）；
- ⚠️ 开场白**不写任何画像标签**：AI 单方面说的话没有用户证据（同 ㊳ 的"声称 ≠ 证据"）。
- **新会话不许重问同一件事 + 新会话 = 用户想换话题**（用户两次报 bug 后补）：
  注入跨会话信息（其它会话最近 ≤3 条开场白 + 用户最近 ≤6 句话），它**只作禁止清单**，
  绝不作"可以拿来问的素材"；并在**服务端硬剔除**已经聊过的任务/标签候选
  （`asked` = 最近开场白 **+ 用户最近说过的话**，不靠模型自觉）；
  开场白 Prompt **只给点名禁止清单、不给开场白原句**，并新增硬规则
  「新会话意味着用户想换一个话题：禁止清单里列过的一切不许再提、也不许当铺垫」；
  生成后再做一次输出自检，碰到已聊过的候选就换模板（不额外调 AI）。
  详见 §4.16.6，实测记录见 §5.1.1。
- **偏离手册 7.5**（同一次决策）：`chat_system.txt` 的
  规则 10 由"预判答不上来就给选项"改成**条件性**（只有用户明确答不上来、
  或连续两轮只回"嗯/不知道/还好"才给选项当台阶），规则 11 同步对齐，
  并**新增规则 12「循序渐进」**（一次只问一件事，先从具体的小事/日常聊起，
  不要一上来谈方向、规划、职业目标）。理由是用户的调性反馈：
  默认给选项会把对话变成选择题（见 §4.16.3）。
  （⚠️ 规则编号已因删除原规则 2「连续追问同一方向不超过3轮」而各前移一位，
  见第 6 节 ⑥；这里的编号是**当前**编号。）

详见 §4.16，实测记录见 §5.1.1。

㊵ **[已决策：用户提出] 严厉反杜撰：开场白改成"声明依据 + 服务端逐字核对"**：

> ⚠️ **2026-11 修订（见 §4.16.12）**：`used` 现在**必须是空数组**（开场白没有素材），
> 素材清单恒为空，校验改成"任何用户事实无条件判违规"；`used` 的作用从"申报依据"
> 变成"**自证没有偷偷加事实**"。下面记的是当时的形态。

用户原话「**没有的事情坚决不要杜撰，要严厉禁止这种事情**」。
触发事故：给用户举例时写出的开场白「你上次说帮同学修电脑，**那次是哪出问题**？」——
"帮同学修电脑"来自探针账号的**假测试文本**，"遇到过故障"更是**用户从没说过**的（模型把素材
加工成了新事件）。两个 Prompt 都加了硬规则（**原文**：`chat_opening.txt` 的第四/五步、
`chat_system.txt` 规则 13/14，含上面这个反例与"兴趣：看短句 -> 你每天都看短句吧？"）：

- 只能用素材里**真实出现过**的事实（标签、任务标题、用户确实说过的话）；
  时间、地点、人物、数量、频率、事件、原因、故障、结果，素材没写就一个字都不许补；
- **禁止把素材加工成新事件**；正确做法是**原样引用 + 开放式追问**，不确定就不提；
- 正文侧另加一条：不许把用户没说过的事说成"你之前说过 / 你上次提到"；
- **开场白**：`chat_prompt_text` -> `chat_prompt_json`（`OpeningResult{text, used}`），
  `used` 必须能在 `OpeningContext.materials`（本轮真实素材清单）里原样找到，
  且 `used` 非空时 `text` 必须真的提到它；`used` 为空却在陈述用户事实 -> 加严规则
  （26 条用户事实引导语，**宁可误判成可疑**）；
- 任何一项对不上 = 判杜撰 -> `logger.warning` 留痕（打出素材清单 + 模型原文）+
  换成本地模板 `opening_fallback`（模板只引用保留素材，天然不编）；
- 保留原有的清洗 / 命中 `forbidden_items` / `truncate(60)` / 绝不 500 契约；
  **不额外调 AI**（校验是纯本地计算）；
- ⚠️ **局限**：对话正文是 SSE 流式，**只有 Prompt 层约束、没有机械保证**（见 §4.16.8）。
- ⚠️ 刻意**没有**把 `profile_tags.extra.evidence` 接进 Prompt —— 那是另一件待用户拍板的事。

详见 §4.16.7 / §4.16.8，实测记录见 §5.1.1。

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

### 6.1.2 补过的列（授权偏离手册 5.3）

`migrations/versions/` 目前**是空的**（还没生成过迁移），补的列都在**模型层**，
`create_all` 已经把它们真实建进 SQLite（DDL 实测见 §4.13.2）。
**现在只剩 1 个补列**：

| 表 | 列 | 说明 |
|---|---|---|
| `messages` | `client_msg_id VARCHAR(64)` | 普通索引 + 与 `conversation_id` 组成复合唯一约束 |

> ~~`conversations.followup_direction` / `followup_round`~~
> **已按用户要求物理删除**（第 6 节 ⑥）。⚠️ 这里是 `create_all` 的经典坑：
> 它**只建不存在的表，绝不改已存在的表**。所以"改模型文件"只让**新库**不再有这两列，
> **真实库里那两列还在** —— 必须用一次性迁移脚本显式删除：
>
> ```powershell
> cd backend
> $env:PYTHONIOENCODING="utf-8"
> .\venv\Scripts\python.exe scripts\drop_followup_columns.py           # dry-run（默认，不写库）
> .\venv\Scripts\python.exe scripts\drop_followup_columns.py --apply   # 先备份、再 ALTER ... DROP COLUMN
> ```
>
> 脚本要点：默认 dry-run；`--apply` 时**先用 sqlite3 的 backup API 做在线一致快照**
> （不是文件复制：用户的服务正在写库，复制可能拷到半截页），备份落在
> `backend/data/backups/<库文件名>.<时间戳>.bak`；执行前 `PRAGMA table_info` 确认列存在；
> 改结构前 `PRAGMA foreign_keys=OFF`、改完 `PRAGMA foreign_key_check` + `PRAGMA integrity_check`
> + 行数复核。**已实测执行**（SQLite 3.49.1 ≥ 3.35 才支持 `DROP COLUMN`）：
> `conversations` 9 行 → 9 行、`messages` 54 行未变、`integrity_check = ok`、
> `foreign_key_check` 无违规、备份 `app.db.20260925-205159.bak`。

另外**新增了一张表** `test_questions`（题库，见第 6 节 ㉚），所以首次迁移还会带上它。

因此：

1. **首次 `alembic revision --autogenerate -m "init"` 会直接带上 `client_msg_id` 列与
   `uq_messages_conversation_client_msg` 唯一约束，无需手写任何 `ALTER TABLE`。**
2. 生成后请**人工核对**首次迁移：
   - `messages` 上是否出现 `client_msg_id` 列与 `uq_messages_conversation_client_msg`；
   - `conversations` 上**不应**出现 `followup_direction` / `followup_round`
     （模型里已无此列；若 autogenerate 产出了 `drop_column`，说明你的库里还残留旧列，
     先跑 `scripts/drop_followup_columns.py` 对齐，别把 drop 写进长期迁移）；
   - **JSON 列的方言差异**：PG 迁移里是 `postgresql.JSONB`、SQLite 迁移里是 `JSON` ——
     Alembic 的 `compare_type` 对这两者不敏感，跨库复用同一份迁移时要留意；
   - SQLModel/SQLAlchemy 对 `UniqueConstraint` 的 autogenerate 支持是可靠的，
     但 `create_index` 与 `create_unique_constraint` 有时会分成两条语句，属正常。
3. 如果（且仅当）你在别的机器上已经建过老库：需要手工写一个迁移补齐 `client_msg_id` 列，
   并且 `messages` 的唯一约束在建之前要先确认没有重复的 `(conversation_id, client_msg_id)`。
   骨架阶段不存在这种情况。
4. 老版本曾把幂等标记内联在 `content` 里（`<!--cmsg:xxx-->前缀`）。
   **没有任何生产数据**，所以不需要写数据清洗脚本；如日后真出现存量数据，
   清洗 SQL 形如（PostgreSQL）：
   `UPDATE messages SET content = regexp_replace(content, '^<!--cmsg:[^>]*-->', '') WHERE content LIKE '<!--cmsg:%';`
   SQLite 没有 `regexp_replace`，改用 `substr`/`replace` 或直接在 Python 里清洗。

---

## 7. 接口清单（手册 10.2 全部端点 + 6 个补实现/变体，其余未自创）

> 与手册 10.2 的差别（均已 [已决策]，见第 6 节 ④⑪⑫ 与 §4.8–§4.18）：
> 1. Chat 的 SSE 端点**多了一个 POST 形式**（手册只有 GET）；
> 2. **新增** `GET /api/v1/home/summary`（首页聚合，把首页 4 个请求合成 1 个）；
> 3. **新增** `POST /api/v1/events`（行为埋点上报，当前只落日志、未持久化）；
> 4. ~~**新增** `GET /api/v1/resume/{id}/file`~~ **[已移除]**：老简历 ATS 链路
>    （上传/解析/优化/报告/文件下载）2026-11 整体删除，见 §4.10；
> 5. **新增** `POST /api/v1/report/save`（报告快照，GET 改为纯实时，见 §4.15）
>    与 `POST /api/v1/chat/conversations/{id}/opening`（AI 先开口，见 §4.16）；
> 6. **新增** `GET /api/v1/daily/history`（每日一问历史，见 §4.18）。

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
| **Chat** | **DELETE** | `/api/v1/chat/conversations/{id}`（**删除会话及其全部消息**，见 §4.14） |
| Chat | GET | `/api/v1/chat/conversations/{id}/messages` |
| Chat | POST | `/api/v1/chat/conversations/{id}/messages` |
| **Chat** | **POST** | `/api/v1/chat/conversations/{id}/opening`（**生成/获取 AI 开场白**，幂等，见 §4.16） |
| Chat | **POST** | `/api/v1/chat/conversations/{id}/stream`（SSE，**前端使用**） |
| Chat | GET | `/api/v1/chat/conversations/{id}/stream?content=...`（SSE，**调试用，前端不调用**） |
| Chat | GET | `/api/v1/chat/conversations/{id}/conclusion` |
| Resume | GET | `/api/v1/resume/template`（**学生简历模板**："要问用户哪些字段"的唯一来源，纯静态配置不查库） |
| **Resume** | **POST** | `/api/v1/resume/polish`（**AI 只润色用户已填内容**：服务端机械校验"数字子集 + 空字段不许被填"，越界字段回退成用户原文） |
| **Resume** | **GET** | `/api/v1/resume/mine`（唯一一份简历；**没有就 `data=null`，不 404**） |
| **Resume** | **PUT** | `/api/v1/resume/mine`（手动编辑后保存，不调 AI；同样刷新 `completeness` 与画像 `resume_score`） |
| Interview | POST | `/api/v1/interview/start` |
| Interview | GET | `/api/v1/interview/{id}/questions` |
| Interview | POST | `/api/v1/interview/{id}/answer` |
| Interview | POST | `/api/v1/interview/{id}/finish` |
| Interview | GET | `/api/v1/interview/{id}/review` |
| Task | GET | `/api/v1/task` |
| Task | POST | `/api/v1/task/generate`（**命中同题「进行中」任务则复用、不新建**，`data.reused` 见 §4.17） |
| Task | GET | `/api/v1/task/{id}` |
| Task | POST | `/api/v1/task/{id}/steps/{step_id}/complete` |
| Task | POST | `/api/v1/task/{id}/abandon` |
| DailyQuestion | GET | `/api/v1/daily/today` |
| DailyQuestion | POST | `/api/v1/daily/answer` |
| **DailyQuestion** | **GET** | `/api/v1/daily/history`（**每日一问历史**，倒序 + 100 条硬上限，见 §4.18） |
| Report | GET | `/api/v1/report`（**实时计算，不落库**，见 §4.15） |
| Report | POST | `/api/v1/report/save`（保存里程碑快照 + 用户补充说明，见 §4.15） |
| Badge | GET | `/api/v1/badge`（**奖章总览**：全部 3 枚 + 进度 + 是否获得，`items` 顺序固定为门槛从低到高） |
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

> **规则 2：私有文件不得经静态目录暴露。** `uploads/` 一律不挂静态目录；对外提供
> 文件必须走带鉴权 + 归属校验的端点（老简历的下载端点已随 ATS 链路移除，见 §4.10）。

> **规则 3：对外 `stage` 一律 slug + `stage_label`**（§4.11），转换只在 schema 层做。

### 8.2 自查清单

- 密码只存 bcrypt 哈希，`UserResponse` 不含 `password_hash`；`User.__repr__` 不打印哈希。
- JWT `SECRET_KEY` 来自环境变量，默认值显式标注为"必须修改"。
- 所有"按 id 取用户私有资源"的 service 都过 `not_found_unless_owner`
  （14.5：用户只能访问自己的数据）—— 见 §6 ⑮ 的完整端点清单。
- **不要给 `uploads/` 挂静态目录**：`uploads/` 不挂 `StaticFiles`、nginx 不配
  `/uploads` location、compose 不把 uploads 挂给 nginx（第 6 节 ⑭、§4.10）。
  ⚠️ 2026-11 起老的简历文件链路（含唯一的读文件端点 `GET /resume/{id}/file`）
  **已整体移除**，现在没有任何对外读简历文件的端点；这条禁令依然有效
  （`uploads/` 下仍有历史文件，新增文件类功能也必须走带鉴权的端点）。
- **目录穿越防护**：老链路的 `resolve_download_path`（`Path.resolve()` 后校验仍在
  `UPLOAD_DIR` 之内、用路径层级比较而非字符串前缀）已随该链路删除。以后若要重新
  对外提供文件下载，**必须**重新实现这层校验，不要直接用 `utils/file.py` 里的
  `resolve_stored_path`（它刻意不做安全校验）。
- **删除类操作只删该删的**：`DELETE /chat/conversations/{id}` 只清 `conversations` +
  `messages`，**绝不触碰 `profiles` / `profile_tags`**（画像按 `user_id` 独立存储，
  删聊天记录不等于删画像）。见 §4.14.3 与第 6 节 ㉟。
- **不做"惊喜式"数据改写**：会话标题只在创建时写一次，发消息不改标题
  （决策理由见 §4.14.2）。以后要加"自动命名/自动改写用户可见字段"之前，先确认产品是否要。
- `utils/logger.sanitize()` 对 `sk-*`、password、Authorization、secret_key 做脱敏（14.6）。
- 系统 Prompt 与用户输入分不同 message role（14.7），AI 输出全部过 Pydantic 校验。
- ~~上传校验扩展名 + 大小（13.2），磁盘文件名用 `{uuid}.{ext}`（丢弃用户原始名），
  用户原始名清洗后仅作标题兜底（`utils/file.py`）~~ **[已移除]**：上传/解析链路
  2026-11 整体删除，`utils/file.py` 里 `validate_upload` / `safe_filename` /
  `build_resume_path` 等函数已不存在（见 §4.10）。
- 埋点 `payload` 写日志前同样过 `sanitize()` 并限长（14.6）。

---

## 9. 需要人工确认的下一步

1. ~~统一响应策略与前端拦截器是否匹配~~ **[已决策]**：见第 6 节 ①②③。
   前端需注意：成功路径按信封 `code` 判，错误路径读 `error.response.data` 里的信封；
   **HTTP 200 也可能带失败业务码**。
2. ~~SSE 入参方案~~ **[已决策]**：前端用 `POST .../stream` + JSON body（第 6 节 ④、§4.6）。
   GET 版本保留为调试入口。
3. ~~补 `messages.client_msg_id` 列与追问计数两列~~ **[已决策]**：
   `client_msg_id` 见第 6 节 ⑤ 与 §6.1「迁移注意事项」，
   **首次 `--autogenerate` 会自动带上，无需手写 ALTER**；
   追问计数两列**已按用户要求删除**（第 6 节 ⑥ + §6.1.2 的 `drop_followup_columns.py`），
   不要再按老文档去找它们。
4. ~~「有没有画像」的判据~~ **[已决策]**：前端看 `ProfileResponse.tested`，
   **不要**看画像对象是否存在（第 6 节 ⑧）。
5. ~~`/uploads` 无鉴权静态目录~~ **[已决策：安全修复]**：已删除静态挂载
   （第 6 节 ⑭、§4.10）。当时配套加的 `GET /api/v1/resume/{id}/file` 鉴权下载端点
   **已于 2026-11 随老简历链路移除**；「不挂静态目录」这条决策不变。
6. ~~其余端点的 1003/2001 不一致~~ **[已决策：安全修复]**：全仓库统一为
   「不存在与不属于你都返回 2001」，helper 是 `not_found_unless_owner`，
   规则见 §8.1、端点清单见第 6 节 ⑮。
7. ~~`stage` 编码不一致~~ **[已决策]**：全接口 slug + `stage_label`，见 §4.11。
8. ~~面试追问语义不明~~ **[已决策]**：追问=同一题再问，响应带 `action` 判别字段，
   见 §4.12。
9. **待办**：把补的列（`messages.client_msg_id`）回写到手册第 5 章
   （否则下一个读手册的人会漏列）。追问计数两列已删除，**不要**再回写进手册。
10. **待办**：把 `/home/summary`、`/events` 补进手册第 10 章的
    接口清单（目前只在设计说明书 5.4 里有）。~~`/resume/{id}/file`~~ 已于 2026-11
    随老简历链路移除，**不要**再补进手册（见 §4.10）。
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
17. ~~**待办**：前端「追问进度环」按 §4.6.5 的语义实现~~ **[已取消：功能已移除]**：
    7.7 的聊天侧追问计数器（含 `followup_round` / `followup_direction`）已按用户要求整体删除，
    前端**不要**再实现进度环，SSE 事件里也没有这两个字段了（见 §4.6.5 的说明）。
18. **待办**：前端首页改用 `GET /home/summary` 一次拿全，并按 §4.8 直接消费
    `next_action`（不要再自己拼「下一步」的逻辑）。
19. ~~**待办**：前端读取简历文件一律用 `GET /resume/{id}/file`（带 Authorization），
    **不要**再拼 `/uploads/...` 这类路径（该路径已不存在）~~ **[已作废：功能已移除]**：
    老简历链路（含该下载端点）2026-11 整体删除，前端简历页面改为「模板 -> 用户填 ->
    AI 只润色」三件套（`GET /resume/template`、`GET|PUT /resume/mine`、
    `POST /resume/polish`），不再有文件读写。
20. **待办**：前端面试流程按 §4.12 的 `action` 字段分派（`followup` 就地续问、
    `next_question` 追加、`finished` 调 finish）。
21. **待办**：前端 `stage` 一律按 slug 处理，展示用 `stage_label`
    （`normalizeStage` 可以简化成只认 3 个 slug 了）。
22. ~~**待确认**：追问轮数的粒度~~ **[已作废：功能已移除]**（第 6 节 ⑩）。
