"""Home 路由（首页聚合）。

路径：``GET /api/v1/home/summary``
来源：设计说明书 5.4 需求，手册 10.2 未列，按用户要求补实现（见 README 第 6 节）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.home import HomeSummaryResponse
from app.services import home_service

router = APIRouter(prefix="/home", tags=["Home 首页聚合"])


@router.get(
    "/summary",
    response_model=ApiResponse[HomeSummaryResponse],
    summary="首页聚合（一次拿全 + 下一步建议）",
)
async def get_summary(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[HomeSummaryResponse]:
    """把首页原本要串行请求的 profile / task / daily 合成一次调用。

    响应里的 ``next_action`` 由后端按写死的优先级规则决定（产品「AI 主动性」的落点），
    前端不要自己判断优先级。完整契约见 backend/README.md「/home/summary」一节。

    这个接口**不会因为聚合失败返回 500**：service 内部有兜底，最差也会返回
    一个「去做基础测试」的引导。
    """
    return ApiResponse.ok(home_service.get_home_summary(db, current_user))
