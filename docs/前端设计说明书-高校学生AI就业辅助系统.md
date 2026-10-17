# 高校学生AI就业辅助系统 前端设计说明书

版本：V1.3（5.1/5.2 换成与后端定稿的真实契约）
日期：2026-09-18
依据：《高校学生AI就业辅助系统 开发手册》第 1.3、4.2、8、10 章
范围：仅前端（Web + Electron 渲染层），不含后端实现

> 变更记录
> - V1.4（2026-10-15）：**第 6 章配色整体作废**，改以 `docs/设计系统-页面规范.md` 第二节为唯一真源——近白画布 `#fbf9f6` + 主墨 `#091426` + 浅桃 `#ffdbca`，并**全站删除琥珀色**。本章保留作历史，不再作为配色依据。
> - V1.3：5.1 改为「HTTP 状态码 + 业务码双路径解包」（401/403/404/500 带信封）；5.2 改为具名事件 + 事件内信封的真实 SSE 契约（POST + fetch），补充 `pending` 幂等事件与 `followup_round` 可为 null 的降级要求。
> - V1.2：主题色改为**浅米黄底（`43 44% 96%`）+ 低饱和克制蓝主色（`213 30% 44%` ≈ `#4E6D92`）**；确立"暖色负责氛围、冷色负责动作"的分工；补充语义色与图表配色；6.1 新增第 2、3 条用色纪律。
> - V1.1：UI 组件库由 Ant Design 改为 **shadcn/ui**；新增 6.1 配色纪律、6.3 主题变量、6.5 组件映射；第 11 章问题同步更新。
> - V1.0：初稿（信息架构、页面线框、状态管理、API 层、设计系统）。

> 与手册的偏差统一记录在 `docs/开发手册-勘误与决策记录.md`。

---

## 1. 设计目标与约束

### 1.1 产品约束推导出的交互原则

手册第 1.2 章定了四条核心理念，前端必须把它们翻译成可执行规则，否则会退化成普通工具站：

| 产品理念 | 前端落地规则 |
|---|---|
| 主动挖掘，而非被动响应 | 首页永远给出**单一最优先 CTA**（下一步建议），不给"功能九宫格"；空状态不能是空白页，必须是 AI 主动提议 |
| 阶段分层，而非年级标签化 | 导航与首页模块**按 `profile.stage` 动态排序/显隐**（详见 2.2、3.3） |
| 无感采集，而非问卷轰炸 | 除首次测试表外**不弹任何采集表单**；信息从对话、打卡、跳题行为中产生，前端只负责上报事件 |
| 保姆级引导，面向纯小白 | 每个任务步骤必须有"行动指引 + 资源链接"；任何 AI 输出都要有可点击的下一步，不能只是文字 |

### 1.2 技术约束（UI 层改用 shadcn/ui）

React 19 + TypeScript 6 + Vite 8 + Zustand + **shadcn/ui（Radix + Tailwind CSS v4）** + axios + React Router v7。

> 版本以实际脚手架为准（`create-vite` 当前模板）。手册 2.1 写的 React 18 / React Router v6 已确认**回退不必**，见《勘误与决策记录》4.6。

> **与手册的偏差（需同步修订手册 2.1、8.5）**：手册原定 Ant Design。改成 shadcn/ui 的理由：① 产品是"陪伴型"而不是中后台，AntD 的企业级观感偏重；② shadcn 是源码级组件，配色/圆角/密度完全可控，才可能落实 6.1 的用色纪律；③ 组件即源码，没有主题黑盒和版本升级风险。
>
> **代价**：AntD 现成的 `Form` 校验、`Table` 排序分页、`Upload`、`Steps`、`message` 要自己拼（Form → react-hook-form + zod；Upload → 老简历链路删除后**已无上传场景**；Steps → 自建）。6.5 已逐项给出替代方案。
>
> **收益**：样式系统只剩 Tailwind 一套，不再有"组件库 token 与 Tailwind 打架"；按需 add 组件，产物体积更小。

### 1.2.1 新增依赖清单（UI 层）

| 依赖 | 用途 |
|---|---|
| `tailwindcss` + `tailwindcss-animate` | 样式与动效 |
| `class-variance-authority` `clsx` `tailwind-merge` | variant 定义与类名合并（`cn()`） |
| `lucide-react` | 图标，全站唯一图标库 |
| `@radix-ui/react-*` | shadcn 组件底座，按 add 的组件逐个引入 |
| `react-hook-form` `zod` `@hookform/resolvers` | 表单与校验 |
| `sonner` | 轻提示 Toast |
| `react-dropzone` | **已无用**：老简历链路（上传拖拽）已整体删除，现行简历是问答式生成；依赖还在 `package.json` 里，但代码里没有任何引用 |
| 图表库 | 待定，见第 11 章问题 3 |

> 通过 `shadcn` CLI 逐步 `add`，不一次性装全套。

### 1.3 平台约束

- **Web 优先**：M1/M2 只做 Web，Electron 在 M3 包壳（手册 2.2、9.1）。
- **响应式下限 360px**：学生大量时间在手机上，Web 必须可用（侧栏 → 底部 Tab）。
- **桌面端增强点**（M3 才做，但布局要预留插槽）：系统托盘、系统通知、每日一问弹窗。
- **浏览器下限**：Chrome/Edge 100+、Safari 15+（`ReadableStream` + `TextDecoder` 需支持）。

---

## 2. 信息架构

### 2.1 路由表（在手册 8.1 基础上补充权限与守卫）

| 路径 | 页面 | 权限 | 前置条件 | 里程碑 |
|---|---|---|---|---|
| /login | 登录 | 公开 | — | M1 |
| /register | 注册 | 公开 | — | M1 |
| /test/intro | 测试引导 | 登录 | — | M1 |
| /test/question | 测试答题 | 登录 | 已进 intro | M1 |
| /test/result | 测试结果 | 登录 | 已提交 | M1 |
| / | 首页（阶段化仪表盘） | 登录 | 已完成测试表 | M1 |
| /chat | AI 职业指导对话 | 登录 | 同上 | M1 |
| /task | 任务列表 | 登录 | 同上 | M1 |
| /task/:id | 任务详情 | 登录 | 同上 | M1 |
| /profile | 个人中心 / 画像 | 登录 | 同上 | M1 |
| /daily | 每日一问 | 登录 | 同上 | M1 |
| /resume | 我的简历（问答式生成，填写态 ↔ 展示态） | 登录 | 同上 | M2 |
> 简历原有四条路由（`/resume/list` 列表、`/resume/create` 引导式新建、`/resume/:id/edit` 编辑、`/resume/:id/report` 优化报告）已随老链路（上传 → 解析 → ATS 评分 → 报告 → 下载）一并删除，现在只有上面这一行（见《勘误与决策记录》9.17）。
| /interview | 面试选择 | 登录 | 同上 | M2 |
| /interview/prepare | 面试准备（设备/场景） | 登录 | 同上 | M2 |
| /interview/session | 面试进行（一题一屏） | 登录 | 有 interviewId | M2 |
| /interview/review/:id | 面试复盘 | 登录 | 面试已完成 | M2 |
| /report | 成长报告 | 登录 | 同上 | M3 |
| /404、/* | 兜底 | 公开 | — | M1 |

**首次进入漏斗（必须写死，避免用户乱窜）：**

```
未登录            → /login
已登录 + 无画像    → 强制 /test/intro（其它路由一律重定向）
已登录 + 有画像    → /（首页）
已登录 + 测试中途  → /test/question?resume=1（本地存答题进度）
```

### 2.2 导航结构

**桌面（≥1024px）**：左侧固定侧栏 220px + 顶部 56px 条。

```
┌ 侧栏 ────────┐ ┌ 顶部条 ────────────────────────────┐
│ ◆ AI就业助手  │ │ 面包屑        [阶段徽章] 🔔  [头像▾] │
│ ▸ 首页        │ └────────────────────────────────────┘
│ ▸ AI对话      │
│ ▸ 成长任务    │
│ ▸ 每日一问    │
│ ▸ 简历        │
│ ▸ 模拟面试    │
│ 我的          │
│ ▸ 个人中心    │
│ ▸ 成长报告    │
└──────────────┘
```

**移动（<768px）**：底部 Tab 四项（首页 / 对话 / 任务 / 我的），其余功能在"我的"里以列表进入。

**阶段自适应排序**（手册 1.3 推荐策略的前端落地）：

| 阶段 | 侧栏顺序 | 首页首屏主 CTA |
|---|---|---|
| 职业探索期 | 首页、AI对话、每日一问、成长任务、简历、模拟面试 | 「和 AI 聊聊我的方向」 |
| 求职准备期 | 首页、简历、成长任务、AI对话、模拟面试、每日一问 | 「继续完善我的简历」 |
| 求职冲刺期 | 首页、模拟面试、简历、成长任务、AI对话、每日一问 | 「来一次全真模拟面试」 |

> 排序只改顺序、不隐藏功能，避免用户"找不到入口"的恐慌感。

---

## 3. 页面设计

### 3.1 页面优先级与工作量（前端侧）

| 页面 | 优先级 | 里程碑 | 前端估时 |
|---|---|---|---|
| 登录 / 注册 | P0 | M1 | 0.5 人日 |
| 测试引导 / 答题 / 结果 | P0 | M1 | 2 人日 |
| 首页（阶段化） | P0 | M1 | 1.5 人日 |
| AI 对话（含流式 + 结论卡） | P0 | M1 | 3 人日 |
| 任务列表 / 详情 / 打卡 | P0 | M1 | 2 人日 |
| 个人中心 / 画像 | P1 | M1 | 1 人日 |
| 每日一问 | P1 | M1 | 1 人日 |
| 我的简历（问答式生成） | P0 | M2 | 2 人日 |
| 面试选择 / 准备 / 进行 / 复盘 | P0 | M2 | 4 人日 |
| 成长报告 | P1 | M3 | 1.5 人日 |
| Layout / 路由 / 主题 / API 层 | — | M1 | 2 人日 |

M1 前端合计约 **12 人日**（含框架搭建），与后端 M1 基本并行。

### 3.2 关键页面线框

**① 首页（职业探索期示例）**

```text
┌──────────────────────────────────────────────────────┐
│ 阶段徽章：职业探索期  ●○○        🔔  头像 ▾           │
├──────────────────────────────────────────────────────┤
│ ① 今日一问（轻，一句话）                              │
│    "如果可以选，你更想做哪种工作？"      [随手答一句]  │
├──────────────────────────────────────────────────────┤
│ ② AI 发现（主动挖掘的主战场）                         │
│    我注意到你可能卡在这两点：                         │
│    ┌ 缺项目经验 ┐   ┌ 表达逻辑偏弱 ┐                  │
│    │ 去做个小项目│   │ 每天复述1分钟│  [查看全部]     │
├──────────────────────────────────────────────────────┤
│ ③ 进行中的任务（最多 2 条 + 进度条）                  │
│    ▓▓▓░░ 做一个入门级小项目    2/4 步   [继续]        │
├──────────────────────────────────────────────────────┤
│ ④ 我的画像速览（雷达图 + 3 个标签）      [完善画像]   │
├──────────────────────────────────────────────────────┤
│ ⑤ 下一步建议（唯一大按钮，整屏最显眼）                │
│        [ 和 AI 聊聊我的方向 → ]                       │
└──────────────────────────────────────────────────────┘
```

设计要点：模块 ①③④ 允许为空并收缩；模块 ⑤ **永远存在**，其文案由后端 `next_action` 字段下发（见 5.4），前端不做推荐逻辑。

**② AI 对话页**

```text
┌──────────────────────────────────────────────────────┐
│ ← 职业指导对话            主题：探索方向      ⋯        │
├──────────────────────────────────────────────────────┤
│  [AI] ╭────────────────────────────╮                 │
│       │ 先别急着定方向……            │                 │
│       ╰────────────────────────────╯                 │
│                    ╭──────────────╮ [我]             │
│                    │ 我也不知道…   │                  │
│                    ╰──────────────╯                  │
│  [AI] 说到你上次提到的社团经历 ▌  ← 流式打字机        │
├──────────────────────────────────────────────────────┤
│ 追问进度 ●●○（同方向 2/3 轮）      [生成结论卡片]     │
├──────────────────────────────────────────────────────┤
│ [ 说点什么…                        ] [发送]  [停止]   │
└──────────────────────────────────────────────────────┘
```

- 流式中：发送按钮变「停止」（AbortController），禁止重复发送。
- AI 气泡渲染 Markdown，但不允许 HTML 注入。
- 追问计数器来自后端响应字段 `followup_round`（前端不自己数，避免与后端 7.7 的 service 层计数不一致）。
- 结论卡片：对话 ≥5 轮由后端建议 `conclusion_ready=true` 时浮出，样式为可折叠卡片（我听到的 / 你的痛点 / [生成任务]）。

**③ 任务详情与打卡**

```text
┌──────────────────────────────────────────────────────┐
│ ← 成长任务                                            │
│ 做一个入门级小项目           难度：中  预计 3 天      │
│ 关联痛点：缺项目经验                                  │
│ 价值：面试官最想看到的就是"你真的做过东西"            │
├──────────────────────────────────────────────────────┤
│ ① ✓ 选一个能一天做完的小题目                          │
│ ② ● 写出最简版本（当前）                              │
│ ③ ○ 发布到 GitHub 并写 README                         │
├──────────────────────────────────────────────────────┤
│ 第②步：行动指引                                       │
│  · 不要纠结技术选型，能跑起来就行                     │
│  · 资源：[示例项目清单] [GitHub 入门]                 │
│                                              [打卡]   │
├──────────────────────────────────────────────────────┤
│ 打卡弹窗：这一步花了多久？卡在哪？  [文字反馈] → 提交  │
│ 底部弱化入口：放弃任务（二次确认 + 原因选择）         │
└──────────────────────────────────────────────────────┘
```

**④ 测试答题（纯选择题，一次一屏）**

```text
┌──────────────────────────────────────────────────────┐
│ 第 12 / 40 题          ▓▓▓▓▓░░░░░░░░  30%             │
├──────────────────────────────────────────────────────┤
│  你目前有明确的职业方向吗？                            │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ A. 很清楚，已经锁定具体岗位                     │  │
│  ├────────────────────────────────────────────────┤  │
│  │ B. 有个大概方向，还在验证                       │  │
│  ├────────────────────────────────────────────────┤  │
│  │ C. 完全不知道，挺迷茫的                         │  │
│  └────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│ [上一题]                                  [跳过这题]  │
│ 小字：答不上来没关系，跳过也不会扣分                   │
└──────────────────────────────────────────────────────┘
```

- 选中后 300ms 自动进入下一题（降低操作成本），可回退修改。
- 前端本地保存答题进度（`sessionStorage`），刷新不丢。
- **跳题行为上报**（`skip` 事件），是无感采集信号之一。

**⑤ 简历优化报告**

```text
┌──────────────────────────────────────────────────────┐
│ 这份简历上次保存于 3 天前。   [ 编辑 ] [ 打印 / 导出 ] │
├──────────────────────────────────────────────────────┤
│                                                      │
│   我的简历                                            │
│   大三 · 计算机科学与技术 · 某某大学                  │
│   138****0000                                        │
│                                                      │
│   求职意向                                            │
│   ──────────────────────────────────────────────     │
│   产品经理  ·  期望城市：上海                          │
│                                                      │
│   教育背景                                            │
│   ──────────────────────────────────────────────     │
│   某某大学 · 计算机科学与技术        2023.09 - 2027.06 │
│                                                      │
│   技能                                                │
│   ──────────────────────────────────────────────     │
│   Python、SQL、Figma                                  │
│                                                      │
│   项目经历                                            │
│   ──────────────────────────────────────────────     │
│   校园二手交易小程序 · 前端        2025.03 - 2025.06   │
│     情境：同学之间转卖闲置只能靠群消息，很乱。         │
│     行动：用 Vue 写了发布与检索两个页面。             │
│                                                      │
│   自我评价                                            │
│   ──────────────────────────────────────────────     │
│   自我评价还没写，先空着。                            │
└──────────────────────────────────────────────────────┘
```

单栏、白底卡片：抬头（姓名 + 年级/专业/学校 + 联系方式）→ 求职意向 → 教育背景 → 技能 → 项目经历 → 校园与实践经历 → 自我评价，每节标题下一条细线；经历里的四段用中文小标题**情境 / 任务 / 行动 / 结果**（绝不出现英文字段名）。**空的字段不显示**，整节都空时折叠成一行「这一节还没填，先空着。」。整页只有两个动作：**编辑**（回到填写态）与**打印 / 导出**（`window.print()` + `styles/print.css`），顶栏同时显示上次保存时间。

**空状态统一规范**：不允许出现纯"暂无数据"。每个列表空态 = 一句人话 + 一个可点按钮（例：「还没有简历，我把要问的一项一项问出来 →」）。

---

## 4. 状态管理设计

### 4.1 store 划分

手册 8.2 只列了 4 个 store，实际按模块拆到 5 个（新增 interview），并统一约定命名。

| store | 关键 state | 关键 actions | 持久化 |
|---|---|---|---|
| `authStore` | `token`、`user`、`bootstrapped` | `login/register/logout/fetchMe` | 仅 `token` → localStorage |
| `profileStore` | `profile`、`tags[]`、`stage`、`version` | `fetchProfile`、`bumpVersion` | 不持久化 |
| `chatStore` | `conversations[]`、`activeId`、`messages[]`、`streamState`、`followupRound` | `send`、`stop`、`loadMessages` | 不持久化 |
| `taskStore` | `tasks[]`、`activeTask`、`steps` | `fetchTasks`、`completeStep`、`abandon` | 不持久化 |
| `interviewStore` | `session`、`questions[]`、`answers[]`、`review` | `start`、`answer`、`finish` | 不持久化 |

> **没有 `resumeStore`**：简历只有 `/resume` 一个页面、一份数据，状态就放在页面组件内（`store/resumeStore.ts` 已随老链路删除，见《勘误与决策记录》9.17）。

### 4.2 跨模块刷新：版本号失效策略

画像更新（对话、打卡、简历、面试都可能触发，手册 7.8）会导致**首页、任务列表、画像页同时过期**。为避免"用户打卡后首页还是旧数据"：

```ts
// profileStore
bumpVersion() { set(s => ({ version: s.version + 1 })) }

// 任何写操作成功后（打卡/对话结束/保存简历/面试结束）
profileStore.bumpVersion();

// 首页/画像页 useEffect(() => { fetchProfile() }, [version])
```

约定：**只有 `profileStore.version` 是全局失效信号**，其它 store 各自管自己的数据。

### 4.3 流式对话状态机

```
idle → connecting → streaming → done
                  ↘ error → (自动重试1次) → template_fallback
```

- `streamState` 驱动 UI：`streaming` 时显示"停止"、禁用输入、打字机光标。
- 收到 `error`：不清空已收到内容，在气泡尾部显示"（回答中断，点击重试）"。
- 每条用户消息带前端生成的 `client_msg_id`（uuid），重试时复用，供后端幂等去重。

---

## 5. API 层设计

### 5.1 统一响应解包（已决策）

后端所有 JSON 响应都是 `{ code, message, data }` 信封（手册 6.5/10.1 优先于 6.2 的裸示例）。**HTTP 状态码与业务码并存**：

| 情况 | HTTP | body | 前端行为 |
|---|---|---|---|
| 成功 | 200 | `code: 0` | 返回 `data` |
| 参数错误 | **400** | `code: 1001`（+ `data.errors`） | 表单错误提示，reject `ApiError` |
| 未登录 / token 失效 | **401** | `code: 1002` | 登出（只清 token）+ 交由守卫 `<Navigate>` 跳 `/login` |
| 权限不足 | **403** | `code: 1003` | toast |
| 资源不存在（含"不属于你"） | **404** | `code: 2001` | toast |
| **AI 调用失败** | **200** | `code: 3001` | toast + 「重试」action（**唯一刻意保持 200 的业务码**） |
| 未捕获异常 | **500** | `code: 5000` | toast「服务器开小差了」 |

> 规则由后端 `CODE_TO_HTTP_STATUS` 单点推导：**业务码相同 → HTTP 状态一定相同**。因此前端不能假设"HTTP 200 就是成功"，也不能假设"非 200 就没有信封"。

所以拦截器必须**两条路径都解信封**——成功路径可能是业务失败，错误路径也带信封：

```ts
// src/api/client.ts
const unwrap = (body: any) => {
  const { code, message, data } = body ?? {};
  if (code === 0) return data;
  // 1002：只清 token，**不做 location.href 整页硬跳**
  // 跳转交给路由守卫（RequireAuth 渲染 <Navigate to="/login" replace>），
  // 这样不重载 bundle、不丢 SPA 状态。实测：spaAlive 探针从未重置、navType === 'navigate'。
  if (code === 1002) useAuthStore.getState().logout();
  throw new ApiError(code, ERROR_TEXT[code] ?? message ?? '请求失败');
};

client.interceptors.response.use(
  (res) => unwrap(res.data),                       // HTTP 2xx：可能是成功，也可能是 3001 这类业务失败
  (err) => {
    const body = err.response?.data;
    if (body && typeof body.code === 'number') {   // 400/401/403/404/500 同样带信封
      try { unwrap(body); } catch (e) { toast((e as ApiError).message); return Promise.reject(e); }
    }
    toast('网络不太好，稍后再试');
    return Promise.reject(err);
  },
);
```

错误码文案（手册 10.3）：`1001 参数有误`、`1002 登录已过期，请重新登录`、`1003 没有权限`、`2001 内容不存在`、`3001 AI 暂时忙不过来，请稍后再试`、`5000 服务器开小差了`。

> 决策依据与后端改动记录在 `docs/开发手册-勘误与决策记录.md` 第 1.1、2.1 节。SSE 接口本身不走 JSON 信封（流式无法包装），但其**事件体内**自带信封，见 5.2。

### 5.2 流式对话方案（修正手册 8.4，已决策）

手册 8.4 用 `EventSource`，但它**不能设置 `Authorization` header**、只能 GET（无法带消息体），与 10.1 的 Bearer 鉴权直接冲突。已与后端定下契约：

```
POST /api/v1/chat/conversations/{id}/stream
Body: { content, client_msg_id }
Response: text/event-stream
```

是**具名事件**（`event:` 行 + `data:` 行），每个 `data` 都是一层信封：

```
event: start
data: {"code":0,"message":"success","data":{"type":"start","conversation_id":"...","followup_round":2}}

event: delta
data: {"code":0,"message":"success","data":{"type":"delta","content":"增量文本","followup_round":2}}

event: tag
data: {"code":0,"message":"success","data":{"type":"tag","tags":[...]}}

event: done
data: {"code":0,"message":"success","data":{"type":"done","message_id":"...","conversation_id":"...","followup_round":3,"conclusion_ready":false}}

event: pending
data: {"code":0,"message":"该消息已提交过，未重复生成","data":{"type":"pending","replay_message_id":"..."}}

event: error
data: {"code":3001,"message":"AI调用失败","data":null}

event: end
data: [DONE]
```

前端实现：

```ts
const ctrl = new AbortController();
const res = await fetch(`/api/v1/chat/conversations/${id}/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ content, client_msg_id }),
  signal: ctrl.signal,
});
const reader = res.body!.getReader();
const decoder = new TextDecoder('utf-8');
let buf = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const blocks = buf.split('\n\n');
  buf = blocks.pop()!;                      // 最后一块可能被截断，留到下一轮
  for (const block of blocks) handleEvent(parseSSEBlock(block));
}
```

- `parseSSEBlock` 取 `event:` 与 `data:` 两行；`data === '[DONE]'` 直接结束，**不要** `JSON.parse` 它。
- 先解信封：`code !== 0` 走错误分支，**不要静默丢弃**。
- 事件分派：`start` 取 `conversation_id` 与初始 `followup_round`；`delta` 追加文本；`tag` 触发 `profileStore.bumpVersion()`；`done` 取 `message_id` / `followup_round` / `conclusion_ready`（为 true 时浮出结论卡片入口）。
- `pending` 是**幂等命中**：带 `replay_message_id` = 上一轮已完成（直接拉消息列表），不带 = 上一轮仍在生成（提示"正在生成中，请稍候"）。
- **`followup_round` 可能为 `null`**（后端尚未识别出挖掘方向时）：进度环必须能降级隐藏，绝不能把 `null` 画成 `0`。
- `stop()` 即 `ctrl.abort()`；断流保留已收到文本，气泡尾部显示"（回答中断，点击重试）"，重试**复用同一个 `client_msg_id`**（后端据此不重复调 AI）。

### 5.3 类型来源

用 `openapi-typescript`（**devDependency，不影响运行时**）从 `http://localhost:8000/openapi.json` 生成 `src/types/api.d.ts`，避免手写类型与 FastAPI Schema 漂移；业务侧只对生成类型做 `Omit/Pick` 包装。

**不引入 TanStack Query**：数据缓存交给 4.2 的 `version` 失效策略 + 各 store 自带的 `fetched` 标记。项目只有 6 个数据模块，Query 的收益小于它带来的心智负担。

### 5.4 需要后端补齐的字段/接口（前端已设计，后端手册未写）

| 需求 | 用途 |
|---|---|
| `GET /profile` 返回 `next_action: { text, route }` | 首页"下一步建议"唯一 CTA，前端不做推荐逻辑 |
| `GET /home/summary` 聚合（今日一问、AI发现、进行中任务、画像速览） | 首页一次请求渲染，避免 4 个串行请求 |
| 对话流式事件含 `followup_round`、`conclusion_ready` | 追问进度环、结论卡片触发 |
| `GET /daily/today` 含 `answered: boolean` | 每日一问的已答/未答态 |
| 简历不再有文件下载接口 | 老链路的 `/resume/:id/file` 已随链路删除；现行简历是问答式生成，数据存结构化 JSON，不落磁盘文件 |
| 列表接口统一 `page/page_size/total` | 任务/对话列表分页（**简历已无列表接口**：只有一份，`GET /resume/mine` 返回单对象） |
| `POST /events` 埋点上报（跳题、放弃任务、忽略建议） | 无感采集信号，前端只上报事件名 |

---

## 6. 设计系统（shadcn/ui）

> **⚠️ 2026-10-15：本章配色已整体作废。** 唯一真源是 `docs/设计系统-页面规范.md` 第二节。现行配色：近白画布 `#fbf9f6` + 主墨 `#091426` + 浅桃 `#ffdbca`；**全站删除琥珀色**。下文（6.1–6.3）的色值保留仅作历史，**不要照它写代码**。

### 6.1（作废）配色原则：米黄打底，蓝只用在"动作"上

比色值更重要的是四条纪律，review 时逐条对：

1. **浅米黄打底**：页面底色用浅米黄（纸感），不用纯白也不用冷灰；卡片比底色更接近白，靠**明度分层**而不是靠边框堆叠。
2. **蓝是动作色，不是装饰色**：低饱和蓝只出现在"可以点的东西"上——主按钮、选中态、链接、进度；一屏**只允许一个**实心主按钮。
3. **暖色负责氛围，冷色负责动作**：AI 主动发现、奖章、阶段徽章继续走暖色（赭黄系），让"AI 的温度"与"系统的动作"在视觉上分开。
4. **不用渐变、不用发光、不用彩色阴影**：阴影统一暖褐低透明；状态靠"文字 + 图标 + 弱色块"表达，不靠大红大绿。

彩色面积占比目标 **≤10%**（徽章、进度条、图标、浅底卡片），大面积永远是米黄/暖白。

> 冷暖分工是这个主题的关键：米黄（暖）占地最大，蓝（冷）面积最小、但只指向"下一步该做什么"。这样既克制，又不会因为满屏暖色而发糊。

### 6.2（作废）色板

> ⚠️ 旧色板整体作废（含其中的琥珀 `#B2802F`）。现行色板见 `docs/设计系统-页面规范.md` 第二节，摘要如下：

| 用途 | 值 |
|---|---|
| 页面画布 | `#fbf9f6` |
| 卡片 | `#ffffff` |
| 卡内浅底 | `#f5f3f0` |
| 主墨（标题/正文/主按钮/强调/进度条） | `#091426` |
| 浅桃（小面积强调底） | `#ffdbca` |
| 次要文字 | `#45474c` |
| caption | `#6b7280` |

**全站删除琥珀色**：不再有「琥珀 = AI / 强调」这个角色，强调 / 进度条 / AI 提示竖条一律用主墨 `#091426`。阶段色、图表配色、暗色模式等 token 以 `frontend/src/index.css` 为准（旧值不作依据）。

### 6.3（作废）shadcn/ui 主题变量

> ⚠️ 下面这段 CSS 是旧方案，且文件位置也不对——项目没有 `src/styles/tokens.css`，全部 token 都在 `frontend/src/index.css`。色值一律以 `docs/设计系统-页面规范.md` 第二节为准。

```css
@layer base {
  :root {
    --background: 43 44% 96%;
    --foreground: 30 12% 14%;
    --card: 40 60% 99%;
    --card-foreground: 30 12% 14%;
    --popover: 40 60% 99%;
    --popover-foreground: 30 12% 14%;
    --primary: 213 30% 44%;
    --primary-foreground: 43 44% 97%;
    --secondary: 42 28% 92%;
    --secondary-foreground: 33 8% 40%;
    --muted: 42 28% 92%;
    --muted-foreground: 33 8% 40%;
    --accent: 38 45% 88%;          /* 赭黄浅底，仅用于 AI 主动类卡片 */
    --accent-foreground: 32 45% 32%;
    --destructive: 8 52% 45%;
    --destructive-foreground: 43 44% 97%;
    --border: 40 18% 86%;
    --input: 40 18% 86%;
    --ring: 213 30% 44%;
    --radius: 0.75rem;

    /* 业务扩展变量（阶段 / AI / 语义） */
    --stage-explore: 38 50% 47%;
    --stage-prepare: 213 30% 44%;
    --stage-sprint: 8 52% 45%;
    --ai-accent: 38 50% 47%;
    --success: 95 22% 38%;
    --warning: 35 55% 45%;
    --info: 213 25% 50%;
  }
}
```

用色纪律：

- 一屏最多 **1 个** `bg-primary` 实心按钮，其余用 `variant="outline"` / `"ghost"`。
- 主色（蓝）**不得**用于大面积色块、插图、页头背景；它只表示"可点击 / 已选中"。
- 阶段色只用于徽章与进度，**不允许**用在按钮上。
- AI 相关内容不再用暖色强调：统一用 `ai-inset`（左侧 3px 主墨竖条）+ `bg-surface-container-low`。
- 禁用 Tailwind 默认色类（`text-blue-500`、`bg-red-500`），只允许语义变量（`text-destructive`、`bg-accent`）。

### 6.4 字体与间距

- 字体：系统默认 → `-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`；数字/代码 `ui-monospace, "JetBrains Mono", Consolas, monospace`。
- 字号：12（辅助）/ 14（正文默认）/ 16（小标题/AI 气泡）/ 20（页面标题）/ 28（结果页大数字）。
- 行高：正文 1.6，AI 气泡 1.75（长文可读性）。
- 间距：4pt 栅格，常用 4 / 8 / 12 / 16 / 24 / 32。
- 圆角：`--radius: 12px`（卡片、弹窗）；标签/徽章用 `999px`；输入与按钮 8px。
- 阴影：暖灰低透明——卡片 `0 1px 2px rgba(28,25,23,.05)`；浮层 `0 8px 24px rgba(28,25,23,.10)`。

### 6.5 组件映射（shadcn/ui）

安装方式：`components/ui/` 下是**源码**（不是 npm 包），按需 `add` 而不是整包引入。业务组件全部基于它二次封装，禁止在页面里散写 Radix 原语。

| 场景 | shadcn 组件 | 定制点 |
|---|---|---|
| 按钮 / 主 CTA | `Button` | 增加 `variant="warm"`（主色）与 `size="lg"` 给首页唯一 CTA |
| 卡片（任务、画像、AI 发现） | `Card` | AI 主动卡片用 `ai-inset`（左侧 3px 主墨竖条）+ `bg-surface-container-low` |
| 消息气泡 | 自建 `ChatBubble` | AI 侧白底 + 细边框（`bg-card` + `border-outline-variant`）；用户侧深墨实心（`bg-primary text-on-primary`） |
| 阶段徽章 / 标签 | `Badge` | 自建 `StageBadge`、`TagChip`，颜色取 `--stage-*`，`variant="outline"` |
| 输入 / 发送框 | `Input` `Textarea` | 对话输入用 `Textarea` + `autosize`；回车发送需处理输入法组合态 |
| 表单校验 | `Form` + react-hook-form + zod | 测试表、简历问答表单、打卡反馈 |
| 弹窗（打卡、结论卡、二次确认） | `Dialog` `AlertDialog` | 放弃任务用 `AlertDialog`（危险操作走 `destructive`） |
| 抽屉 | `Sheet` | 组件源码已在 `components/ui/` 里，但**当前没有页面用到**（移动端筛选与简历预览都没做，简历页的展示态是页面内直接渲染，不是抽屉） |
| 任务步骤条 | `Progress` + 自建 `StepList` | shadcn 无 Steps，三态自行实现 |
| 列表 | `Table` | 简单列表即可，不上 `@tanstack/react-table`（**简历没有表格视图**：展示态是一份简历，填写态是表单） |
| 空态 | 自建 `EmptyState` | 强制 `title + action` 两个 props，杜绝"暂无数据" |
| 骨架 / 等待 | `Skeleton` | 自建 `AIThinking`：骨架 + 阶段文案（"正在读你的经历…"），不用转圈 |
| 轻提示 | `Sonner` (`sonner`) | 4s 自动消失，AI 失败类带"重试"action |
| 头像 / 折叠 / 提示 | `Avatar` `Collapsible` `Tooltip` | 顶部用户区、结论卡片折叠、标签解释 |
| 滚动区 | `ScrollArea` | 对话消息区、侧栏 |
| 图表 | 见第 11 章问题 3 | 雷达图、成长曲线 |

> 手册 4.2 里的组件清单（`ChatBubble`、`ProfileCard`、`TaskCard`…）全部保留，只是底座从 AntD 换成 shadcn/ui，`components/ui/` 是新增目录。

---

## 7. 关键技术风险与对策（前端视角）

| 风险 | 影响 | 对策 |
|---|---|---|
| `EventSource` 无法带 token | 流式对话做不出来 | 改 `fetch + ReadableStream`（5.2），需后端 POST 流式 |
| 长对话 DOM 过多 | 滚动卡顿 | 超过 100 条启用虚拟列表或"加载更早消息"分页 |
| 流式断流/重复消息 | 用户看到重复回答 | `client_msg_id` 幂等 + 断流保留已收内容 |
| 中文输入法回车误发送 | 输入被打断 | 监听 `compositionstart/end`，组合期间回车不发送 |
| 首页 4 个模块串行请求 | 白屏慢 | 后端聚合接口（5.4）；过渡期用 `Promise.allSettled` + 分块骨架 |
| 报告/简历打印 | 侧栏、按钮被打印出来 | 独立 `@media print` 样式，打印时隐藏导航 |
| AI 返回 Markdown 含超长代码 | 布局撑破 | `pre` 横向滚动 + `break-word`，不换行塌陷 |

---

## 8. 前端目录结构（在手册 4.2 上扩展）

```text
frontend/
├── src/
│   ├── main.tsx                 # Router / 全局错误边界 / Toaster(sonner)
│   ├── App.tsx
│   ├── router/
│   │   ├── index.tsx            # 路由表
│   │   └── guards.tsx           # RequireAuth / RequireProfile
│   ├── layouts/
│   │   ├── AppLayout.tsx        # 侧栏 + 顶栏（桌面）/ 底部 Tab（移动）
│   │   └── BlankLayout.tsx      # 登录、面试进行中（全屏沉浸）
│   ├── pages/                   # 同手册 4.2，新增 error/404.tsx
│   ├── components/              # 业务组件，见 6.5 清单
│   │   └── ui/                  # shadcn 生成的基础组件（源码，按需 add）
│   ├── lib/
│   │   └── utils.ts             # cn()（clsx + tailwind-merge），shadcn 约定
│   ├── store/                   # 见 4.1
│   ├── api/                     # client.ts + 各模块接口
│   ├── types/                   # 由 openapi 生成 + 手写扩展
│   ├── hooks/                   # useSSE / useAuth / useResponsive / useStage
│   ├── constants/               # 阶段枚举、错误码文案、路由常量
│   ├── styles/                  # tokens.css（主题变量）、print.css
│   └── utils/                   # format / storage / markdown 清洗
├── components.json              # shadcn 配置（别名、样式、Tailwind 路径）
├── .env.development             # VITE_API_BASE=/api/v1（dev 走 Vite 代理）
└── (配置文件同手册 4.2)
```

新增约定的原因：`layouts/` 与 `router/guards.tsx` 是手册 4.2 缺失但必然要写的东西；`constants/` 用于收敛阶段枚举与错误码文案；`components/ui/` 与 `lib/utils.ts` 是 shadcn 的固定约定。

---

## 9. 工程与质量约定

- **脚手架**：`pnpm create vite frontend --template react-ts` → `pnpm dlx shadcn@latest init` → 逐个 `pnpm dlx shadcn@latest add button card dialog form input textarea badge progress skeleton sonner table tabs avatar tooltip scroll-area sheet collapsible alert-dialog`。**前提是包管理器可用**（见第 11 章问题 4）。
- **主题落地**：`src/styles/tokens.css` 放 6.3 的变量，`tailwind.config` / `@theme` 里把 `--primary` 等映射为 `bg-primary`、`text-muted-foreground` 这类语义类；**页面里禁止写裸色值**。
- **代理**：dev 用 `vite.config.ts` 的 `server.proxy['/api'] → http://localhost:8000`，避免跨域与 CORS 配置（手册 3.10 的前端跨域问题从根上规避）。
- **环境变量**：`VITE_API_BASE`、`VITE_APP_ENV`；禁止把 DeepSeek Key 等任何密钥放前端。
- **代码规范**：ESLint + Prettier（`eslint-config-airbnb-typescript` 或 `@antfu/eslint-config`，二选一，你定）；加一条自定义规则：禁止出现 Tailwind 默认色板类名，只允许语义色。
- **单测范围**（Vitest + RTL，手册 15.2）：只测 hooks 与纯函数（SSE 解析、错误码映射、阶段文案），页面不做快照测试，避免维护成本。
- **错误边界**：顶层 ErrorBoundary + 路由级 ErrorBoundary；AI 相关异常必须降级为可点击提示，不能白屏。
- **埋点**：统一 `track(event, payload)`，事件名固定为 `test_skip / task_abandon / advice_ignore / daily_answer / chat_round`，供后端做画像回流参考。

---

## 10. 里程碑对齐

| 里程碑 | 前端交付物 |
|---|---|
| M1 | Layout + 路由守卫 + 主题 + API 层；登录注册、测试三页、首页、对话（流式+结论卡）、任务列表/详情、个人中心、每日一问 |
| M2 | 我的简历单页（问答式生成：填写态 ↔ 展示态）、面试四页（选择/准备/进行/复盘） |
| M3 | 成长报告、Electron 包壳（托盘/通知/每日一问弹窗）、打印样式、响应式细节打磨 |

---

## 11. 待你确认的问题

1. **流式方案**：同意把手册 8.4 的 `EventSource` 改成 `fetch + ReadableStream` + 后端 POST 流式吗？（不改就做不出带鉴权的流式对话）
2. **响应格式**：统一 `{code,message,data}` 包装（前端已按此设计），还是改成 FastAPI 原生返回 + HTTP 状态码？
3. **图表库**：跟手册用 ECharts（雷达图/成长曲线都很稳），还是换 shadcn 官方的 Chart（基于 Recharts，与设计语言更统一，但成长曲线能力弱一些）？我倾向 Recharts，除非你要复杂图表。
4. **包管理器**：当前机器只有 `node`，`npm`/`pnpm` 不在 PATH，**shadcn CLI 跑不起来**。要么你装一下 pnpm，要么我手写组件源码（shadcn 本质就是源码，可行但慢）。这条不解决，M1 无法开工。
5. **Tailwind 版本**：手册 4.2 列了 `tailwind.config.js`（v3 写法）。shadcn 现在默认 Tailwind v4（CSS-first，无配置文件）。建议直接上 v4 并同步修订手册 4.2，还是保守用 v3？
6. **响应格式以外的后端字段**：`GET /home/summary` 聚合接口与 `next_action` 字段，后端愿意加吗？不加则前端需要 4 个请求 + 自行排序，AI 主动性会打折。
7. ~~**手册同步**~~：**已解决**（2026-10-15 手册 2.1 / 8.5 与配色均已同步为现行方案）。
8. **移动端**：M1 就要手机可用，还是先做桌面、M3 再适配？
9. ~~**配色微调**~~：**已解决**——2026-10-15 定稿为近白画布 `#fbf9f6` + 主墨 `#091426` + 浅桃 `#ffdbca`，并删除琥珀色。以下为已作废的原提议：浅米黄底 `#FAF7EE` + 克制蓝 `#4E6D92`，蓝的饱和度 30%。想更"灰"可以降到 22%（更接近石板蓝），想更"精神"可以提到 38%。米黄底色也一样可以 ±3% 明度。要不要我先按当前值出原型，你看实物再调？
10. 设计稿形式：需要我出**静态 HTML 原型**（可直接打开点着看，直接复用 tokens.css）还是先只要这份文档？

---

**文档结束。确认后我再动代码，不会提前搭脚手架。**
