"""首页聚合业务逻辑（设计说明书 5.4 需求，手册 10.2 未列，按用户要求补实现）。

目标：前端首页从「串行发 4 个请求（profile / task / daily / conversations）」
变成「一次 ``GET /api/v1/home/summary``」，并且「下一步建议」由**后端**统一决策。

性能要求（本文件的实现约束）：
- 一次请求内**不允许 N+1**：任务的步骤统计用一条 ``GROUP BY`` 查询算完；
  当前步骤标题也用一条查询批出来，而不是每条任务查一次。
- 任何异常都要落到兜底响应：``get_home_summary`` 外层有 try/except，
  **绝不能因为首页聚合失败让用户看到空白**。
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import case, func, select as sa_select
from sqlmodel import Session, select

from app.models.profile import ProfileTag
from app.models.task import Task, TaskStep
from app.models.user import User, utcnow
from app.schemas.home import (
    HomeActivityPoint,
    HomeAiFinding,
    HomeDailyQuestion,
    HomeNextAction,
    HomeOngoingTask,
    HomeProfileSummary,
    HomeSummaryResponse,
    HomeTag,
)
from app.services import daily_question_service, profile_service
from app.services.report_service import collect_growth_counts
from app.utils.logger import get_logger, sanitize
from app.utils.stage import to_stage_label, to_stage_slug

logger = get_logger(__name__)

# AI 主动发现最多展示几条（只取痛点维度权重最高的）
MAX_AI_FINDINGS = 3

# 进行中任务最多展示几条
MAX_ONGOING_TASKS = 2

# 画像标签最多返回几条（首页不需要全量标签）
MAX_HOME_TAGS = 20

# 首页活动柱状图的窗口天数（近 14 天，含今天）
ACTIVITY_WINDOW_DAYS = 14


# ---------------------------------------------------------------------------
# 痛点 -> 建议落点路由
# ---------------------------------------------------------------------------
# 规则：按关键字命中，先匹配到的先赢；都不命中就落到 /task（生成成长任务）。
# 这样 AI 发现的每条痛点都有一个「点了就能做事」的去处，而不是只展示不行动。
PAIN_ROUTE_RULES: Tuple[Tuple[Tuple[str, ...], str], ...] = (
    (("迷茫", "方向", "认知", "焦虑", "不知道"), "/chat"),
    (("简历", "经历", "量化", "成果", "表达"), "/resume"),
    (("面试", "紧张", "沟通", "提问"), "/interview"),
    (("缺项目", "项目", "实习", "技能", "证书", "竞赛"), "/task"),
)

DEFAULT_PAIN_ROUTE = "/task"


def route_for_pain(label: str) -> str:
    """把痛点标签映射到前端路由（顺序敏感：写死的规则，便于产品调整）。"""
    text = str(label or "")
    for keywords, route in PAIN_ROUTE_RULES:
        if any(keyword in text for keyword in keywords):
            return route
    return DEFAULT_PAIN_ROUTE


# ---------------------------------------------------------------------------
# next_action：产品「AI 主动性」的落点
# ---------------------------------------------------------------------------
# ⚠️ 下面这段是**写死的产品规则**，不是随手的 if-else：
#    首页的「下一步做什么」必须由后端唯一决策（前端各自判断会互相打架），
#    所以优先级顺序在这里显式写清楚，按顺序取第一个命中的分支：
#
#      1. 没做测评            -> 先做测试（没有画像，后面所有推荐都是瞎猜）
#      2. 有进行中的任务      -> 继续那个任务（已经开始的事优先于开新坑）
#      3. 职业探索期          -> 找 AI 聊方向
#      4. 求职准备期          -> 完善简历
#      5. 求职冲刺期          -> 全真模拟面试
#      6. 其它（异常/空数据） -> 兜底：找 AI 聊
#
# TODO: 后续可把这套规则替换成 AI 生成（用画像 + 任务状态做 Prompt），
#       HomeNextAction 的结构不用变，前端无需改动。
ACTION_TAKE_TEST = HomeNextAction(
    text="先花 5 分钟做个小测试",
    route="/test/intro",
    reason="还没有你的画像，先做个测试我才能给你靠谱的建议",
)
ACTION_FALLBACK = HomeNextAction(
    text="和 AI 聊聊我的方向",
    route="/chat",
    reason="先聊聊，我们再决定做什么",
)
ACTION_BY_STAGE: Dict[str, HomeNextAction] = {
    "explore": HomeNextAction(
        text="和 AI 聊聊我的方向", route="/chat", reason="你还没有明确方向，聊两轮比空想有用"
    ),
    "prepare": HomeNextAction(
        text="继续完善我的简历", route="/resume", reason="方向有了，接下来把简历写扎实"
    ),
    "sprint": HomeNextAction(
        text="来一次全真模拟面试", route="/interview", reason="该练真刀真枪了，先测一下当前水平"
    ),
}


def decide_next_action(
    tested: bool,
    stage: str,
    ongoing_tasks: Sequence[HomeOngoingTask],
) -> HomeNextAction:
    """按上面写死的优先级决定「下一步」。**顺序即产品优先级，改动请同步 README。**"""
    # 1. 未做测评（最高优先级：没有画像，推荐无从谈起）
    if not tested:
        return ACTION_TAKE_TEST

    # 2. 有进行中的任务（继续已开始的事）
    if ongoing_tasks:
        task = ongoing_tasks[0]
        return HomeNextAction(
            text=f"继续：{task.title}",
            route=f"/task/{task.id}",
            reason="这个任务还没做完，先把它推进一格",
        )

    # 3-5. 按阶段
    action = ACTION_BY_STAGE.get(stage)
    if action is not None:
        return action

    # 6. 兜底（异常 stage / 空数据）
    return ACTION_FALLBACK


# ---------------------------------------------------------------------------
# 对外入口
# ---------------------------------------------------------------------------

def get_home_summary(db: Session, user: User) -> HomeSummaryResponse:
    """聚合首页所需的所有数据。

    外层包 try/except：聚合失败时返回兜底结构 + 记 error 日志，
    保证前端首页**永远有东西可渲染**（这是首页接口的硬要求）。
    """
    try:
        return _build_home_summary(db, user)
    except Exception as exc:  # noqa: BLE001 - 首页不允许 500
        logger.error("首页聚合失败，返回兜底数据 user_id=%s err=%s", user.id, sanitize(exc))
        return _fallback_summary(db, user)


def _build_home_summary(db: Session, user: User) -> HomeSummaryResponse:
    # 1) 画像（懒创建）+ 是否做过测评
    profile = profile_service.get_or_create_profile(db, user.id)
    tested = profile_service.has_finished_test(db, user.id)
    stage_slug = to_stage_slug(profile.stage)

    # 2) 画像标签（按权重降序，首页只需要一部分）。一次查出实体，
    #    ai_findings 的「证据原文」也要用它（extra 字段），所以不要在中间丢掉实体。
    tag_entities = _load_tag_entities(db, user.id)
    tags = [HomeTag.model_validate(t) for t in tag_entities]

    # 3) AI 主动发现：痛点维度权重 Top3
    findings = _build_findings(tag_entities)

    # 4) 进行中任务（含批量算出的步骤进度）
    ongoing = _load_ongoing_tasks(db, user.id)

    # 5) 今日一问（复用 daily_question_service，题库为空时它自己会兜底）
    daily = _load_daily_question(db, user)

    # 6) 三个统计数字（完成小探索 / 累计微步 / 活跃天数）——
    #    与成长报告**共用** report_service.collect_growth_counts，口径天然一致
    counts = collect_growth_counts(db, user)

    # 7) 近 14 天「每日完成步数」时间序列（首页活动柱状图）。
    #    独立包了 try/except：图表数据拿不到最多是空柱，不能让整个首页聚合挂掉。
    activity = _load_activity_points(db, user.id)

    return HomeSummaryResponse(
        stage=stage_slug,
        stage_label=to_stage_label(stage_slug),
        profile=HomeProfileSummary(
            clarity_score=profile.clarity_score,
            action_score=profile.action_score,
            resume_score=profile.resume_score,
            total_score=profile.total_score,
            stage=stage_slug,
            tested=tested,
        ),
        tags=tags,
        daily_question=daily,
        ai_findings=findings,
        ongoing_tasks=ongoing,
        activity=activity,
        completed_tasks=counts["completed_tasks"],
        completed_steps=counts["completed_steps"],
        active_days=counts["active_days"],
        next_action=decide_next_action(tested, stage_slug, ongoing),
    )


def _fallback_summary(db: Session, user: User) -> HomeSummaryResponse:
    """兜底响应：尽量保留能安全拿到的信息，其余给空。

    ``tested`` 会再单独试一次（它决定 next_action 是去做测试还是去聊天）；
    连它也失败时保守取 ``False``，即引导用户去做测评 —— 这个引导对任何用户都无害。
    """
    tested = False
    stage_slug = "explore"
    profile = HomeProfileSummary()
    try:
        tested = profile_service.has_finished_test(db, user.id)
        db_profile = profile_service.get_or_create_profile(db, user.id)
        stage_slug = to_stage_slug(db_profile.stage)
        profile = HomeProfileSummary(
            clarity_score=db_profile.clarity_score,
            action_score=db_profile.action_score,
            resume_score=db_profile.resume_score,
            total_score=db_profile.total_score,
            stage=stage_slug,
            tested=tested,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("首页兜底也拿不到画像 user_id=%s err=%s", user.id, sanitize(exc))

    # 统计数字单独兜一层：拿不到就给 0（首页允许数字不准，但不能因此 500）
    counts = {"completed_tasks": 0, "completed_steps": 0, "active_days": 0}
    try:
        counts = collect_growth_counts(db, user)
    except Exception as exc:  # noqa: BLE001
        logger.warning("首页兜底拿不到统计数字 user_id=%s err=%s", user.id, sanitize(exc))

    return HomeSummaryResponse(
        stage=stage_slug,
        stage_label=to_stage_label(stage_slug),
        profile=profile,
        tags=[],
        daily_question=None,
        ai_findings=[],
        ongoing_tasks=[],
        # 兜底时活动序列给空列表（前端自己会画横轴，空数组不报错）
        activity=[],
        completed_tasks=counts["completed_tasks"],
        completed_steps=counts["completed_steps"],
        active_days=counts["active_days"],
        next_action=decide_next_action(tested, stage_slug, []),
    )


# ---------------------------------------------------------------------------
# 内部：各块数据
# ---------------------------------------------------------------------------

def _load_tag_entities(db: Session, user_id) -> List[ProfileTag]:
    """一次查出画像标签实体（按权重降序，最多 MAX_HOME_TAGS 条）。

    返回 ORM 实体而不仅是精简 schema：``ai_findings`` 需要 ``extra`` 里的
    evidence 原文来写 reason。一次查询同时服务 tags 与 ai_findings，无 N+1。
    """
    statement = (
        select(ProfileTag)
        .where(ProfileTag.user_id == user_id)
        .order_by(ProfileTag.weight.desc())  # type: ignore[union-attr]
        .limit(MAX_HOME_TAGS)
    )
    return list(db.exec(statement).all())


def _build_findings(tag_entities: Sequence[ProfileTag]) -> List[HomeAiFinding]:
    """从标签里挑痛点维度，取权重最高的最多 3 条；没有就返回空数组（不报错）。"""
    pains = [t for t in tag_entities if t.dimension == "痛点"]
    # 查询已按权重降序，这里再显式排一次，避免上游排序变化影响结果
    pains.sort(key=lambda t: (-float(t.weight or 0.0), t.label))
    return [
        HomeAiFinding(
            pain_point=tag.label,
            label=tag.label,
            reason=_finding_reason(tag),
            target_route=route_for_pain(tag.label),
            # 证据强度直接用痛点标签的权重（实体已在手，无需额外查询）
            weight=float(tag.weight or 0.0),
        )
        for tag in pains[:MAX_AI_FINDINGS]
    ]


def _finding_reason(tag: ProfileTag) -> str:
    """给痛点配一句「为什么这么判断」。

    优先引用标签里的证据原文（``profile_tags.extra``，由 7.8 画像回流时写入，
    见 ``profile_service.apply_tags``）；没有证据就给一句中性说明，
    **绝不编造具体经历**（14.7 / 避免幻觉）。
    """
    evidence = _latest_evidence(tag)
    if evidence:
        return f"AI 在对话里注意到：{evidence[:60]}"
    return f"AI 判断你当前的一个主要卡点是「{tag.label}」"


def _latest_evidence(tag: ProfileTag) -> str:
    """从 ``extra`` 里取最近一条证据原文。

    结构由 ``profile_service.apply_tags`` 写入：
    - ``extra["evidence"]``：首次写入时的原话
    - ``extra["evidence_log"]``：后续追加的证据列表（最多保留 5 条，取最后一条最新）
    """
    extra = tag.extra
    if not isinstance(extra, dict):
        return ""
    evidence = str(extra.get("evidence") or "").strip()
    log = extra.get("evidence_log")
    if isinstance(log, list) and log:
        latest = str(log[-1] or "").strip()
        if latest:
            evidence = latest
    return evidence


def _load_activity_points(db: Session, user_id) -> List[HomeActivityPoint]:
    """近 14 天「每日完成步数」时间序列（含今天，日期升序，缺数据的天补 0）。

    为什么这样写：

    - **一条 GROUP BY 算完**：首页硬约束不允许 N+1（见文件头），
      绝不能按天循环查 14 次；这里 `task_steps JOIN tasks` 锁定当前用户 +
      已完成，按完成日期分组计数。
    - **按天/时区口径照抄 ``report_service._count_active_days``**：
      那里也是直接对 naive UTC 时间戳取 ``.date()``、**不做任何时区换算**，
      所以这里同样按 ``completed_at`` 的 UTC 日期分桶 —— 首页的活跃口径
      与成长报告不许漂移（活跃天数是两处共用的概念）。
    - **补 0 在 Python 侧做**：查询只返回「有打卡的日期」，未出现的日期
      在这里用 ``start..today`` 补齐；这样前端拿到的是定长 14 根柱子。
    - 用 ``func.date()`` 而不是 ``cast(..., Date)``：SQLite 上前者的语义就是
      「取日期字符串」，后者的 DATE 会退化成 NUMERIC 亲和性
      （``CAST('2026-10-11 ...' AS DATE)`` -> ``2026``），会算错天。

    整个函数自己兜异常：图表数据拿不到就返回空列表，绝不让首页聚合因此抛错。
    """
    try:
        today = utcnow().date()
        start = today - timedelta(days=ACTIVITY_WINDOW_DAYS - 1)

        # 一条查询：task_steps JOIN tasks，按 completed_at 的日期分组 count。
        # 不在这里用 SQL 比较日期做窗口过滤：``func.date(...)`` 在 PostgreSQL
        # 返回 date 类型，和绑定参数的字符串比较会报 operator 不存在；
        # 而单用户的历史打卡行数很小，分组后在 Python 里截窗口更稳、也跨方言。
        rows = db.execute(
            sa_select(
                func.date(TaskStep.completed_at).label("day"),
                func.count(TaskStep.id),
            )
            .select_from(TaskStep)
            .join(Task, TaskStep.task_id == Task.id)
            .where(
                Task.user_id == user_id,
                TaskStep.completed.is_(True),
                TaskStep.completed_at.is_not(None),
            )
            .group_by(func.date(TaskStep.completed_at))
        ).all()

        # 键统一成 'YYYY-MM-DD' 字符串（SQLite 本来就是字符串，PostgreSQL 的
        # date 对象 str() 后也是这个格式），保证与下面补 0 的键对得上。
        counts: Dict[str, int] = {str(day): int(cnt or 0) for day, cnt in rows}

        return [
            HomeActivityPoint(
                date=(start + timedelta(days=offset)).isoformat(),
                steps=counts.get((start + timedelta(days=offset)).isoformat(), 0),
            )
            for offset in range(ACTIVITY_WINDOW_DAYS)
        ]
    except Exception as exc:  # noqa: BLE001 - 首页不允许因图表数据失败而 500
        logger.warning("首页取活动序列失败，降级为空数组 user_id=%s err=%s", user_id, sanitize(exc))
        return []


def _load_ongoing_tasks(db: Session, user_id) -> List[HomeOngoingTask]:
    """进行中的任务（最多 2 条），步骤进度用 **2 条批量查询**算完，无 N+1。"""
    statement = (
        select(Task)
        .where(Task.user_id == user_id, Task.status == "进行中")
        .order_by(Task.created_at.desc())  # type: ignore[union-attr]
        .limit(MAX_ONGOING_TASKS)
    )
    tasks = list(db.exec(statement).all())
    if not tasks:
        return []

    task_ids = [t.id for t in tasks]

    # 查询 1：每个任务的 总步骤数 / 已完成步骤数（GROUP BY 一次算完）
    counts: Dict[Any, Tuple[int, int]] = {}
    count_rows = db.execute(
        sa_select(
            TaskStep.task_id,
            func.count(TaskStep.id),
            func.sum(case((TaskStep.completed.is_(True), 1), else_=0)),
        )
        .where(TaskStep.task_id.in_(task_ids))
        .group_by(TaskStep.task_id)
    ).all()
    for task_id, total, done in count_rows:
        counts[task_id] = (int(total or 0), int(done or 0))

    # 查询 2：一次性取出这些任务的所有未完成步骤，按 (任务, 步骤序号) 排序，
    #         每个任务取第一条即为 current_step_title（不是「每条任务查一次」）
    current_titles: Dict[Any, str] = {}
    pending_steps = (
        db.execute(
            sa_select(TaskStep)
            .where(TaskStep.task_id.in_(task_ids), TaskStep.completed.is_(False))
            .order_by(TaskStep.task_id, TaskStep.step_order)
        )
        .scalars()
        .all()
    )
    for step in pending_steps:
        current_titles.setdefault(step.task_id, step.title)

    result: List[HomeOngoingTask] = []
    for task in tasks:
        total, done = counts.get(task.id, (0, 0))
        result.append(
            HomeOngoingTask(
                id=task.id,
                title=task.title,
                difficulty=task.difficulty,
                estimated_days=task.estimated_days,
                done_steps=done,
                total_steps=total,
                current_step_title=current_titles.get(task.id),
            )
        )
    return result


def _load_daily_question(db: Session, user: User) -> Optional[HomeDailyQuestion]:
    """今日一问；无题时返回 ``None``（契约允许 null）。"""
    try:
        today = daily_question_service.get_today_question(db, user)
    except Exception as exc:  # noqa: BLE001 - 首页不能因为每日一问挂掉
        logger.warning("首页取每日一问失败 user_id=%s err=%s", user.id, sanitize(exc))
        return None

    question = getattr(today, "question", None)
    if question is None or question.content is None:
        return None

    options = question.options
    if isinstance(options, dict):
        # daily_questions.options 存的是 {"options": [...]} 形状，归一化成数组
        raw = options.get("options")
        option_list = raw if isinstance(raw, list) else []
    elif isinstance(options, list):
        option_list = options
    else:
        option_list = []

    return HomeDailyQuestion(
        id=question.id,
        content=question.content,
        options=[o for o in option_list if isinstance(o, dict)],
        answered=bool(getattr(today, "answered", False)),
    )
