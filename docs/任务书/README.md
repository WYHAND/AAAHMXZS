# 页面统一改版 · 任务书

把除 AI 对话页（`/chat`）以外的页面，统一成首页的风格。

## 怎么用

1. 打开任意一个 `T??-*.md`，**整段复制**（里面已经包含通用前言），粘贴给一个模型即可。
2. 13 个任务的文件**互不重叠**，可以同时开多个模型并行做。
3. 每个模型只改自己负责的文件，最后会按同一格式汇报：改动清单、验收结果、截图、需要协调的共享改动。
4. 类型检查（`tsc -b`）由你统一跑一次，不要让模型各自跑。

前提：前端 dev server 在 `http://localhost:5173` 运行，后端在 `8000` 运行（当前已经在跑）。

## 任务总表

| 编号 | 页面 | 路由 | 负责文件 | 体量 |
|---|---|---|---|---|
| T01 | 测评引导页 | `/test/intro` | `pages/test/TestIntroPage.tsx` | 小 |
| T02 | 测评答题页 | `/test/question` | `pages/test/TestQuestionPage.tsx` | 中（裸路由，高度要算外壳） |
| T03 | 测评结果页 | `/test/result` | `pages/test/TestResultPage.tsx` | 小 |
| T04 | 成长任务列表 | `/task` | `pages/task/TaskListPage.tsx` | 大 |
| T05 | 任务详情 | `/task/:id` | `pages/task/TaskDetailPage.tsx` | 中 |
| T06 | 个人画像 | `/profile` | `pages/profile/ProfilePage.tsx` | 小（微调） |
| T07 | 每日一问 | `/daily` | `pages/daily/DailyPage.tsx` | 中 |
| T08 | 我的简历主页 | `/resume` | `pages/resume/MyResumePage.tsx` | **很大（1251 行，分段做）** |
| T09 | 简历编辑面板 | （被 T08 调用） | `pages/resume/ResumeSheet.tsx` | 中（props 不能变） |
| T10 | 模拟面试·选择与准备 | `/interview`、`/interview/prepare` | `InterviewSelectPage.tsx`、`InterviewPreparePage.tsx` | 中 |
| T11 | 模拟面试·答题与复盘 | `/interview/session`、`/interview/review/:id` | `InterviewSessionPage.tsx`、`InterviewReviewPage.tsx` | 中（裸路由） |
| T12 | 成长报告 | `/report` | `pages/report/GrowthReportPage.tsx` | 中 |
| T13 | 登录、注册、404 | `/login`、`/register`、`/404` | `auth/LoginPage.tsx`、`auth/RegisterPage.tsx`、`error/NotFoundPage.tsx` | 小 |

## 注意事项

- **不要重叠文件**：每个任务只碰自己那一行的文件。T08 和 T09 的分工就是为了避免冲突（T08 调用 T09 的组件，但不改它的 props）。
- **共享构件不改**：`Panel`、`PageHeader`、`StatGroup`、`EmptyState` 等由人统一维护。模型如果发现需要改它们，会在汇报里写「需要协调的共享改动」，你再决定。
- **验收用的截图**会写到 `audit/` 下，任务编号作为文件名前缀。
- 参考规范：`docs/设计系统-页面规范.md`（所有任务都以它为准）。
