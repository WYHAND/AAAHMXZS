"""成长报告业务逻辑（手册 11.10 / 11.11；报告语义见 README §4.15）。

**本轮语义改动（用户拍板）**：

- ``GET /report`` —— **每次实时计算，从不落库**。之前"有历史就返回最近一份、完全不重算"，
  导致用户打了卡、改了分数，报告页还是旧数据。
- ``POST /report/save`` —— 把当前实时数据 + 用户的补充说明，存成**一份里程碑快照**；
  这份快照同时成为下一次 ``score_delta`` 的**基线**。
- ``score_delta`` —— 对比「最近一次**保存**的报告」；**从未保存过则全为 0**，
  前端靠 ``saved`` / ``last_saved_at`` 判断"没有基线"，不要只看 delta 是不是 0。
- ``suggestions`` —— 从 ``List[str]`` 改成 ``[{text, pain_point}]``，
  ``pain_point`` 可以直接喂给 ``POST /task/generate``，让"报告 → 行动"闭环。

⚠️ **产品红线**：用户**只能编辑自己的补充说明（``user_note``）**，
**绝对不能改分数**（``clarity_score`` / ``action_score`` / ``resume_score`` / ``total_score``）。
分数是对"行为证据"的度量，由测评、打卡、简历、面试算出；让用户手改就失去意义。
所以 :class:`~app.schemas.report.ReportSaveRequest` 里根本没有分数字段，
本模块的保存函数也只写 ``content.user_note``（见 §4.15.3）。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.models.report import Report
from app.models.task import Task, TaskStep
from app.models.user import User, utcnow
from app.schemas.report import (
    GrowthReportResponse,
    GrowthSuggestion,
    ReportResponse,
    ReportScoreDelta,
    USER_NOTE_MAX_LENGTH,
)
from app.services import profile_service
from app.utils.logger import get_logger
from app.utils.stage import to_stage_label, to_stage_slug

logger = get_logger(__name__)

REPORT_TYPE_GROWTH = "growth"

# 分数项（delta 与阶段变化都按这几个字段算）
SCORE_FIELDS = ("clarity_score", "action_score", "resume_score", "total_score")

# 建议的触发阈值 + 每条建议对应的**痛点词**（可直接作为 POST /task/generate 的 pain_point）。
# 顺序即展示顺序；pain_point 必须与 task_service.TASK_TEMPLATES 的键或关键词对得上
# （task_service 支持"精确匹配 -> 互相包含 -> 默认模板"的降级匹配）。
SUGGESTION_RULES: List[Dict[str, Any]] = [
    {
        "when": lambda s: s["action_score"] < 40,
        "text": "优先做一件能在 3 天内完成的小事，把行动分拉起来",
        "pain_point": "行动力不足",
    },
    {
        "when": lambda s: s["resume_score"] < 50,
        "text": "先补齐简历的项目/实习描述，再考虑精修",
        "pain_point": "简历没有可写的经历",
    },
    {
        "when": lambda s: s["clarity_score"] < 40,
        "text": "多聊两个具体岗位的日常，把方向缩小到 1-2 个",
        "pain_point": "职业方向不明确",
    },
]

# 全部指标都不错时的兜底建议
FALLBACK_SUGGESTION = GrowthSuggestion(
    text="保持节奏，下一步可以尝试一次全真模拟面试",
    pain_point="缺乏面试经验",
)


def get_growth_report(db: Session, user: User, refresh: bool = False) -> GrowthReportResponse:
    """``GET /report``：**实时计算**当前报告（不落库）。

    ``refresh`` 参数**已废弃且被忽略**（保留只是为了不破坏老前端的调用）：
    以前 ``refresh=True`` 的含义是"重算并落一份新报告"，也就是让 GET 产生写副作用；
    现在 GET 永远实时，想落快照请用 ``POST /report/save``。
    """
    if refresh:
        logger.warning(
            "GET /report?refresh=true 已废弃且被忽略（GET 现在永远实时计算、不落库）；"
            "需要保存快照请改用 POST /report/save user_id=%s", user.id,
        )
    return _compose_response(db, user)


def save_growth_report(db: Session, user: User, user_note: Optional[str] = None) -> GrowthReportResponse:
    """``POST /report/save``：把当前实时数据存成一份里程碑快照。

    - 快照内容 = 实时计算的结果 + 用户补充说明（``content.user_note``）；
    - 保存后这份快照成为下一次 ``score_delta`` 的基线，所以**紧跟其后的 GET delta 全为 0**；
    - 只写用户补充说明，**不写任何分数**（产品红线，见模块 docstring）；
    - 输入的 ``user_note`` 由 schema 限制 ≤ 500 字（超长 -> 1001），这里再截断一次兜底。
    """
    content = build_growth_content(db, user)

    note = (user_note or "").strip()[:USER_NOTE_MAX_LENGTH]
    content["user_note"] = note
    content["saved_at"] = utcnow().isoformat()

    report = Report(user_id=user.id, type=REPORT_TYPE_GROWTH, content=content)
    db.add(report)
    db.commit()
    db.refresh(report)
    logger.info(
        "保存成长报告快照 user_id=%s report_id=%s total=%.1f stage=%s note_len=%s",
        user.id, report.id, content.get("total_score", 0.0), content.get("stage"), len(note),
    )

    # 保存后重新组织响应：此时基线就是刚存的这份 -> delta 全 0、last_saved_at 为新时间
    return _compose_response(db, user)


def build_growth_content(db: Session, user: User) -> Dict[str, Any]:
    """实时聚合报告内容（11.10：画像变化 + 完成任务数 + 建议）。**不落库。**

    返回的 dict 可直接作为 ``reports.content``（保存时）或响应 ``data`` 的主体（GET 时）。
    """
    profile = profile_service.get_or_create_profile(db, user.id)

    # ---- 任务与打卡统计 ----
    tasks = db.exec(select(Task).where(Task.user_id == user.id)).all()
    completed_tasks = [t for t in tasks if t.status == "已完成"]
    task_ids = [t.id for t in tasks]
    completed_steps = 0
    if task_ids:
        completed_steps = len(
            db.exec(
                select(TaskStep).where(
                    TaskStep.task_id.in_(task_ids),  # type: ignore[union-attr]
                    TaskStep.completed.is_(True),  # type: ignore[union-attr]
                )
            ).all()
        )

    current = {
        "clarity_score": round(float(profile.clarity_score), 2),
        "action_score": round(float(profile.action_score), 2),
        "resume_score": round(float(profile.resume_score), 2),
        "total_score": round(float(profile.total_score), 2),
    }

    # ---- 与「最近一次保存的报告」对比 ----
    # 注意：没有基线时 delta **全部为 0**。
    # 旧实现写的是 `previous.get(x) or profile.x`，没有上一份时会拿当前值当基线 ——
    # 结果必然得 0，但看代码像是"真的对比过"，容易被误读。现在显式区分：
    # 没有基线 -> 0，由 saved / last_saved_at 告诉前端"没有可比对的基线"。
    previous = _latest_report(db, user.id)
    previous_content: Dict[str, Any] = dict(previous.content or {}) if previous is not None else {}
    if previous is None:
        delta = {field: 0.0 for field in SCORE_FIELDS}
    else:
        delta = {
            field: round(current[field] - float(previous_content.get(field) or 0.0), 2)
            for field in SCORE_FIELDS
        }

    # ---- 阶段 ----
    stage_slug = to_stage_slug(profile.stage)
    previous_stage_slug = (
        to_stage_slug(previous_content.get("stage")) if previous_content.get("stage") else None
    )

    # ---- 亮点 ----
    highlights: List[str] = []
    if completed_tasks:
        highlights.append(f"完成了 {len(completed_tasks)} 个成长任务")
    if completed_steps:
        highlights.append(f"累计打卡 {completed_steps} 个步骤")
    if profile.resume_score > 0:
        highlights.append("简历已开始成形")
    if profile.clarity_score >= 60:
        highlights.append("职业方向已经比较清晰")
    if delta.get("total_score", 0.0) > 0:
        highlights.append(f"相较上次保存，总分提升了 {delta['total_score']}")

    # ---- 建议（带 pain_point，可一键生成任务）----
    suggestions: List[GrowthSuggestion] = [
        GrowthSuggestion(text=rule["text"], pain_point=rule["pain_point"])
        for rule in SUGGESTION_RULES
        if rule["when"](current)
    ]
    if not suggestions:
        suggestions = [FALLBACK_SUGGESTION]

    return {
        "stage": stage_slug,
        "stage_label": to_stage_label(stage_slug),
        "stage_changed": previous_stage_slug is not None and previous_stage_slug != stage_slug,
        **current,
        "score_delta": delta,
        "completed_tasks": len(completed_tasks),
        "completed_steps": completed_steps,
        "active_days": _count_active_days(db, user.id),
        "highlights": highlights,
        "suggestions": [s.model_dump() for s in suggestions],
    }


def list_reports(db: Session, user: User, report_type: Optional[str] = None) -> List[ReportResponse]:
    """按类型列出**已保存的**报告快照（原始行视图；路由层暂未开放）。"""
    statement = select(Report).where(Report.user_id == user.id)
    if report_type:
        statement = statement.where(Report.type == report_type)
    statement = statement.order_by(Report.created_at.desc(), Report.id.desc())  # type: ignore[union-attr]
    return [ReportResponse.model_validate(r) for r in db.exec(statement).all()]


def _compose_response(db: Session, user: User) -> GrowthReportResponse:
    """实时内容 + 最近一次保存的元信息（``saved`` / ``last_saved_at`` / ``user_note``）。

    ⚠️ 注意这里的写法：先把 ``content`` 拷一份、**就地替换** ``score_delta`` /
    ``suggestions`` 两个键，再整体展开。不能写成
    ``GrowthReportResponse(**content, score_delta=...)`` —— 那样会因为
    ``content`` 里已经有同名键而抛
    ``TypeError: got multiple values for keyword argument 'score_delta'``
    （实测踩过，见 README §5.1 的 bug 清单）。
    """
    content = build_growth_content(db, user)
    latest = _latest_report(db, user.id)
    latest_content: Dict[str, Any] = dict(latest.content or {}) if latest is not None else {}

    payload: Dict[str, Any] = dict(content)
    payload["score_delta"] = ReportScoreDelta(**payload["score_delta"])
    payload["suggestions"] = [GrowthSuggestion(**item) for item in payload["suggestions"]]

    return GrowthReportResponse(
        **payload,
        saved=latest is not None,
        last_saved_at=latest.created_at if latest is not None else None,
        # 用户补充说明只从**已保存的报告**里读：GET 是实时的，
        # 但"补充说明"是用户在保存那一刻写下的，不该被实时计算冲掉。
        user_note=str(latest_content.get("user_note") or "") if latest is not None else "",
    )


def _count_active_days(db: Session, user_id) -> int:
    """活跃天数（口径：有对话消息或任务打卡的不同日期数）。

    TODO: 手册未定义活跃口径，当前用 messages 的日期去重，见 README「待确认」。
    """
    from app.models.conversation import Conversation, Message

    conversation_ids = [
        c.id for c in db.exec(select(Conversation).where(Conversation.user_id == user_id)).all()
    ]
    days = set()
    if conversation_ids:
        messages = db.exec(
            select(Message).where(Message.conversation_id.in_(conversation_ids))  # type: ignore[union-attr]
        ).all()
        days |= {m.created_at.date() for m in messages if m.created_at}

    steps = db.exec(
        select(TaskStep)
        .join(Task, TaskStep.task_id == Task.id)  # type: ignore[arg-type]
        .where(Task.user_id == user_id, TaskStep.completed.is_(True))  # type: ignore[union-attr]
    ).all()
    days |= {s.completed_at.date() for s in steps if s.completed_at}
    return len(days)


def _latest_report(db: Session, user_id) -> Optional[Report]:
    statement = (
        select(Report)
        .where(Report.user_id == user_id, Report.type == REPORT_TYPE_GROWTH)
        .order_by(Report.created_at.desc(), Report.id.desc())  # type: ignore[union-attr]
    )
    return db.exec(statement).first()
