"""奖章结算任务（手册 12.2：每小时，检查奖章条件；11.12 奖章触发）。"""

from __future__ import annotations

from app.db.session import SessionLocal
from app.services import badge_service
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)


def settle_badges() -> int:
    """遍历所有用户检查**全部**奖章条件，返回本次新发放的奖章数量。

    11.12 / 12.2：它是"追认兜底"——打卡与任务路径会实时发放，这里每小时再全量扫一遍，
    保证任何绕过那两条路径产生的证据（例如画像标签由别的链路写入）也会被认领。
    """
    awarded = 0
    try:
        with SessionLocal() as db:
            awarded = badge_service.check_all_users(db)
            logger.info("奖章结算完成，本次新发放=%s", awarded)
    except Exception as exc:  # noqa: BLE001
        logger.error("奖章结算定时任务异常: %s", sanitize(exc))
    return awarded
