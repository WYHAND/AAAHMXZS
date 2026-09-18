"""成长任务业务逻辑（手册 11.5 痛点诊断与任务推荐、11.6 打卡与画像更新、11.12 奖章触发）。

画像回流钩子（7.8）：
- ``complete_step``：打卡反馈 -> 抽取标签（行动力、自律性）
- 任务全部完成 -> ``badge_service.check_and_award``（11.12「起步行动家」）
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import STRUCTURED_TEMPERATURE
from app.ai.schemas import TaskGenerateResult, empty_task_generate
from app.core.errors import BusinessException, ErrorCode, not_found_unless_owner
from app.models.task import Task, TaskStep
from app.models.user import User, utcnow
from app.schemas.task import (
    TaskDetailResponse,
    TaskGenerateRequest,
    TaskResponse,
    TaskStepCompleteRequest,
    TaskStepResponse,
)
from app.services import profile_service
from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

# 附录E 成长任务模板（11.5：把痛点映射到任务模板）
TASK_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "缺项目": {
        "title": "做一个入门级小项目",
        "description": "选一个你感兴趣的小场景，做出能演示的最小版本。",
        "value_note": "面试官最想听你亲手做过什么，哪怕很小。",
        "difficulty": "中等",
        "estimated_days": 7,
        "steps": [
            {"title": "选定场景并写一句话目标", "action": "写出一句话：给谁解决什么问题，写完发给我看。"},
            {"title": "列出 3 个必须有的功能", "action": "每个功能写一句验收标准，不许多写。"},
            {"title": "做出能点通的最小版本", "action": "允许很丑，但主流程要能走完一遍。"},
            {"title": "录一段 1 分钟演示", "action": "边操作边说，录完自己看一遍。"},
        ],
    },
    "表达差": {
        "title": "每天 1 分钟口头复述",
        "description": "把当天学过的东西讲出来，练表达的结构感。",
        "value_note": "面试的表达能力就是平时讲习惯的复刻。",
        "difficulty": "简单",
        "estimated_days": 7,
        "steps": [
            {"title": "选一个今天的知识点", "action": "用一句话写下它是什么。"},
            {"title": "对着手机录 1 分钟讲解", "action": "必须有开头、中间、结尾三句。"},
            {"title": "回看并记下一个问题", "action": "只记一个你觉得说得最乱的地方。"},
        ],
    },
    "迷茫": {
        "title": "完成一次职业深度对话",
        "description": "找 1-2 位学长学姐或从业者聊清楚一个岗位。",
        "value_note": "迷茫大多来自信息太少，聊一次比想一周有用。",
        "difficulty": "简单",
        "estimated_days": 5,
        "steps": [
            {"title": "列出想问的 5 个问题", "action": "必须包含：每天做什么、最难的是什么、怎么入行。"},
            {"title": "联系 1-2 位可聊的人", "action": "发出具体邀约，说明只要 15 分钟。"},
            {"title": "完成对话并记录", "action": "写下 3 条让你意外的信息。"},
            {"title": "更新你的方向假设", "action": "写一句话：我还想不想做这个方向，为什么。"},
        ],
    },
    "缺实习": {
        "title": "挖掘三段校园经历",
        "description": "把课程作业、社团、比赛改写成可写进简历的经历。",
        "value_note": "没有实习不等于没有经历，关键是把经历讲成能力证据。",
        "difficulty": "简单",
        "estimated_days": 3,
        "steps": [
            {"title": "列出 3 段可写的经历", "action": "每段一句话说明你做了什么。"},
            {"title": "为每段补上结果", "action": "有数字写数字，没数字写影响范围。"},
            {"title": "改写成简历语言", "action": "统一成「动词 + 对象 + 结果」。"},
        ],
    },
}

DEFAULT_TEMPLATE_KEY = "迷茫"


# ---------------------------------------------------------------------------
# 任务列表 / 详情
# ---------------------------------------------------------------------------

def list_tasks(db: Session, user: User, status: Optional[str] = None) -> List[TaskResponse]:
    """GET /task：我的任务列表，可按状态过滤。"""
    statement = select(Task).where(Task.user_id == user.id)
    if status:
        statement = statement.where(Task.status == status)
    statement = statement.order_by(Task.created_at.desc())  # type: ignore[union-attr]
    return [_to_response(db, task) for task in db.exec(statement).all()]


def get_task_detail(db: Session, user: User, task_id: UUID) -> TaskDetailResponse:
    """GET /task/{id}：含步骤列表。"""
    task = get_task(db, user, task_id)
    steps = list_steps(db, task.id)
    response = TaskDetailResponse.model_validate(task)
    response.progress = _progress(steps)
    response.steps = [TaskStepResponse.model_validate(s) for s in steps]
    return response


def get_task(db: Session, user: User, task_id: UUID) -> Task:
    """取当前用户自己的任务。

    **「不存在」与「不属于自己」都返回 2001**（项目级编码规则，见 README §8 与
    ``app.core.errors.not_found_unless_owner``）。本函数服务于
    ``GET /task/{id}``、``/{id}/steps/{step_id}/complete``、``/{id}/abandon``。
    """
    return not_found_unless_owner(db.get(Task, task_id), user.id, "任务不存在")


def list_steps(db: Session, task_id: UUID) -> List[TaskStep]:
    statement = (
        select(TaskStep)
        .where(TaskStep.task_id == task_id)
        .order_by(TaskStep.step_order.asc())  # type: ignore[union-attr]
    )
    return list(db.exec(statement).all())


# ---------------------------------------------------------------------------
# 生成任务（11.5）
# ---------------------------------------------------------------------------

async def generate_task(db: Session, user: User, payload: TaskGenerateRequest) -> TaskDetailResponse:
    """POST /task/generate：痛点 -> 任务 + 步骤拆解。

    11.5：优先用画像里的痛点；没有就按阶段给一个通用起步任务。
    """
    pain_point = payload.pain_point or _pick_pain_point(db, user)

    existing = [t.title for t in db.exec(select(Task).where(Task.user_id == user.id)).all()]
    template_hint = TASK_TEMPLATES.get(pain_point, TASK_TEMPLATES[DEFAULT_TEMPLATE_KEY])

    result: TaskGenerateResult = await deepseek_client.chat_prompt_json(
        prompt_name="task_generate",
        variables={
            "pain_point": pain_point,
            "stage": profile_service.get_stage(db, user.id),
            "profile_tags": profile_service.serialize_tags(profile_service.list_tags(db, user.id)),
            "existing_tasks": existing,
            "template_hint": json.dumps(template_hint, ensure_ascii=False),
        },
        schema=TaskGenerateResult,
        default=empty_task_generate(pain_point),
        temperature=STRUCTURED_TEMPERATURE,
    )

    task = Task(
        user_id=user.id,
        title=result.title[:200],
        description=result.description,
        pain_point=result.pain_point or pain_point,
        status="进行中",
        value_note=result.value_note,
        difficulty=result.difficulty,
        estimated_days=result.estimated_days,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    steps = result.steps or []
    for index, step in enumerate(steps, start=1):
        db.add(
            TaskStep(
                task_id=task.id,
                step_order=step.order or index,
                title=step.title[:200],
                action=step.action,
                resource=step.resource,
            )
        )
    db.commit()
    logger.info("生成任务成功 user_id=%s task_id=%s pain_point=%s", user.id, task.id, pain_point)

    return get_task_detail(db, user, task.id)


# ---------------------------------------------------------------------------
# 打卡（11.6）
# ---------------------------------------------------------------------------

async def complete_step(
    db: Session,
    user: User,
    task_id: UUID,
    step_id: UUID,
    payload: TaskStepCompleteRequest,
) -> TaskDetailResponse:
    """POST /task/{id}/steps/{step_id}/complete：打卡 + 反馈 + 画像更新。"""
    task = get_task(db, user, task_id)

    step = db.get(TaskStep, step_id)
    if step is None or step.task_id != task.id:
        raise BusinessException(ErrorCode.NOT_FOUND, "任务步骤不存在")

    step.completed = True
    step.feedback = payload.feedback
    step.completed_at = utcnow()
    db.add(step)
    db.commit()

    # 进度推进：全部步骤完成 -> 任务完成
    steps = list_steps(db, task.id)
    if all(s.completed for s in steps):
        task.status = "已完成"
    task.updated_at = utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)

    # 7.8 画像回流：打卡反馈 -> 行动力/自律性标签
    await _extract_task_tags(db, user, task, step, payload.feedback)
    profile_service.recompute_stage(db, user.id)

    # 11.12 奖章触发：完成第一个任务 -> 起步行动家
    if task.status == "已完成":
        from app.services import badge_service

        badge_service.check_and_award(db, user, event="task_completed")

    return get_task_detail(db, user, task.id)


def abandon_task(db: Session, user: User, task_id: UUID) -> TaskResponse:
    """POST /task/{id}/abandon：放弃任务。"""
    task = get_task(db, user, task_id)
    if task.status == "已完成":
        raise BusinessException(ErrorCode.PARAM_ERROR, "已完成的任务不能放弃")
    task.status = "已放弃"
    task.updated_at = utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_response(db, task)


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

def _pick_pain_point(db: Session, user: User) -> str:
    """11.5：从画像标签里挑痛点，挑不到就用默认模板。"""
    pains = profile_service.top_pain_points(db, user.id, limit=1)
    return pains[0] if pains else DEFAULT_TEMPLATE_KEY


def _progress(steps: List[TaskStep]) -> float:
    if not steps:
        return 0.0
    done = sum(1 for s in steps if s.completed)
    return round(done / len(steps), 2)


def _to_response(db: Session, task: Task) -> TaskResponse:
    response = TaskResponse.model_validate(task)
    response.progress = _progress(list_steps(db, task.id))
    return response


async def _extract_task_tags(
    db: Session,
    user: User,
    task: Task,
    step: TaskStep,
    feedback: Optional[str],
) -> List[Dict[str, Any]]:
    """7.8：打卡反馈回流画像（行动力、自律性）。"""
    rule_tags: List[Dict[str, Any]] = [
        {"dimension": "能力", "label": "行动力", "weight": 0.6, "source": "task"},
    ]
    profile_service.apply_tags(db, user.id, rule_tags, source="task")

    if not feedback:
        return rule_tags

    text = f"任务：{task.title}\n步骤：{step.title}\n学生的打卡反馈：{feedback}"
    ai_tags = await profile_service.extract_tags_from_text(db, user.id, text, source="task")
    return rule_tags + ai_tags
