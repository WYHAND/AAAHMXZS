"""总路由（6.2 统一前缀 ``/api/v1``，6.9 模块划分）。

模块与手册 6.9 表格一一对应：

======  ==================  ==========
模块     前缀                说明
======  ==================  ==========
Auth     /api/v1/auth        注册登录
Test     /api/v1/test        测试表
Profile  /api/v1/profile     画像
Chat     /api/v1/chat        职业指导对话
Resume   /api/v1/resume      简历
Interview/api/v1/interview   面试
Task     /api/v1/task        成长任务
Daily    /api/v1/daily       每日一问
Report   /api/v1/report      成长报告
Badge    /api/v1/badge       奖章
======  ==================  ==========

手册 10.2 未列、按用户要求补实现的两个模块（设计说明书 5.4）：

======  ==================  ================================
Home     /api/v1/home        首页聚合（GET /home/summary）
Events   /api/v1/events      行为埋点上报（POST /events）
======  ==================  ================================
"""

from fastapi import APIRouter

from app.api.v1 import (
    auth,
    badge,
    chat,
    daily_question,
    events,
    home,
    interview,
    profile,
    report,
    resume,
    task,
    test,
)

API_V1_PREFIX = "/api/v1"

api_router = APIRouter(prefix=API_V1_PREFIX)

api_router.include_router(auth.router)
api_router.include_router(test.router)
api_router.include_router(profile.router)
api_router.include_router(chat.router)
api_router.include_router(resume.router)
api_router.include_router(interview.router)
api_router.include_router(task.router)
api_router.include_router(daily_question.router)
api_router.include_router(report.router)
api_router.include_router(badge.router)
# 补实现的两个模块（手册 10.2 未列，见 README 第 6 节）
api_router.include_router(home.router)
api_router.include_router(events.router)


@api_router.get("/health", tags=["System"], summary="健康检查")
async def health() -> dict:
    """探活用，不带 ApiResponse 信封（运维接口，避免被统一包装干扰）。"""
    return {"code": 0, "message": "success", "data": {"status": "ok"}}
