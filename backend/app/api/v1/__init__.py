"""v1 路由包。

统一约定（6.2 / 10.1）：
- 前缀 ``/api/v1``（在 app/api/router.py 挂载）
- 每个模块一个 ``APIRouter``，加 tags 与鉴权依赖
- 响应统一包 ``ApiResponse``（见 app/core/api_response.py 的设计说明）

注：``home`` / ``events`` 两个模块不在手册 10.2 的清单里，
是设计说明书 5.4 的需求，按用户要求补实现（见 README 第 6 节）。
"""

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

__all__ = [
    "auth",
    "test",
    "profile",
    "chat",
    "resume",
    "interview",
    "task",
    "daily_question",
    "report",
    "badge",
    "home",
    "events",
]
