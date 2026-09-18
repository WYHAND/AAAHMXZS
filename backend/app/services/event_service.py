"""行为埋点上报业务逻辑（设计说明书 5.4 需求，手册 10.2 未列，按用户要求补实现）。

采集「无感采集」的原始信号：跳题、放弃任务、忽略建议、每日一问、对话轮次等，
后续用于画像回流参考。

**存储策略（重要）**：本骨架**只写结构化日志，不建表、不持久化**。
手册 5.3 没有事件表，擅自建表属于范围扩张（见 backend/README.md）。
要做真正的行为分析需要补一张 ``events`` 表（属于手册 5.3 变更）。

**失败不影响业务**：埋点接口内部全部 try/except，任何异常都只记 warning，
不向调用方抛错（前端 fire-and-forget 上报，不该因为埋点把业务搞挂）。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from app.models.user import User
from app.schemas.event import MAX_EVENTS_PER_BATCH, EventItem, EventStats
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

# 事件名的日志前缀，便于 grep / 后续接日志采集
LOG_PREFIX = "EVENT"


def record_events(db: object, user: User, items: List[EventItem]) -> EventStats:
    """记录一批事件（当前实现 = 写结构化日志）。

    参数 ``db`` 目前不使用，保留它是为了将来补 ``events`` 表时不用改调用方签名。
    """
    if not items:
        return EventStats(accepted=0, truncated=0, persisted=False)

    truncated = 0
    accepted_items = items
    if len(items) > MAX_EVENTS_PER_BATCH:
        truncated = len(items) - MAX_EVENTS_PER_BATCH
        accepted_items = items[:MAX_EVENTS_PER_BATCH]
        logger.warning(
            "单批埋点超过上限 %s 条，已截断 %s 条 user_id=%s",
            MAX_EVENTS_PER_BATCH, truncated, user.id,
        )

    now = datetime.now(timezone.utc)
    for item in accepted_items:
        try:
            _log_one(user.id, item, now)
        except Exception as exc:  # noqa: BLE001 - 单条事件失败不能影响其余
            logger.warning("埋点记录失败 user_id=%s event=%s err=%s",
                           user.id, sanitize(item.event), sanitize(exc))

    logger.info(
        "%s batch user_id=%s accepted=%s truncated=%s",
        LOG_PREFIX, user.id, len(accepted_items), truncated,
    )
    return EventStats(accepted=len(accepted_items), truncated=truncated, persisted=False)


def _log_one(user_id, item: EventItem, now: datetime) -> None:
    """把单条事件写成一行结构化日志。

    格式（便于后续用正则/日志管道解析入库）::

        EVENT user_id=<uuid> event=test_skip client_ts=<iso> server_ts=<iso> payload={...}

    ``payload`` 一律走 ``sanitize``，避免把 token/密码之类的东西写进日志（14.6）。
    """
    payload_text = sanitize(item.payload)
    # 单条日志里 payload 限长，避免超长 JSON 刷爆日志
    if len(payload_text) > 2000:
        payload_text = payload_text[:2000] + "...(truncated)"
    client_ts = item.client_ts.isoformat() if item.client_ts else ""
    logger.info(
        "%s user_id=%s event=%s client_ts=%s server_ts=%s payload=%s",
        LOG_PREFIX, user_id, item.event, client_ts, now.isoformat(), payload_text,
    )


def count_events_today(db: object, user: User) -> int:
    """占位：当前没有事件表，无法统计。

    TODO: 补 ``events`` 表（user_id / event / payload JSONB / client_ts / created_at）
    后改为 ``SELECT count(*) ... WHERE created_at >= today``。
    手册 5.3 需同步新增该表定义。
    """
    return 0
