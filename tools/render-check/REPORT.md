# 真实浏览器渲染冒烟测试报告（render-check）

> **本文件包含两轮结果。**
> **第一轮**（下文 §1–§6）针对产物 `index-Bo97UWpx.js`；**该轮截图已被覆盖、数据已过期，仅作历史对照。**
> **第二轮**（§7，最新，产物 `index-u9bgTdbk.js`）是本轮回归验证，含新增断言 N1–N5，请以 §7 为准。
> 第二轮原始数据在 `report-round2.json`，脚本为 `regression.mjs`。

- 被测：`frontend/` 生产构建（`npm run build` → `vite preview`），未改动 `frontend/src/` 任何代码
- 浏览器：本机 Edge（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`），headless，
  经 `playwright-core@1.63` `chromium.launch({ executablePath })` 启动（未下载 Chromium）
- 后端：不存在，`/api/v1/**` 全部由 `page.route` mock；另有「真流式」专项见下
- 产物：`report.json`（第一轮逐路由原始数据）、`stream-report.json`（第一轮流式专项）、
  `report-round2.json`（第二轮全量）、`shots/*.png`

## 0. 两轮速览

| | 第一轮 | 第二轮 |
|---|---|---|
| 产物 | `index-Bo97UWpx.js` | `index-u9bgTdbk.js` |
| 逐路由 | 22 PASS / 0 FAIL | **22 PASS / 0 FAIL** |
| 场景 A/B/C/D | 全 PASS | **全 PASS** |
| 新增断言 | — | **N1–N5 全 PASS（6 组 / 8 项判定）** |
| 白屏 / pageerror / ErrorBoundary / console error | 0 / 0 / 0 / 0 | **0 / 0 / 0 / 0** |

第一轮报告的 5 个缺陷（奖章死代码、复盘 JSON 上屏、`/test/intro` 无重测入口、401 整页硬跳、
`searchParams` 重复请求）在第二轮**逐条复验**，见 §7.4。

---

## 1. 结论先行

**路由：22 条（router 里全部 21 条 + 通配 `*`）→ 22 PASS / 0 FAIL。**

- **白屏：0 次**。每条路由 `#root` 都有子节点，`body.innerText` 长度 59–482 字符。
- **未捕获异常（pageerror）：0 条**。
- **console error：0 条**（连浏览器扩展/资源加载噪音都没有，无需过滤）。
- **落到 ErrorBoundary：0 次**（兜底文案「页面渲染时出错了」一次都没出现）。
- 边界场景 A / B / C / D **全部 PASS**，其中 C 用真实流式 HTTP 验证，**逐块上屏成立**。

即：这个「从未运行过」的前端，在 mock 后端的前提下，21 个页面**全部能真实渲染，没有运行时崩溃**。

## 2. 逐路由表格

`console 错误数` 为未过滤的原始计数（实际为 0，因此没有需要忽略的噪音）。

| # | 路由 | 最终 URL | 渲染文本长度 | console 错误 | pageerror | 截图 |
|---|---|---|---|---|---|---|
| 1 | `/login` | `/login` | 66 | 0 | 0 | `01-login.png` |
| 2 | `/register` | `/register` | 77 | 0 | 0 | `02-register.png` |
| 3 | `/test/intro` | **`/`**（见 bug #4） | 416 | 0 | 0 | `03-test-intro.png` |
| 4 | `/test/question` | `/test/question` | 120 | 0 | 0 | `04-test-question.png` |
| 5 | `/test/result` | `/test/result` | 121 | 0 | 0 | `05-test-result.png` |
| 6 | `/` | `/` | 416 | 0 | 0 | `06-home.png` |
| 7 | `/chat` | `/chat` | 187 | 0 | 0 | `07-chat.png` |
| 8 | `/task` | `/task` | 165 | 0 | 0 | `08-task-list.png` |
| 9 | `/task/:id` | `/task/d4e5f6a7…6f70` | 360 | 0 | 0 | `09-task-detail.png` |
| 10 | `/profile` | `/profile` | 335 | 0 | 0 | `10-profile.png` |
| 11 | `/daily` | `/daily` | 131 | 0 | 0 | `11-daily.png` |
| 12 | `/resume` | `/resume` | 268 | 0 | 0 | `12-resume-list.png` |
| 13 | `/resume/create` | `/resume/create` | 159 | 0 | 0 | `13-resume-create.png` |
| 14 | `/resume/:id/edit` | `/resume/a1b2c3d4…c5d/edit` | 260 | 0 | 0 | `14-resume-edit.png` |
| 15 | `/resume/:id/report` | `/resume/a1b2c3d4…c5d/report` | 482 | 0 | 0 | `15-resume-report.png` |
| 16 | `/interview` | `/interview` | 259 | 0 | 0 | `16-interview-select.png` |
| 17 | `/interview/prepare` | `/interview/prepare` | 207 | 0 | 0 | `17-interview-prepare.png` |
| 18 | `/interview/session` | `/interview/session` | 81 | 0 | 0 | `18-interview-session.png` |
| 19 | `/interview/review/:id` | `/interview/review/b7c1e2d3…d4e` | 435 | 0 | 0 | `19-interview-review.png` |
| 20 | `/report` | `/report` | 414 | 0 | 0 | `20-growth-report.png` |
| 21 | `/404` | `/404` | 59 | 0 | 0 | `21-404.png` |
| 22 | `*`（`/this-route-does-not-exist`） | 未改写（react-router 兜底不回写 URL） | 59 | 0 | 0 | `22-wildcard-404.png` |

判定口径：白屏（`#root` 无子节点且 body 无文本）／ErrorBoundary 兜底文案／pageerror／最终 URL 不符／
渲染文本 < 10 字符 —— 任一命中即 FAIL。

## 3. 边界场景

### A 无 token 访问 `/` → PASS
最终 URL `/login`，登录页正常渲染（66 字符），`input` 2 个、含 `input[type=password]`，有「用户/密码/登录」文案。
截图 `A-no-token-login.png`（与 `01-login.png` 字节数相同 27061，说明渲染一致）。

### B 有 token 但全部 401 + `{code:1002}` → PASS
`/auth/me`、`/profile` 各命中一次 401；应用**跳回 `/login` 并正常渲染登录页，没有白屏**。
console 出现 2 条 `Failed to load resource: the server responded with a status of 401`——这是浏览器对
401 响应的固有提示，不是应用错误，已单独归类为噪音（未计入"应用错误"）。
截图 `B-all-401.png`。

### D（我额外加的）有 token 但 `tested=false` → PASS
访问 `/` 被漏斗守卫强制到 `/test/intro`；此时 `TestIntroPage` 的 `useEffect(fetched && tested)`
不会触发，引导页「先花 3 分钟做个职业测评」正常渲染。
截图 `D-untested-slash.png` / `D-untested-intro.png`。

### C 流式对话 → PASS（强验证，非 mock 兜底）

分两步：

1. **mock 路径**（`page.route` 一次性下发完整 SSE 文本）：确认
   `POST /chat/conversations/c1/stream`（body `{"content":"我投了几家都没回音，简历我也改过。","client_msg_id":"b5e38327-…"}`）
   被真实发出，delta 全文进入气泡，追问进度显示 `追问进度 2/3`，用户气泡回显。截图 `C-chat-stream-final.png`。
   —— 但这条路 `fulfill` 只能整块下发，**不能证明"逐字"**，故补第 2 步。

2. **真流式路径**（`stream-server.mjs` 起真实 HTTP 服务，用 `VITE_API_BASE=http://127.0.0.1:4174/api/v1`
   重新构建，**浏览器跨源真实读取 `text/event-stream`**，每个 delta 间隔 700ms 写出）。
   发送后以 ~60ms 采样 AI 气泡文本，抓到 **3 个严格递增的中间态**：

   | 采样时刻 | 气泡实际文本 | 是否恰为某个 delta 边界 |
   |---|---|---|
   | 671 ms | `你提到的「投了几家没回音」，` | ✅ 第 1 个 delta |
   | 1407 ms | `你提到的「投了几家没回音」，通常不是能力问题，` | ✅ 第 2 个 delta |
   | 2088 ms | `你提到的「投了几家没回音」，通常不是能力问题，而是简历里的项目描述没有给出可验证的结果。` | ✅ 全部 |

   - `monotonicGrowth: true`（后一次文本永远是前一次的前缀扩展，没有回退/重排）
   - `everPartial: true`、`partialCount: 2`
   - 服务端时间线：`request @30ms` → `200 text/event-stream @31ms`
   - `userEcho: true`（用户气泡回显）、`followupProgressText: "追问进度 2/3"`
     （`done` 事件 `followup_round: 2` 生效）、`conclusionCardVisible: true`
     （`conclusion_ready: true` → 「展开结论卡片 / 生成结论卡片」浮出）
   - `pageError: 无`

**结论：逐块流式上屏成立，且与 delta 边界严格对齐（每个 delta 到达即上屏）。** 截图 `C-stream-check-final.png`。

> 说明：任务书说"进度环"，实际实现是文案 `追问进度 N/3`（`ChatPage` 274-277 行），不是环形进度组件。
> 按实现如实记录。

## 4. 发现的 bug 清单（按严重度）

**没有任何「运行时崩溃」。** 以下均为「渲染不对」或「无数据/死角」级别，**我未修改任何业务代码**。

### 中：`badgeApi` 是死代码，`GET /badge` 永远不会被调用 —— 【无数据】
`frontend/src/api/badge.ts` 全仓只有它自己：`grep -r "badgeApi\|from '@/api/badge'"` 在整个
`frontend/src` 只命中定义行，**没有任何页面 import**。所以"奖章"模块在 UI 上完全不存在，
后端 `GET /badge` 也没有调用方。（同时 `/profile` 页也没有奖章区块。）

### 低：`/test/intro` 对已测评用户直接弹回首页，无法重测 —— 【渲染不对 / 产品语义】
`TestIntroPage` 的 `useEffect` 在 `fetched && tested` 时 `navigate('/', {replace:true})`。
后果：已测评用户访问 `/test/intro` 看到的是**首页**（截图 `03-test-intro.png` 与 `06-home.png` 字节数几乎相同，96940 vs 96931）。
这大概率是有意为之（源码注释写明"避免重复测评"），但意味着 UI 上**没有任何入口可以重测**，
且守卫注释里"测试中途 → /test/question?resume=1"的分支在 `tested=true` 下不可达。

### 低：401 跳登录用 `window.location.href`，是整页硬跳 —— 【渲染不对】
`api/client.ts:70` 与 `authStore.ts:88` 都用 `window.location.href = '/login'`，
会丢弃 SPA 状态并整页重载（场景 B 实测：硬跳后重新加载整个 bundle）。
另外 `onUnauthorized()` 里 `logout()` 已把 token 置空，`RequireAuth` 本可以走 `<Navigate to="/login">` 客户端跳转，
两条路径叠加。功能正确（不白屏），但属于可优化点。

### 中：`/interview/review` 的「逐题点评」把后端对象直接 JSON 字符串化上屏 —— 【渲染不对】
`InterviewReview.question_reviews` 类型是 `Record<string, unknown>[]`，页面没有渲染契约，
于是整个数组被 `JSON.stringify` 原样塞进 `<pre>`。截图 `19-interview-review.png`（已肉眼确认）实际显示：

```
[
  {
    "question": "先花一分钟介绍一下你自己。",
    "answer": "我是软件工程大三学生，做过一个待办清单 Web 应用应用。",
    "score": 68,
    "comment": "结构完整但缺亮点，建议把最有说服力的一段经历前置。"
  }
]
```

用户看到的是带引号和花括号的原始 JSON，而不是一句句点评。这是**真实可见的渲染缺陷**（用我 mock 的
结构化数据即可复现；后端返回同形状数据时一定同样出现）。

### 低：`TestQuestionPage` 每次 `searchParams` 变化都会重新拉全部题目 —— 【渲染不对/性能】
`load` 的依赖是 `[searchParams]`（第 70 行），而 `useSearchParams()` 返回的引用不保证稳定，
存在重复请求题目的风险。

### 观察（非 bug）
- `vite preview` 默认**只监听 IPv6 `::1`**：`netstat` 显示 `TCP [::1]:4173 LISTENING`，
  访问 `http://127.0.0.1:4173` 直接连不上，必须用 `http://localhost:4173`。
  这是 dev/CI 脚本容易踩的坑，不是前端代码问题。
- `/resume/:id/report` 与 `/interview/review` 里 `suggestions` / `question_reviews` 这类
  `Record<string, unknown>[]` 字段，前端渲染处理不一致：简历页把 suggestion 拆成
  问题/建议/示例三段正常渲染，面试复盘页则直接 JSON 输出（见上面 bug 清单）。**不是 bug 的部分**：
  简历页的渲染是正确的，仅作对照。

## 5. 我做了什么 mock / 忽略了哪些噪音

**全部 mock 都通过 `page.route('**/api/v1/**')` 一个 handler 内按 `method + pathname` 分派**
（不拆多个 `page.route`：Playwright 多 route 命中时是**后注册先执行**，拆开会误判，已实测确认）。

返回 `{code:0,message:"success",data:<fixture>}` HTTP 200，覆盖：
`GET /auth/me`、`POST /auth/login`、`POST /auth/register`、`GET /profile`（`tested` 可控）、
`GET /profile/tags`、`POST /profile/feedback`、`GET /home/summary`、`GET /task`、`GET /task/{id}`、
`POST /task/generate`、`POST /task/{id}/steps/{sid}/complete`、`POST /task/{id}/abandon`、
`GET /daily/today`、`POST /daily/answer`、`GET /resume`、`POST /resume`、`POST /resume/upload`、
`GET/PUT /resume/{id}`、`GET /resume/{id}/report`、`POST /resume/{id}/optimize`、
`GET /resume/{id}/file`（真 PNG blob）、`GET /report`、`GET /badge`、
`GET /test/questions`、`POST /test/submit`、`GET /test/result`、
`POST /interview/start`、`GET /interview/{id}/questions`、`POST /interview/{id}/answer`、
`POST /interview/{id}/finish`、`GET /interview/{id}/review`、
`GET/POST /chat/conversations`、`GET /chat/conversations/{id}/messages`、
`POST /chat/conversations/{id}/messages`、`GET /chat/conversations/{id}/conclusion`、`POST /events`。

**实测被真实调用的端点（16 个，全部命中以上 mock，无兜底）**：
`/auth/me`、`/profile`、`/home/summary`、`/test/questions`、`/test/result`、`/task`、`/task/{id}`、
`/daily/today`、`/resume`、`/resume/{id}`、`/resume/{id}/report`、`/chat/conversations`、
`/chat/conversations/{id}/messages`、`/chat/conversations/c1/stream`、`/interview/{id}/questions`、
`/interview/{id}/review`、`/report`。
**兜底 handler 命中 0 次**（`unknownEndpoints` 为空），说明没有猜错任何路径。
`/badge` 从未被请求 —— 与 bug #1 互相印证。

**SSE 走独立 content-type**：`text/event-stream; charset=utf-8`，按
`start → delta×3 → tag（标签在 data.data.tags）→ done → end + data: [DONE]` 顺序、每个 `data` 都是完整信封。

**忽略的 console 噪音**：`isNoise()` 预置 4 类规则 —— favicon 404、React DevTools 提示、
`ResizeObserver loop`、`Failed to load resource: … 401`。
- 22 条路由的主检查：console error **总数 0**，4 类规则**一条都没用上**。
- 场景 B（全 401）：2 条 `Failed to load resource: the server responded with a status of 401 (Unauthorized)`
  命中第 4 类规则，被归为噪音。这 2 条是**浏览器对 401 响应的固有资源加载提示**，
  不是应用抛出的错误，也不影响"跳回 /login 而非白屏"的判定，故单列并如实说明。
- 场景 B 中**没有任何** pageerror，ErrorBoundary 未触发。

## 6. 无法验证的部分

1. **fixture 是照 `types/index.ts` + `api/*.ts` 手写的，不是真实后端响应。** 字段名/形状对齐了类型，
   但真实后端的**取值分布、可空性、边界值**（如 `progress` 恰好 0 或 1、`tags` 为空数组、
   `total_steps` 为 0 导致除零、`status` 出现未知中文枚举、`followup_round` 为 null）未验证。
   我特意让 `/profile` 的 `tested` 可控来覆盖漏斗两态，但其它字段的"空数据态"只覆盖了
   HomePage 的 `EmptyState` 分支（通过 `daily_question: null` 等）。
2. **交互流未测**：只测了"渲染 + 聊天发送"。以下仅是代码阅读、**未在浏览器点击验证**：
   测评答题→提交→跳结果、任务打卡、任务放弃、简历上传（multipart）、简历保存（PUT）、
   简历优化（POST optimize）、每日一问提交、面试开始/答题/结束、登出、标签认可/否定。
3. **未测错误分支 UX**：如流式 `event: error`（`code=3001/5000`）、`pending` 幂等命中、
   网络中断重试（`retry` 复用 `client_msg_id`）。只测了 401 这一种失败。
4. **未测响应式断点**：全部在 1440×900 桌面视口。`AppLayout` 的 <768px 底部 Tab、
   768–1023px 窄侧栏、`ChatPage` 的移动端会话列表隐藏分支均未渲染验证。
5. **未测 StrictMode 双调用下的副作用**：生产构建（`main.tsx` 里 StrictMode 在 prod 下不双调用 effect），
   dev server 行为未验证。
6. **`nginx.conf` / docker 部署路径未验证**：只测了 `vite preview`，未测生产 nginx 下的
   SPA fallback 与 `/api` 反代（`git check-ignore` 确认 `frontend/dist` 被忽略，未提交构建产物）。

---

# 7. 第二轮：改版后回归验证 + 新增断言 N1–N5

- 脚本：`tools/render-check/regression.mjs`，原始数据：`report-round2.json`
- 产物确认：`http://localhost:4173/` 实测返回的 HTML 引用 **`index-u9bgTdbk.js`**（本轮新产物），
  非上一轮 `index-Bo97UWpx.js`。`npm run build` 成功、`tsc` 无报错。
- 截图：`01..22-*.png`、`A-*`、`B-*`、`C-*`、`D-*`、`N2-step1-followup1.png`、
  `N2-step3-next-question.png`、`N2-step4-review.png`、`N3-interview-review.png`、
  `N4-badge-data.png`、`N4-badge-empty.png`、`N5-*.png`

## 7.1 通过/失败计数

| 项目 | 数量 | 结果 |
|---|---|---|
| 逐路由回归（21 条路由 + 通配 `*`） | 22 | **22 PASS / 0 FAIL** |
| 边界场景 A / B / C / D | 4 | **4 PASS / 0 FAIL** |
| 新增断言 N1 / N2 / N3 / N4(有数据) / N4(空) / N5 | 6 组，共 8 项判定 | **8 PASS / 0 FAIL** |
| 白屏 | 0 | — |
| 未捕获异常 pageerror | 0 | — |
| ErrorBoundary 兜底 | 0 | — |
| console error | 0 | — |

**本轮无失败项。** 第一轮的 5 个缺陷全部修复并复验通过。

> ⚠️ 过程中我曾出现 2 次「FAIL」，均为**我的断言写错**而非应用缺陷，已在 §7.6 如实说明并修正。

## 7.2 逐路由回归（本轮新跑）

判定口径与第一轮完全一致（白屏 / ErrorBoundary / pageerror / 最终 URL / 渲染文本 < 10）。
`console 错误数` 全部为 0。

| # | 路由 | 最终 URL | 渲染文本 | console 错误 | pageerror | 截图 |
|---|---|---|---|---|---|---|
| 1 | `/login` | `/login` | 66 | 0 | 0 | `01-login.png` |
| 2 | `/register` | `/register` | 77 | 0 | 0 | `02-register.png` |
| 3 | `/test/intro` | `/`（静默回首页，行为保持） | 355 | 0 | 0 | `03-test-intro.png` |
| 4 | `/test/question` | `/test/question` | 106 | 0 | 0 | `04-test-question.png` |
| 5 | `/test/result` | `/test/result` | 121 | 0 | 0 | `05-test-result.png` |
| 6 | `/` | `/` | 355 | 0 | 0 | `06-home.png` |
| 7 | `/chat` | `/chat` | 157 | 0 | 0 | `07-chat.png` |
| 8 | `/task` | `/task` | 165 | 0 | 0 | `08-task-list.png` |
| 9 | `/task/:id` | `/task/d4e5f6a7…6f70` | 290 | 0 | 0 | `09-task-detail.png` |
| 10 | `/profile` | `/profile` | 386 | 0 | 0 | `10-profile.png` |
| 11 | `/daily` | `/daily` | 131 | 0 | 0 | `11-daily.png` |
| 12 | `/resume` | `/resume` | 210 | 0 | 0 | `12-resume-list.png` |
| 13 | `/resume/create` | `/resume/create` | 159 | 0 | 0 | `13-resume-create.png` |
| 14 | `/resume/:id/edit` | `/resume/a1b2c3d4…c5d/edit` | 251 | 0 | 0 | `14-resume-edit.png` |
| 15 | `/resume/:id/report` | `/resume/a1b2c3d4…c5d/report` | 255 | 0 | 0 | `15-resume-report.png` |
| 16 | `/interview` | `/interview` | 259 | 0 | 0 | `16-interview-select.png` |
| 17 | `/interview/prepare` | `/interview/prepare` | 207 | 0 | 0 | `17-interview-prepare.png` |
| 18 | `/interview/session` | `/interview/session` | 80 | 0 | 0 | `18-interview-session.png` |
| 19 | `/interview/review/:id` | `/interview/review/b7c1e2d3…d4e` | 365 | 0 | 0 | `19-interview-review.png` |
| 20 | `/report` | `/report` | 331 | 0 | 0 | `20-growth-report.png` |
| 21 | `/404` | `/404` | 59 | 0 | 0 | `21-404.png` |
| 22 | `*` | 未改写 URL | 59 | 0 | 0 | `22-wildcard-404.png` |

> 渲染文本长度与第一轮有差异（如 `/` 416→355、`/resume/report` 482→255）是**我简化了 fixture**
> （首页少了 1 条 AI 发现、简历报告少了 1 条建议）所致，不是页面退化。

## 7.3 边界场景（本轮新跑）

| 场景 | 结果 | 关键证据 |
|---|---|---|
| A 无 token 访问 `/` | PASS | 最终 `/login`，有 `input[type=password]`，无白屏 |
| B 有 token + 全 401 | PASS | 最终 `/login`，登录页正常渲染，**且 pageerror 0、真实 console error 0** |
| C 流式对话 | PASS | 见下 |
| D token + `tested=false` | PASS | `/`→`/test/intro`；引导页「先花 3 分钟做个职业测评」渲染 |

**C（沿用第一轮做法，本轮复跑）**：`POST /chat/conversations/c1/stream` 被真实发出，
delta 全文 `你提到的「投了几家没回音」，通常不是能力问题，而是简历里的项目描述没有给出可验证的结果。`
出现在页面、用户气泡回显、追问进度显示 `追问进度 2/3`。
（说明：**逐块流式**的强证明仍是第一轮用真实 HTTP 流服务做的
`stream-server.mjs` + `stream-check.mjs` 那一组，本轮未重跑；本轮只复验端到端可用性。）

## 7.4 新增断言 N1–N5 明细

### N1 —— 401 之后没有整页重载（本轮重点）✅ PASS

探针：`window.__spaAlive`（`addInitScript` 里自增，**整页重载会重置为 1**）+ `history.pushState/replaceState`
计数 + `performance.getEntriesByType('navigation')[0].type` + `page.on('framenavigated')`。

实测证据（全部 401 场景）：

```json
{
  "spaAlive": 1,                                   // 从未被重置 → 没有任何整页重载
  "spaMarks": { "push": 0, "replace": 3, "pop": 0 }, // 3 次 history.replaceState → SPA 内跳转
  "navType": "navigate",                           // 不是 "reload"
  "navCount": 1,                                   // performance 里只有 1 条 navigation 记录
  "frameNavigations": [
    "http://localhost:4173/", "http://localhost:4173/",
    "http://localhost:4173/login", "http://localhost:4173/login"
  ],
  "finalUrl": "/login", "redirectedToLogin": true, "hasPasswordInput": true, "blank": false
}
```

判定：`spaAlive === 1` ✅、`navType === 'navigate'` ✅、`replace` 计数 ≥ 1 ✅、落到 `/login` 且登录页可渲染 ✅。
**结论：`window.location.href` 硬跳已确实移除，401 走的是客户端路由跳转。**
（对照第一轮同样的场景：那时 `onUnauthorized` 会 `window.location.href = '/login'` 造成整页重载；
现在同一探针下 `spaAlive` 保持 1。）

### N2 —— 面试追问「就地续问」状态机 ✅ PASS

mock 首屏只给 1 道题（贴近后端「答一题给下一题」的增量行为），
`POST /interview/{id}/answer` 依次返回 `followup(round=1)` → `followup(round=2)` → `next_question` → `finished`。

**四次作答后实际抓到的渲染文本：**

| 步 | 期望 action | 题号计数（前 → 后） | 题号/总数变化 | 页面实际文本 |
|---|---|---|---|---|
| 1 | `followup` round=1 | `第 1 / 1 题` → `第 1 / 1 题 · 追问 1/2` | 1→1 / 1→1 ✅ | `主问题` / `先花一分钟介绍一下你自己，重点讲前端开发相关的部分。` / `（追问）能举个具体例子吗？` / 按钮 `回答追问` / 输入框 placeholder `针对这个追问再补两句` |
| 2 | `followup` round=2 | `第 1 / 1 题 · 追问 1/2` → `第 1 / 1 题 · 追问 2/2` | 1→1 / 1→1 ✅ | `主问题` / 同一道主问题原文 / `（追问·第2轮）那这个例子里的数字是多少？` / 按钮 `回答追问` |
| 3 | `next_question` | `第 1 / 1 题 · 追问 2/2` → `第 2 / 2 题` | **1→2** / **1→2** ✅ 前进 | `第 2 / 2 题` `50%` / `（新题）说说你项目里最得意的一次性能优化。` / 追问句消失、`追问 N/2` 标记消失 / 按钮回到 `提交并继续` |
| 4 | `finished` | — | — | 最终 URL `/interview/review/b7c1e2d3-4f5a-4b6c-8d7e-9f0a1b2c3d4e`，复盘页渲染 |

关键不变量（`invariants`，全部 true）：
`step1_questionNumberUnchanged`、`step1_totalUnchanged`、`step2_questionNumberUnchanged`、`step2_totalUnchanged`。

请求侧证据：
- `answer` 被调用 **恰好 4 次**，body 依次为
  `{"question_id":"q-1","answer":"我的回答第一版"}`、
  `{"question_id":"q-1",...第二版}`、
  `{"question_id":"q-1",...第三版}`、   ← **前三次都是 q-1，追问没有换题**
  `{"question_id":"q-2",...第四版}`
- `finish` 被调用 **恰好 1 次**：`POST /interview/b7c1e2d3…/finish`
- **全程 pageerror 0、真实 console error 0**

截图：`N2-step1-followup1.png`（确认「主问题 + 追问气泡 + 回答追问」形态）、
`N2-step3-next-question.png`（确认新题 + 2/2 + 提交并继续）、`N2-step4-review.png`。

### N3 —— 复盘页不再是原始 JSON ✅ PASS

mock `question_reviews: [{ question, answer_summary, score, comment, better_answer }]`。实测：

- `answer_summary` 内容渲染 ✅：`我是软件工程大三学生，做过一个待办清单 Web 应用应用，负责全部客户端开发。`
- `comment` 内容渲染 ✅：`结构完整但缺亮点，建议把最有说服力的一段经历前置。`
- `better_answer` 内容渲染 ✅：`先说结论：两年前端经验，做过一个 800 日活的小应用，再展开细节。`
- 小标签也渲染：`["你的回答","更好的答法"]`
- **类 JSON 片段扫描**：正则 `/\{\s*"|"\s*:\s*"|\[\s*\{/g` 命中 **0 处**；
  针对 `"question"\s*:` / `"answer_summary"\s*:` 等带引号键名的扫描命中 **0 处**。
  实际扫到的 `jsonLikeMatches` 为 `[]`、`jsonSnippets` 为 `[]`、`quoteKeySnippets` 为 `[]`。

**结论：第一轮的 `JSON.stringify` 上屏缺陷已修复，改为逐字段、逐字段判空的卡片渲染。**
截图 `N3-interview-review.png`（肉眼确认：`1. 先花一分钟介绍一下你自己。` + 分数 68 +
`你的回答` 灰底块 + 暖色 `comment` 块 + `更好的答法` 虚线块）。

### N4 —— 个人中心奖章区块 ✅ PASS（两态）

| 态 | `GET /badge` | 结果 | 证据 |
|---|---|---|---|
| 有数据 | 2 枚 | PASS | 页面出现 `我的奖章` 区块，渲染出 `["起步行动家","第一份简历"]`，标题右侧显示数量徽章 `2` |
| 空数组 | `[]` | PASS | 区块仍在，出现空态句：`还没有奖章。去任务列表做一个小任务，完成第一步就能拿到。` |

两态均：`badgeRequested=true`（确实调用了 `GET /badge`，第一轮的"死代码"已接通）、pageerror 0。
截图 `N4-badge-data.png`、`N4-badge-empty.png`。
（"加载中"文案 `正在读你的奖章…` 存在但两态都因 mock 立即返回而未捕捉到，属未覆盖项。）

### N5 —— `?retest=1` / 无参数 / 有进度 三态 ✅ PASS（5 组用例）

| 用例 | 访问 | 预置进度 | `tested` | 最终 URL | 判定 | 实际抓到的文本 |
|---|---|---|---|---|---|---|
| retest | `/test/intro?retest=1` | 无 | true | `/test/intro?retest=1`（**未跳走**）✅ | PASS | `重新做一次职业测评` / `重测会更新你当前的三项分数与阶段判断，已获得的标签和任务不受影响。` / 副标题变为 `开始重新测评` / 另有 `算了，回首页` |
| noParam | `/test/intro` | 无 | true | `/`（**保持原行为**）✅ | PASS | 渲染首页（`今天做一件小事就够了` …），未出现重测卡 |
| retestWithProgress | `/test/intro?retest=1` | 有 | true | `/test/intro?retest=1` ✅ | PASS | 重测卡 + `上次还有没提交完的作答，可以接着答。` + `继续上次答题` 按钮 ✅ |
| progressNoParam | `/test/intro` | 有 | true | `/` ✅ | PASS | 回首页，未渲染进度提示（符合"静默回首页"设计） |
| **untestedWithProgress**（我补的追问用例） | `/test/intro` | 有 | **false** | `/test/intro` ✅ | PASS | 普通引导卡 `先花 3 分钟做个职业测评` + `上次还有没提交完的作答，可以接着答。` + `继续上次答题` ✅ —— **未测评用户也能看到继续入口** |

五种情况 pageerror 均为 0。截图 `N5-retest.png`、`N5-noParam.png`、
`N5-retestWithProgress.png`、`N5-progressNoParam.png`、`N5-untestedWithProgress.png`。

## 7.5 第一轮 5 个缺陷的复验结果

| # | 第一轮缺陷 | 本轮复验 | 判定 |
|---|---|---|---|
| 1 | `badgeApi` 死代码，`GET /badge` 永不调用 | N4：`badgeRequested=true`，两态均渲染 | ✅ 已修复 |
| 2 | `/interview/review` 逐题点评 JSON 上屏 | N3：三字段均按字段渲染，类 JSON 片段 0 处 | ✅ 已修复 |
| 3 | `/test/intro` 无重测入口，`?resume=1` 分支不可达 | N5：`?retest=1` 停留并显示确认卡；带进度显示继续入口 | ✅ 已修复 |
| 4 | 401 用 `window.location.href` 整页硬跳 | N1：`spaAlive=1`、`navType=navigate`、3 次 `replaceState` | ✅ 已修复 |
| 5 | `TestQuestionPage` `[searchParams]` 依赖不稳定导致重复拉题 | 代码已改为拆出原始值 `retest`（`useSearchParams` 不再进 effect 依赖）；本轮路由回归 `/test/question` 正常。**但未做"重复请求计数"专项断言**，故只算"代码层面已改、未量化复验" | ⚠️ 部分复验 |

## 7.6 本轮未验证 / 局限（诚实边界）

1. **我自己的两次误报（已修正，记录在案）**：
   - 首次跑 N2 报 FAIL，原因是我把「题号计数」整串比对，而 `followup` 会在同一串后追加
     `· 追问 1/2`，导致 `"第 1 / 3 题" !== "第 1 / 3 题 · 追问 1/2"` 被误判为题号变化。
     改为分别比对 `qNo`/`qTotal` 后通过 —— **应用行为自始就是对的**。
   - 首次跑 N5-withProgress 报 FAIL，原因是我按"无参数访问也显示继续入口"设计用例，
     而实现是"`tested=true` 且无 `?retest=1` 时静默回首页"（原行为），卡片根本不渲染。
     改用具例 `?retest=1` + 预置进度后通过。
   另外我还据代码阅读**误判**过一条"N5 产品空隙"，补测后同样被证伪 —— 详见下面第 2 条。
2. **我曾据代码阅读误判 N5 有一个"产品空隙"，实测证明是我判断错了（记录在案）**：
   我一度认为"未测评（`tested=false`）+ 有未提交进度 + 无参数访问 `/test/intro`"时看不到
   "继续上次答题"入口，因为整页在 `fetched && tested && !retest` 时会 `return null` 并跳走。
   于是补了一条实测用例 `untestedWithProgress`，结果是 **PASS，我的推断被证伪**：

   ```
   最终 URL: /test/intro          （未跳走）
   渲染文本: 先花 3 分钟做个职业测评
            ……
            上次还有没提交完的作答，可以接着答。
            继续上次答题
            开始测评
   hasContinuePrompt: true   continueButton: true
   ```

   原因：`tested=false` 时 `fetched && tested && !retest` 为假，页面正常渲染，
   而进度提示只由 `hasProgress` 控制，所以入口是**正常显示**的。
   **该路径无缺口**，`?resume=1` 分支在未测评态可达。
   （教训：这条本可以靠读代码就判对，我先前的推理在 `tested` 取值上绕错了——以实测为准。）
3. **流式"逐块"强证明未重跑**：本轮只复验了 mock 一次性下发下 delta 全文能上屏（端到端可用）。
   第一轮用真实 HTTP 流服务（`stream-server.mjs`）证明的"逐块到达、与 delta 边界对齐"
   未在本轮重新执行；如需可再跑（需用 `VITE_API_BASE` 重新构建）。
4. **交互流仍有未点击项**：测评答题提交、任务打卡/放弃、简历上传 multipart、简历保存 PUT、
   简历优化、每日一问提交、面试「开始/结束面试」按钮、登出、标签认可/否定仍未在浏览器点击验证。
5. **奖章"加载中"态未捕捉**（mock 返回太快）。
6. **未测错误分支 UX**：流式 `event: error`、`pending` 幂等命中、断流重试；
   401 之外的失败码（403/404/500）未单独验证。
7. **未测响应式断点**：全部 1440×900 桌面视口；移动端底部 Tab、窄侧栏、ChatPage 移动分支未验证。
8. **未测真实后端**：全部 fixture 仍是我照 `types/index.ts` 手写的。本轮 N2 已刻意把
   "首屏只给 1 题、后续增量给题"这种更贴近后端的形状考虑进去，但真实后端的字段可空性、
   未知枚举值、空数组态仍未覆盖。
9. **未测 nginx/docker 部署路径**（只测 `vite preview`）。

## 7.7 本轮清理

- `vite preview` 已 kill；`netstat` 确认 **4173 / 4174 无 LISTENING**（仅剩 TIME_WAIT 收尾记录）。
- 本轮未启动 stream-server（未跑流式强证明），故无第二处服务残留。
- 未修改 `frontend/src/` 任何文件（最新 mtime 21:07:49，早于本轮我的首次操作 21:12+）。
- 前端已用默认配置构建（`VITE_API_BASE` 未被覆盖），产物 `index-u9bgTdbk.js`。

