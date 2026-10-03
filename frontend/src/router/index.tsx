/**
 * 路由表（设计说明书 2.1 全量路由）与 2.1 首次进入漏斗守卫装配。
 *
 * 整棵树套在**一个**根路由里，根路由只做两件事：
 * 1. `element: <Outlet />` —— 什么都不加（不套布局、不套守卫），下面各段的布局与守卫照旧；
 * 2. `errorElement: <RouteErrorFallback />` —— **全站最后一道网**（见文件内注释）。
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

      /* --------------------------- 登录后：测试漏斗三页 --------------------------- */
      /* 注意：/test/* 不套 RequireProfile，否则「无画像 → 强制 /test/intro」会自我循环 */
      {
        element: <RequireAuth />,
        children: [
          { path: '/test/intro', element: <TestIntroPage /> },
          { path: '/test/question', element: <TestQuestionPage /> },
          { path: '/test/result', element: <TestResultPage /> },
        ],
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

      /* ---------------------------- 兜底：404 与通配 ---------------------------- */
      { path: '/404', element: <NotFoundPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

/**
 * 路由实现按**运行环境**切换（只差这一行，其余代码两边完全相同）：
 *
 * - **Web / 开发服务器**：`createBrowserRouter` —— 真实路径 `/chat`、`/resume`，
 *   与设计说明书、手册以及 `tools/render-check` 的 URL 断言保持一致；
 * - **Electron 桌面端**：`file://` 加载 `index.html` 时**必须**用 `createHashRouter`。
 *   因为 file:// 下 `window.location.pathname` 是**文件路径**（`/D:/.../index.html`），
 *   BrowserRouter 一条路由都匹配不上 → 打开就是 404 页、刷新白屏。
 *   换成 hash 后地址形如 `index.html#/chat`，pathname 不参与匹配。
 */
export const router =
  window.location.protocol === 'file:' ? createHashRouter(routes) : createBrowserRouter(routes)
