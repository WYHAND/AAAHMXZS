"""Events 路由（行为埋点上报）。

路径：``POST /api/v1/events``
来源：设计说明书 5.4 需求，手册 10.2 未列，按用户要求补实现（见 README 第 6 节）。

⚠️ 当前**只写结构化日志，不持久化**（手册 5.3 没有事件表，建表属范围扩张）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.event import EventSubmitRequest
from app.services import event_service
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

router = APIRouter(prefix="/events", tags=["Events 行为埋点"])


@router.post(
    "",
    response_model=ApiResponse[None],
    summary="行为埋点上报（单条或批量）",
)
async def submit_events(
    payload: EventSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[None]:
    """接收「跳题 / 放弃任务 / 忽略建议 / 每日一问 / 对话轮次」等原始信号。

    入参两种形状都接受（契约见 backend/README.md「/events」一节）::

        {"event": "test_skip", "payload": {...}, "client_ts": "2026-09-18T10:00:00Z"}
        {"events": [{"event": "test_skip", "payload": {}, "client_ts": "..."}]}

    - 事件名**不做白名单**校验（前端会新增事件，未知事件名照收）；
    - ``payload`` 任意 JSON，宽松校验；
    - 单批上限 50 条，超出截断并记 warning；
    - 响应按约定固定为 ``{code:0,message:"success",data:null}``
      （统计值只写服务端日志，不回传给前端）。

    埋点是 fire-and-forget：这里再兜一层 try/except，任何异常都不影响调用方。
    """
    try:
        stats = event_service.record_events(db, current_user, payload.normalized())
        if stats.truncated:
            logger.warning("埋点批次被截断 user_id=%s truncated=%s", current_user.id, stats.truncated)
    except Exception as exc:  # noqa: BLE001 - 埋点失败绝不能影响业务
        logger.warning("埋点上报失败（已忽略）user_id=%s err=%s", current_user.id, sanitize(exc))

    return ApiResponse.ok(None)
