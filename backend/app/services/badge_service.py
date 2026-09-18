"""奖章业务逻辑（手册 11.12、12.2 奖章结算、5.4 种子「起步行动家」）。

MVP 只做一枚奖章：完成第一个任务 -> 起步行动家。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.models.badge import Badge, UserBadge
from app.models.task import Task
from app.models.user import User, utcnow
from app.schemas.badge import BadgeResponse, UserBadgeResponse
from app.utils.logger import get_logger

logger = get_logger(__name__)

# 11.12 奖章触发事件 -> 条件
BADGE_FIRST_TASK = "起步行动家"
BADGE_CONDITIONS: Dict[str, Dict[str, Any]] = {
    BADGE_FIRST_TASK: {"event": "task_completed", "threshold": 1},
}


def list_user_badges(db: Session, user: User) -> List[UserBadgeResponse]:
    """GET /badge：我的奖章。"""
    statement = (
        select(UserBadge, Badge)
        .where(UserBadge.user_id == user.id)
        .where(UserBadge.badge_id == Badge.id)
        .order_by(UserBadge.obtained_at.desc())  # type: ignore[union-attr]
    )
    results: List[UserBadgeResponse] = []
    for user_badge, badge in db.exec(statement).all():
        results.append(
            UserBadgeResponse(
                id=user_badge.id,
                badge_id=badge.id,
                name=badge.name,
                condition=badge.condition,
                obtained_at=user_badge.obtained_at,
            )
        )
    return results


def list_all_badges(db: Session) -> List[BadgeResponse]:
    """全部奖章定义（骨架扩展，路由层未开放）。"""
    return [BadgeResponse.model_validate(b) for b in db.exec(select(Badge)).all()]


def get_or_create_badge(db: Session, name: str) -> Badge:
    """取奖章定义，没有就用 BADGE_CONDITIONS 建一个（5.4 种子数据的运行时兜底）。"""
    badge = db.exec(select(Badge).where(Badge.name == name)).first()
    if badge is None:
        badge = Badge(name=name, condition=BADGE_CONDITIONS.get(name, {}))
        db.add(badge)
        db.commit()
        db.refresh(badge)
    return badge


def award_badge(db: Session, user: User, badge: Badge) -> Optional[UserBadge]:
    """发放奖章（幂等：已拥有则返回 None）。"""
    existing = db.exec(
        select(UserBadge).where(UserBadge.user_id == user.id, UserBadge.badge_id == badge.id)
    ).first()
    if existing is not None:
        return None

    user_badge = UserBadge(user_id=user.id, badge_id=badge.id)
    db.add(user_badge)
    db.commit()
    db.refresh(user_badge)
    logger.info("发放奖章 user_id=%s badge=%s", user.id, badge.name)
    return user_badge


def check_and_award(db: Session, user: User, event: str) -> List[str]:
    """11.12 / 12.2：按事件检查奖章条件并发放。

    目前支持：
    - ``event="task_completed"``：已完成任务数 >= 1 -> 起步行动家

    返回本次新获得的奖章名列表。
    """
    awarded: List[str] = []

    if event == "task_completed":
        completed = db.exec(
            select(Task).where(Task.user_id == user.id, Task.status == "已完成")
        ).all()
        threshold = int(BADGE_CONDITIONS[BADGE_FIRST_TASK].get("threshold", 1))
        if len(completed) >= threshold:
            badge = get_or_create_badge(db, BADGE_FIRST_TASK)
            if award_badge(db, user, badge) is not None:
                awarded.append(badge.name)

    # TODO: 更多奖章条件（手册 1.5 明确砍掉奖章墙与 5 种奖章，MVP 只保留一枚）
    return awarded


def check_all_users(db: Session) -> int:
    """12.2 奖章结算定时任务用：遍历用户检查条件。返回新发放数量。"""
    users = db.exec(select(User).where(User.deleted_at.is_(None))).all()  # type: ignore[union-attr]
    count = 0
    for user in users:
        count += len(check_and_award(db, user, event="task_completed"))
    return count
