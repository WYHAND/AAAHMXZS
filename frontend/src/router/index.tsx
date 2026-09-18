/**
 * 路由表（设计说明书 2.1 全量路由）与 2.1 首次进入漏斗守卫装配。
 */

import { createBrowserRouter } from 'react-router-dom'

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

import ResumeListPage from '@/pages/resume/ResumeListPage'
import ResumeCreatePage from '@/pages/resume/ResumeCreatePage'
import ResumeEditPage from '@/pages/resume/ResumeEditPage'
import ResumeReportPage from '@/pages/resume/ResumeReportPage'

import InterviewSelectPage from '@/pages/interview/InterviewSelectPage'
import InterviewPreparePage from '@/pages/interview/InterviewPreparePage'
import InterviewSessionPage from '@/pages/interview/InterviewSessionPage'
import InterviewReviewPage from '@/pages/interview/InterviewReviewPage'

import GrowthReportPage from '@/pages/report/GrowthReportPage'
import NotFoundPage from '@/pages/error/NotFoundPage'

export const router = createBrowserRouter([
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

              { path: '/resume', element: <ResumeListPage /> },
              { path: '/resume/create', element: <ResumeCreatePage /> },
              { path: '/resume/:id/edit', element: <ResumeEditPage /> },
              { path: '/resume/:id/report', element: <ResumeReportPage /> },

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
])
