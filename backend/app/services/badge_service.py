"""奖章业务逻辑（手册 11.12 奖章触发、12.2 奖章结算、5.4 种子奖章）。

## 三枚奖章（``BADGE_RULES`` 是**唯一定义源**）

| key | 名字 | 条件 | 依据 |
|---|---|---|---|
| ``first_task`` | 起步行动家 | 完成第一个成长任务（``task_completed >= 1``） | 手册 5.4 / 11.12 |
| ``five_steps`` | 坚持打卡者 | 累计打卡 5 个任务步骤（``steps_completed >= 5``） | 手册 11.12（原种子里有定义但引擎没实现，是死数据） |
| ``profile_shape`` | 方向初现 | 画像标签累计 ≥ 6 条（``tags_collected >= 6``） | 见下方「为什么有第三枚」 |

**为什么定「方向初现」这一枚**：本产品的核心是「AI 从对话里挖出你的轮廓」，
画像标签是**真实对话抽出来的证据**（不是用户自报），所以"标签攒够 6 条"本身就是
用户跟 AI 聊出成果的第一个可见里程碑 —— 它奖励的是产品最核心的那条链路。
阈值取 6 的量级，落在"聊过几轮就能拿到"的位置（实测 ``wyh`` 7 条、
``admin`` 18 条，都能立刻看到效果），不会像手册 1.5 砍掉的"奖章墙"那样遥不可及。

**红线**：``current`` 只能来自真实行为证据（已完成任务 / 已完成步骤 / 画像标签），
不允许出现"用户声称即达成"的条件，也不允许为了让人拿到而调判定阈值。

## 引擎模型：事件只是触发器

``check_and_award`` **不再按事件名分支**：任何一次触发都会重新评估**全部**奖章条件。
这样带来三个好处：

1. 新增奖章能自然**追认**老用户（不需要补造历史事件）；
2. 事件名对不上也不会漏发（例如打卡路径传 ``steps_completed``，
   顺带把"任务完成/标签攒够"的条件一起评估了）；
3. ``check_all_users``（12.2 每小时兜底）就是同一套逻辑跑全量用户。

**当前的触发点**（``event`` 只是日志）：
- ``profile_service.apply_tags`` -> ``_check_and_award_silently``（``tags_collected``）：
  画像标签**数量变化**时立刻评估 —— 对话/面试复盘/每日一问/测评写的标签都经这条
  唯一漏斗，所以「方向初现」不再依赖下一次打卡或整点兜底；
- ``task_service.complete_step``（``steps_completed``）：打卡路径（覆盖任务/步骤/标签）。

## 可扩展性（"后续可以添加"）

新增一枚奖章：在 ``BADGE_RULES`` 加一条 → 跑一次 ``python -m app.db.init_db``
（``seed_badges`` 会按 name **幂等 upsert** 进 ``badges`` 表）。
**不需要改数据库 schema**：``key`` / ``art`` / ``description`` / ``hint`` 这些
元数据都存在已有的 ``badges.condition`` JSON 列里（``init_db`` 走
``SQLModel.metadata.create_all``，它不会给已存在的表加列，所以不能新增列）。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, func, select

from app.models.badge import Badge, UserBadge
from app.models.profile import ProfileTag
from app.models.task import Task, TaskStep
from app.models.user import User
from app.schemas.badge import (
    BadgeItemResponse,
    BadgeOverviewResponse,
    BadgeProgress,
    BadgeResponse,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)

# 任务状态中文枚举（5.3）
TASK_STATUS_DONE = "已完成"

# ---------------------------------------------------------------------------
# 条件事件名（= ``condition["event"]``）：写进 condition JSON，引擎按它数当前进度
# ---------------------------------------------------------------------------
EVENT_TASK_COMPLETED = "task_completed"  # 该用户「已完成」状态的任务数
EVENT_STEPS_COMPLETED = "steps_completed"  # 该用户所有任务下 completed=True 的步骤数
EVENT_TAGS_COLLECTED = "tags_collected"  # 该用户的画像标签条数

# 11.12 奖章触发：奖章名 -> condition（唯一定义源；``seed_data.BADGES`` 由它派生）
#
# condition 字段说明（**前端只需要 key**，其余是后端与种子的元数据）：
# - event / threshold：条件事件名与达成阈值（引擎据此算 current/target）；
# - key：稳定机器标识，前端 switch 它选奖章美术（取不到用默认美术兜底）；
# - art：美术资源名（前端可直接当美术标识；当前与 key 同名，将来换皮不必改 key）；
# - order：``GET /badge`` 的展示顺序（契约要求门槛从低到高、槽位稳定；
#   阈值跨事件不可直接比较，所以显式给 order 而不是靠 threshold 排序）；
# - description：一句话说明这枚奖章是什么（契约 `items[].description`）；
# - hint：**未获得**时"怎么拿到"（契约 `items[].hint`）；
# - earned_hint：**已获得**时的一句庆祝/意义（同一个 hint 字段的另一种取值）。
#
# 文案红线：说人话、不出现英文字段名、不出现"声称即达成"的暗示。
BADGE_RULES: Dict[str, Dict[str, Any]] = {
    "起步行动家": {
        "event": EVENT_TASK_COMPLETED,
        "threshold": 1,
        "key": "first_task",
        "art": "first_task",
        "order": 1,
        "description": "完成第一个成长任务",
        "hint": "把「成长任务」里任意一个任务的步骤全部打完，让它变成已完成",
        "earned_hint": "你已经迈出第一步——动手做，永远比想清楚更值钱",
    },
    "坚持打卡者": {
        "event": EVENT_STEPS_COMPLETED,
        "threshold": 5,
        "key": "five_steps",
        "art": "five_steps",
        "order": 2,
        "description": "累计打卡 5 个任务步骤",
        "hint": "在任务里打卡满 5 个步骤，跨任务累计都算",
        "earned_hint": "稳定坚持比一时冲劲更难得，你已经打卡 5 次了",
    },
    "方向初现": {
        "event": EVENT_TAGS_COLLECTED,
        "threshold": 6,
        "key": "profile_shape",
        "art": "profile_shape",
        "order": 3,
        "description": "AI 从对话里攒够 6 条你的画像标签",
        "hint": "多和 AI 聊几轮，让它从你的话里攒出 6 条画像标签",
        "earned_hint": "AI 已经从你的话里攒出 6 条画像标签，你的职业轮廓开始成形了",
    },
}

# ---------------------------------------------------------------------------
# 进度计算：事件 -> 真实证据的条数
# ---------------------------------------------------------------------------
def count_event_progress(db: Session, user: User, event: str) -> Optional[int]:
    """按事件名数该用户的**真实证据**条数；未知事件返回 ``None``（调用方跳过）。

    - ``task_completed``：``tasks.status == "已完成"`` 的任务数；
    - ``steps_completed``：该用户**所有任务下** ``task_steps.completed == True``
      的步骤数（跨任务累计，不是单个任务内）；
    - ``tags_collected``：``profile_tags`` 条数。
    """
    if event == EVENT_TASK_COMPLETED:
        return int(
            db.exec(
                select(func.count())
                .select_from(Task)
                .where(Task.user_id == user.id, Task.status == TASK_STATUS_DONE)
            ).one()
        )
    if event == EVENT_STEPS_COMPLETED:
        return int(
            db.exec(
                select(func.count())
                .select_from(TaskStep)
                .join(Task, TaskStep.task_id == Task.id)  # type: ignore[arg-type]
                .where(Task.user_id == user.id, TaskStep.completed.is_(True))
            ).one()
        )
    if event == EVENT_TAGS_COLLECTED:
        return int(
            db.exec(
                select(func.count())
                .select_from(ProfileTag)
                .where(ProfileTag.user_id == user.id)
            ).one()
        )
    return None


# ---------------------------------------------------------------------------
# 奖章定义
# ---------------------------------------------------------------------------
def _ordered_rules() -> List[Tuple[str, Dict[str, Any]]]:
    """全部奖章规则，按 ``order``（= 契约要求的展示顺序，门槛从低到高）排序。

    同一 ``order`` 时用奖章名兜底，保证顺序**完全确定**（槽位稳定）。
    """
    return sorted(
        BADGE_RULES.items(),
        key=lambda item: (int(item[1].get("order", 0)), int(item[1].get("threshold", 0)), item[0]),
    )


def list_all_badges(db: Session) -> List[BadgeResponse]:
    """全部奖章定义（骨架扩展，路由层未开放）。"""
    return [BadgeResponse.model_validate(b) for b in db.exec(select(Badge)).all()]


def get_or_create_badge(db: Session, name: str) -> Badge:
    """取奖章定义，没有就用 ``BADGE_RULES`` 建一个（5.4 种子数据的运行时兜底）。

    兜底的意义：万一 ``init_db`` 没跑（例如刚加了一枚新奖章还没重灌种子），
    发放也不会因为缺一行定义而失败；condition 与种子完全一致（同一个定义源）。
    """
    badge = db.exec(select(Badge).where(Badge.name == name)).first()
    if badge is None:
        badge = Badge(name=name, condition=dict(BADGE_RULES.get(name, {})))
        db.add(badge)
        db.commit()
        db.refresh(badge)
    return badge


def award_badge(db: Session, user: User, badge: Badge) -> Optional[UserBadge]:
    """发放奖章（幂等：已拥有则返回 ``None``，不重复插 ``user_badges``）。"""
    existing = db.exec(
        select(UserBadge).where(UserBadge.user_id == user.id, UserBadge.badge_id == badge.id)
    ).first()
    if existing is not None:
        return None

    user_badge = UserBadge(user_id=user.id, badge_id=badge.id)
    db.add(user_badge)
    db.commit()
    db.refresh(user_badge)
    logger.info("发放奖章 user_id=%s badge=%s key=%s", user.id, badge.name, (badge.condition or {}).get("key"))
    return user_badge


# ---------------------------------------------------------------------------
# 发放引擎
# ---------------------------------------------------------------------------
def check_and_award(db: Session, user: User, event: Optional[str] = None) -> List[str]:
    """11.12 / 12.2：评估**全部**奖章条件并按需发放。返回本次新获得的奖章名列表。

    ``event`` 只是**触发器/日志**（"谁把我叫起来的"），**不再决定评估哪些奖章**：
    一次触发会把全部条件都算一遍。这样新增奖章能自然追认老用户，事件名对不上也不漏发。

    幂等：已拥有的奖章由 ``award_badge`` 拦掉（返回 ``None``），所以
    ``check_all_users`` 反复跑、打卡路径每个步骤都跑，都不会重复发放。
    """
    awarded: List[str] = []

    for name, rule in BADGE_RULES.items():
        current = count_event_progress(db, user, str(rule.get("event", "")))
        if current is None:
            # 未知事件（将来加了没有对应计数器的奖章）：跳过而不是崩，日志里能看见
            logger.warning("奖章条件的事件没有计数器，已跳过 badge=%s event=%s", name, rule.get("event"))
            continue
        target = int(rule.get("threshold", 1))
        if current < target:
            continue
        badge = get_or_create_badge(db, name)
        if award_badge(db, user, badge) is not None:
            awarded.append(badge.name)

    if awarded:
        logger.info(
            "奖章触发 user_id=%s trigger=%s 新获得=%s",
            user.id,
            event or "全量",
            awarded,
        )
    return awarded


def check_all_users(db: Session) -> int:
    """12.2 奖章结算定时任务用：遍历**全部用户 × 全部条件**，返回新发放数量。

    不带 event（全量语义）—— 它是真正的"追认兜底"：正常情况下标签/打卡一发生
    就已经由 ``apply_tags`` 或 ``complete_step`` 即时发放了，这里只兜住任何**绕过
    那些入口**产生的证据（例如历史数据、脚本直接写库），所以它仍是必要的第二道。
    """
    users = db.exec(select(User).where(User.deleted_at.is_(None))).all()  # type: ignore[union-attr]
    count = 0
    for user in users:
        count += len(check_and_award(db, user))
    return count


# ---------------------------------------------------------------------------
# GET /badge
# ---------------------------------------------------------------------------
def get_badge_overview(db: Session, user: User) -> BadgeOverviewResponse:
    """``GET /badge``：全部奖章（固定顺序）+ 本人是否拿到 + 进度。

    取数三处，互不耦合：

    1. 奖章定义与顺序来自 ``BADGE_RULES``（代码，契约固定 3 枚）；
    2. ``badges`` 表只用来把奖章名映射成 id（**GET 不写库**，缺行也不补
       —— 种子没跑时 ``obtained`` 全为 false，而不是报错）；
    3. ``user_badges`` 表给出 ``obtained_at``。

    items 严格按 ``BADGE_RULES`` 输出（``total`` 恒等于规则条数），
    所以前端槽位数量与顺序完全稳定；``badges`` 表里多出来的历史奖章不会出现在
    items 里（当前库里没有这种情况）。

    ``progress.current`` 已达成的封顶为 ``target``：契约里这个字段叫 progress
    （进度），进度条不该溢出 100%；未达成时它是真实证据条数（``< target``）。
    """
    badge_ids = {badge.name: badge.id for badge in db.exec(select(Badge)).all()}
    obtained_at_by_badge = {
        user_badge.badge_id: user_badge.obtained_at
        for user_badge in db.exec(select(UserBadge).where(UserBadge.user_id == user.id)).all()
    }

    items: List[BadgeItemResponse] = []
    for name, rule in _ordered_rules():
        target = int(rule.get("threshold", 1))
        raw_current = count_event_progress(db, user, str(rule.get("event", ""))) or 0
        badge_id = badge_ids.get(name)
        obtained_at = obtained_at_by_badge.get(badge_id) if badge_id is not None else None
        obtained = obtained_at is not None
        hint_text = rule.get("earned_hint") if obtained else rule.get("hint")
        items.append(
            BadgeItemResponse(
                key=str(rule.get("key") or ""),
                name=name,
                description=str(rule.get("description") or ""),
                hint=str(hint_text or ""),
                obtained=obtained,
                obtained_at=obtained_at if obtained else None,
                progress=BadgeProgress(current=min(raw_current, target), target=target),
            )
        )

    return BadgeOverviewResponse(
        total=len(items),
        obtained_count=sum(1 for item in items if item.obtained),
        items=items,
    )
