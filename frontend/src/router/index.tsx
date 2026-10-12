/**
 * 路由表（设计说明书 2.1 全量路由）与 2.1 首次进入漏斗守卫装配。
 *
 * 整棵树套在**一个**根路由里，根路由只做两件事：
 * 1. element: <Outlet /> —— 什么都不加（不套布局、不套守卫），下面各段的布局与守卫照旧；
 * 2. errorElement: <RouteErrorFallback /> —— **全站最后一道网**（见文件内注释）。
 */

import { Outlet, createBrowserRouter, createHashRouter } from 'react-router-dom'
import type { RouteObject } from 'react-router-dom'

import { RouteErrorFallback } from '@/components/AppErrorFallback'
import { AppLayout } from '@/layouts/AppLayout'
import { BlankLayout } from '@/layouts/BlankLayout'
import { RequireAuth, RequireProfile, RedirectIfAuthed } from '@/router/guards'

import LoginPage from '@/pages/auth/LoginPage'
import RegisterPage from '@/pages/auth/RegisterPage'

import TestIntroPage from '@/pages/test/TestIntroPage'
import TestQuestionPage from '@/pages/test/TestQuestionPage'
import TestResultPage from '@/pages/test/TestResultPage'

import HomePage from '@/pages/home/HomePage'

import ChatPage from '@/pages/chat/ChatPage'

import TaskListPage from '@/pages/task/TaskListPage'
import TaskDetailPage from '@/pages/task/TaskDetailPage'

import ProfilePage from '@/pages/profile/ProfilePage'
import DailyPage from '@/pages/daily/DailyPage'

import MyResumePage from '@/pages/resume/MyResumePage'

import InterviewSelectPage from '@/pages/interview/InterviewSelectPage'
import InterviewPreparePage from '@/pages/interview/InterviewPreparePage'
import InterviewSessionPage from '@/pages/interview/InterviewSessionPage'
import InterviewReviewPage from '@/pages/interview/InterviewReviewPage'

import GrowthReportPage from '@/pages/report/GrowthReportPage'
import NotFoundPage from '@/pages/error/NotFoundPage'

const routes: RouteObject[] = [
  {
    /*
     * ---------------------------------------------------------------
     * 全站最后一道网（唯一一处，页面里不要再各写一份）
     * ---------------------------------------------------------------
     * 页面组件在渲染时抛异常，React 会卸载整棵树 → 用户看到白屏，
     * 或者 React Router 自带的英文错误页（"Unexpected Application Error!" /
     * "Hey developer 👋"）。数据路由里子路由抛出的错误会向上冒到**最近的**
     * errorElement，所以把 errorElement 挂在最外层这一个根路由上，
     * 就同时兜住了 /resume、/chat、/task…全部页面（以及以后新加的页面）。
     *
     * 兜底页长什么样见 components/AppErrorFallback.tsx：
     * 一句中文人话 + 「重新加载」+「返回首页」，英文堆栈只进 console。
     */
    errorElement: <RouteErrorFallback />,
    element: <Outlet />,
    children: [
      /* ---------------------------- 公开：登录 / 注册 ---------------------------- */
      {
        element: <RedirectIfAuthed />,
        children: [
          {
            element: <BlankLayout />,
            children: [
              { path: '/login', element: <LoginPage /> },
              { path: '/register', element: <RegisterPage /> },
            ],
          },
        ],
      },

      /*
       * ------------------------- 公开：404 与通配 -------------------------
       * 两条硬约束必须同时满足（2026-10 收口时踩过一遍）：
       * 1. **公开**：未登录用户点到错链也要看得到这一页（本文件末的说明与
       *    NotFoundPage 顶部注释都写了"公开路由，不做守卫"）。所以它**不能**挂进
       *    下面任何 RequireAuth 段 —— 否则未登录访问会被重定向到 /login，
       *    用户看到的不是"页面不存在"而是登录页。
       * 2. **有外壳**：它要跟登录/注册共用同一个 448px 空布局（居中窄栏 + bg-canvas +
       *    底部一行系统名）。而 BlankLayout 只是布局、不带守卫，所以直接用它即可 ——
       *    不要套 RedirectIfAuthed（那是"已登录就弹回漏斗"的逻辑）。
       *
       * 历史问题：这两条原先挂在最外层 children 里，是 BlankLayout 那段的**兄弟**，
       * 于是 404 渲染在布局之外、卡片铺满 1440px 整幅宽度（/login 有外壳、/404 没有）。
       */
      {
        element: <BlankLayout />,
        children: [
          { path: '/404', element: <NotFoundPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },

      /*
       * --------- 公开外壳：测评漏斗的引导页与结果页（BlankLayout 窄栏 448px） ---------
       * 2026-10 收口（A1 改造时定位到的根因）：
       *   这两页原先和 /test/question 一起挂在下面的 RequireAuth 段里，是**裸路由** ——
       *   不在任何布局内，DOM 祖先链只有 body → 一层无类名的 div。后果实测有三条：
       *     ① 拿不到 main 的 px-margin / py，1440px 屏上内容左右各贴 200px（其它页有 32px 呼吸）；
       *     ② 没有 448px 窄栏，引导页那张确认卡铺满整幅宽度（/login 是 448px，同一类页面两副面孔）；
       *     ③ /test/result 没有 main 元素 → tools/render-check/probe.mjs 的 main p, main span…
       *        选择器扫不到任何文字，输出**空表**（空表会被误读成"零低对比"，其实只是没量到）。
       *   现在这两页只挂 BlankLayout（与 /404 同一写法：**只要外壳、不要守卫**）。
       *
       * ⚠️⚠️ 这段**故意不套任何守卫**，代价与补偿都写在这里：
       *   代价：RequireAuth 顺带做的那次 fetchProfile() 副作用没了（见 router/guards.tsx 顶部
       *   漏斗判据注释：画像请求一直是挂在守卫的 effect 上的）。少了它，profileStore.fetched 永远
       *   false、tested 永远默认 false，于是 /test/intro「已测评且非 retest → 静默回首页」失效、
       *   ?retest=1 的「重新做一次职业测评」确认卡也不出现。实测取证：
       *   regression.mjs 的 N5 五条里四条 FAIL + 第 3 条 redirect-to-home-when-tested FAIL。
       *   补偿：改由**页面自己**补这次取数（TestIntroPage / TestResultPage 各有一段
       *   「没取过就 fetchProfile()」的 effect，带 fetched/loading/failed 三态护栏，与守卫同款，
       *   不会造成请求风暴）。
       *   ⚠️ 为什么不在路由层用 RedirectIfAuthed 代劳：它除了取数还会**分流**（已登录就跳
       *   「漏斗下一站」），实测把 /test/result 直接重定向回 /（regression R05 FAIL：
       *   `/test/result -> /`），而"测完看结果"正是要停在这一页。这两个页面的去向应当由页面
       *   自己的逻辑决定（/test/intro 的 effect 会把 tested&&!retest 送回 /），路由层只提供外壳。
       *
       * ⚠️ 但 /test/question 不能挂进来：它是整屏固定布局（h-[calc(100svh-var(--spacing-shell-total))]
       *   + pt-shell，几何经 tools/render-check/a1-question-geometry.mjs 校准），
       *   进 BlankLayout 的 items-center 居中 + py-10 会把那一屏几何整体挤坏，
       *   所以它留在下面 RequireAuth 段内（它也需要守卫做取数 + 未登录跳登录）。
       */
      {
        element: <BlankLayout />,
        children: [
          { path: '/test/intro', element: <TestIntroPage /> },
          { path: '/test/result', element: <TestResultPage /> },
        ],
      },

      /* ------------------- 登录后：答题页（整屏固定布局，不进 BlankLayout） ------------------- */
      /* 注意：/test/* 不套 RequireProfile，否则「无画像 → 强制 /test/intro」会自我循环 */
      {
        element: <RequireAuth />,
        children: [{ path: '/test/question', element: <TestQuestionPage /> }],
      },

      /* ----------------- 登录后 + 已生成画像：主应用（AppLayout + 守卫） ----------------- */
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireProfile />,
            children: [
              {
                element: <AppLayout />,
                children: [
                  { path: '/', element: <HomePage /> },
                  { path: '/chat', element: <ChatPage /> },
                  { path: '/task', element: <TaskListPage /> },
                  { path: '/task/:id', element: <TaskDetailPage /> },
                  { path: '/profile', element: <ProfilePage /> },
                  { path: '/daily', element: <DailyPage /> },

                  /*
                    /resume 是「我的简历」单份页（问一句填一句 → 润色 → 展示成一份简历）。
                    老的列表 / 新建 / 编辑 / ATS 优化报告四个页面与它们的路由已随老链路整体删除
                    （2026-11，与后端同批），这里只留新页面。
                    ⚠️ 库里可能还留着老页面写下的**旧结构** parsed_data：新页面读取时
                    统一过 pages/resume/resumeShape.ts 的收敛层，不会再整页崩。
                  */
                  { path: '/resume', element: <MyResumePage /> },

                  { path: '/interview', element: <InterviewSelectPage /> },
                  { path: '/interview/prepare', element: <InterviewPreparePage /> },
                  { path: '/interview/review/:id', element: <InterviewReviewPage /> },

                  { path: '/report', element: <GrowthReportPage /> },
                ],
              },
            ],
          },
        ],
      },

      /* ------------- 面试进行中：全屏沉浸（BlankLayout，无侧栏，/interview/session） ------------- */
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequireProfile />,
            children: [
              {
                element: <BlankLayout />,
                children: [{ path: '/interview/session', element: <InterviewSessionPage /> }],
              },
            ],
          },
        ],
      },

      /* ---------------------------- 兜底：404 与通配 ----------------------------
         这两条路由不在这里 —— 它们挂在上面那段**不带守卫的** BlankLayout 里
         （见那里的注释：既要有 448px 外壳，又要对未登录用户公开）。 */
    ],
  },
]

/**
 * 路由实现按**运行环境**切换（只差这一行，其余代码两边完全相同）：
 *
 * - **Web / 开发服务器**：createBrowserRouter —— 真实路径 /chat、/resume，
 *   与设计说明书、手册以及 tools/render-check 的 URL 断言保持一致；
 * - **Electron 桌面端**：file:// 加载 index.html 时**必须**用 createHashRouter。
 *   因为 file:// 下 window.location.pathname 是**文件路径**（/D:/.../index.html），
 *   BrowserRouter 一条路由都匹配不上 → 打开就是 404 页、刷新白屏。
 *   换成 hash 后地址形如 index.html#/chat，pathname 不参与匹配。
 */
export const router =
  window.location.protocol === 'file:' ? createHashRouter(routes) : createBrowserRouter(routes)
