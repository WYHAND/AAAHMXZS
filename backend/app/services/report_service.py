"""成长报告业务逻辑（手册 11.10、11.11、第 10 章 GET /report）。

11.10：聚合画像变化 + 完成任务数。
骨架实现：取最近一份 growth 报告做对比算 delta，没有历史就现算一份。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.core.errors import BusinessException, ErrorCode
from app.models.report import Report
from app.models.task import Task, TaskStep
from app.models.user import User
from app.schemas.report import ReportResponse
from app.services import profile_service
from app.utils.logger import get_logger
from app.utils.stage import to_stage_label, to_stage_slug

logger = get_logger(__name__)

REPORT_TYPE_GROWTH = "growth"


def get_growth_report(db: Session, user: User, refresh: bool = False) -> ReportResponse:
    """GET /report：返回成长报告。

    - ``refresh=False``（默认）：有历史报告就返回最近一份
    - ``refresh=True``：重新计算并落一份新报告
    - 一份都没有：现场计算并落库
    """
    latest = _latest_report(db, user.id)
    if latest is not None and not refresh:
        return _to_response(latest)

    content = build_growth_content(db, user)
    report = Report(user_id=user.id, type=REPORT_TYPE_GROWTH, content=content)
    db.add(report)
    db.commit()
    db.refresh(report)
    logger.info("生成成长报告 user_id=%s stage=%s", user.id, content.get("stage"))
    return _to_response(report)


def list_reports(db: Session, user: User, report_type: Optional[str] = None) -> List[ReportResponse]:
    """按类型列出报告（骨架扩展，路由层只用 GET /report）。"""
    statement = select(Report).where(Report.user_id == user.id)
    if report_type:
        statement = statement.where(Report.type == report_type)
    statement = statement.order_by(Report.created_at.desc())  # type: ignore[union-attr]
    return [_to_response(r) for r in db.exec(statement).all()]


def build_growth_content(db: Session, user: User) -> Dict[str, Any]:
    """11.10：聚合画像变化与完成任务数。"""
    profile = profile_service.get_or_create_profile(db, user.id)

    tasks = db.exec(select(Task).where(Task.user_id == user.id)).all()
    completed_tasks = [t for t in tasks if t.status == "已完成"]
    task_ids = [t.id for t in tasks]
    completed_steps = 0
    if task_ids:
        completed_steps = len(
            db.exec(
                select(TaskStep).where(TaskStep.task_id.in_(task_ids), TaskStep.completed.is_(True))  # type: ignore[union-attr]
            ).all()
        )

    previous = _latest_report(db, user.id)
    previous_content = dict(previous.content or {}) if previous is not None else {}

    delta = {
        "clarity_score": round(profile.clarity_score - float(previous_content.get("clarity_score") or profile.clarity_score), 2),
        "action_score": round(profile.action_score - float(previous_content.get("action_score") or profile.action_score), 2),
        "resume_score": round(profile.resume_score - float(previous_content.get("resume_score") or profile.resume_score), 2),
        "total_score": round(profile.total_score - float(previous_content.get("total_score") or profile.total_score), 2),
    }

    highlights: List[str] = []
    if completed_tasks:
        highlights.append(f"完成了 {len(completed_tasks)} 个成长任务")
    if completed_steps:
        highlights.append(f"累计打卡 {completed_steps} 个步骤")
    if profile.resume_score > 0:
        highlights.append("简历已开始成形")

    suggestions: List[str] = []
    if profile.action_score < 40:
        suggestions.append("优先做一件能在 3 天内完成的小事，把行动分拉起来")
    if profile.resume_score < 50:
        suggestions.append("先补齐简历的项目/实习描述，再考虑精修")
    if profile.clarity_score < 40:
        suggestions.append("多聊两个具体岗位的日常，把方向缩小到 1-2 个")
    if not suggestions:
        suggestions.append("保持节奏，下一步可以尝试一次全真模拟面试")

    # 阶段字段统一（README §4.11）：写进报告的 stage 也用 slug，另存 label 供展示。
    # 报告是历史快照，旧数据里 stage 可能是中文，所以对比前统一归一化成 slug。
    stage_slug = to_stage_slug(profile.stage)
    previous_stage_slug = to_stage_slug(previous_content.get("stage")) if previous_content.get("stage") else None

    return {
        "stage": stage_slug,
        "stage_label": to_stage_label(stage_slug),
        "stage_changed": previous_stage_slug is not None and previous_stage_slug != stage_slug,
        "clarity_score": profile.clarity_score,
        "action_score": profile.action_score,
        "resume_score": profile.resume_score,
        "total_score": profile.total_score,
        "score_delta": delta,
        "completed_tasks": len(completed_tasks),
        "completed_steps": completed_steps,
        "active_days": _count_active_days(db, user.id),
        "highlights": highlights,
        "suggestions": suggestions,
    }


def _count_active_days(db: Session, user_id) -> int:
    """活跃天数（骨架：按消息/打卡的不同日期数粗算）。

    TODO: 手册未定义活跃口径，当前用 messages + task_steps 的日期去重，见 README「待确认」。
    """
    from app.models.conversation import Conversation, Message

    conversation_ids = [
        c.id for c in db.exec(select(Conversation).where(Conversation.user_id == user_id)).all()
    ]
    if not conversation_ids:
        return 0
    messages = db.exec(select(Message).where(Message.conversation_id.in_(conversation_ids))).all()  # type: ignore[union-attr]
    return len({m.created_at.date() for m in messages if m.created_at})


def _latest_report(db: Session, user_id) -> Optional[Report]:
    statement = (
        select(Report)
        .where(Report.user_id == user_id, Report.type == REPORT_TYPE_GROWTH)
        .order_by(Report.created_at.desc())  # type: ignore[union-attr]
    )
    return db.exec(statement).first()


def _to_response(report: Report) -> ReportResponse:
    return ReportResponse.model_validate(report)
