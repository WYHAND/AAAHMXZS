"""画像与基础测试表业务逻辑。

覆盖《开发手册》：
- 11.2 基础测试表（获取题目 / 提交答案 / 取结果）
- 11.3 初始画像生成（分项计分 → 加权总分 → 阶段）
- 11.4 步骤 3 每轮抽取画像标签
- 11.8 / 11.9 简历与面试的画像回流
- 7.8 AI 数据回流画像（标签写入 profile_tags + 重新判定阶段）
- 附录A 画像标签枚举、附录B 阶段判定

注意：router 里没有 ``/test`` 独立的 service 文件（4.1 的 services 清单里没有
``test_service.py``），所以测试表的业务逻辑就落在本模块，见 README「待确认」。
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlmodel import Session, select

from app.core.errors import BusinessException, ErrorCode
from app.models.profile import Profile, ProfileTag
from app.models.resume import Resume
from app.models.task import Task, TaskStep
from app.models.test import TestResult
from app.models.user import User, utcnow
from app.schemas.profile import ProfileFeedbackRequest, ProfileResponse, ProfileTagResponse
from app.schemas.test import TestOption, TestQuestion, TestResultResponse, TestSubmitRequest
from app.utils.logger import get_logger
from app.utils.stage import (
    STAGE_EXPLORE,
    STAGE_PREPARE,
    STAGE_SPRINT,
    calc_profile_scores,
    calc_stage,
    calc_total_score,
    clamp_score,
)

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# 题库占位（手册 5.4 要求 30-50 题、纯选择题、四维度；骨架只放少量示例，
# 真实题库应落库或放静态 JSON，见 app/db/init_db.py 的 seed_test_questions）
# 维度含义：clarity=职业目标清晰度、action=求职行动进度、resume=简历完整度、interest=兴趣倾向
# ---------------------------------------------------------------------------
TEST_QUESTION_BANK: List[Dict[str, Any]] = [
    {
        "id": "q_clarity_01",
        "dimension": "clarity",
        "content": "你目前有明确的职业方向吗？",
        "options": [
            {"key": "A", "text": "很清楚，已经锁定具体岗位", "score": 5},
            {"key": "B", "text": "有大致方向，还在验证", "score": 3},
            {"key": "C", "text": "有感兴趣的几个领域，说不清哪个更适合", "score": 2},
            {"key": "D", "text": "完全没想过", "score": 0},
        ],
    },
    {
        "id": "q_clarity_02",
        "dimension": "clarity",
        "content": "你了解自己想去的岗位每天在做什么吗？",
        "options": [
            {"key": "A", "text": "了解，问过从业者或做过相关项目", "score": 5},
            {"key": "B", "text": "看过一些介绍，大概知道", "score": 3},
            {"key": "C", "text": "只有模糊印象", "score": 1},
            {"key": "D", "text": "完全不了解", "score": 0},
        ],
    },
    {
        "id": "q_clarity_03",
        "dimension": "clarity",
        "content": "你了解自己的优势吗？",
        "options": [
            {"key": "A", "text": "很清楚，能说出具体例子", "score": 5},
            {"key": "B", "text": "知道大概，但举不出例子", "score": 3},
            {"key": "C", "text": "别人说过，自己不太确定", "score": 2},
            {"key": "D", "text": "没想过", "score": 0},
        ],
    },
    {
        "id": "q_action_01",
        "dimension": "action",
        "content": "你写过简历吗？",
        "options": [
            {"key": "A", "text": "写过，并且根据岗位改过至少 2 个版本", "score": 5},
            {"key": "B", "text": "写过一版", "score": 3},
            {"key": "C", "text": "有素材但没整理成简历", "score": 1},
            {"key": "D", "text": "完全没写过", "score": 0},
        ],
    },
    {
        "id": "q_action_02",
        "dimension": "action",
        "content": "你参加过实习或与专业相关的实践吗？",
        "options": [
            {"key": "A", "text": "有 2 段及以上相关经历", "score": 5},
            {"key": "B", "text": "有 1 段相关经历", "score": 3},
            {"key": "C", "text": "做过一些零散的实践，不算正式经历", "score": 2},
            {"key": "D", "text": "完全没有", "score": 0},
        ],
    },
    {
        "id": "q_action_03",
        "dimension": "action",
        "content": "最近一个月，你为就业做过哪些具体的事？",
        "options": [
            {"key": "A", "text": "投递/面试/做项目，每周都有动作", "score": 5},
            {"key": "B", "text": "偶尔看过岗位或改过简历", "score": 3},
            {"key": "C", "text": "只是想过，没行动", "score": 1},
            {"key": "D", "text": "没有", "score": 0},
        ],
    },
    {
        "id": "q_resume_01",
        "dimension": "resume",
        "content": "你的简历里有可以量化的项目或实习成果吗？",
        "options": [
            {"key": "A", "text": "有，多条都有具体数字或结果", "score": 5},
            {"key": "B", "text": "有 1-2 条", "score": 3},
            {"key": "C", "text": "只写了职责，没有结果", "score": 1},
            {"key": "D", "text": "没有可写的经历", "score": 0},
        ],
    },
    {
        "id": "q_resume_02",
        "dimension": "resume",
        "content": "你知道目标岗位的关键词、知道简历要往上靠吗？",
        "options": [
            {"key": "A", "text": "知道，并且简历里已经对齐", "score": 5},
            {"key": "B", "text": "知道有这回事，但没做", "score": 2},
            {"key": "C", "text": "第一次听说", "score": 0},
        ],
    },
    {
        "id": "q_interest_01",
        "dimension": "interest",
        "content": "如果可以选，你更想做哪种类型的工作？",
        "options": [
            {"key": "A", "text": "和技术/产品打交道，做出东西", "score": 3},
            {"key": "B", "text": "和人打交道，做沟通与组织", "score": 3},
            {"key": "C", "text": "和数据打交道，做分析与决策支持", "score": 3},
            {"key": "D", "text": "还不确定，都行", "score": 1},
        ],
    },
    {
        "id": "q_interest_02",
        "dimension": "interest",
        "content": "你对未来就业焦虑吗？",
        "options": [
            {"key": "A", "text": "非常焦虑，经常影响状态", "score": 3},
            {"key": "B", "text": "有点焦虑", "score": 2},
            {"key": "C", "text": "还好，走一步看一步", "score": 1},
            {"key": "D", "text": "不焦虑", "score": 1},
        ],
    },
    {
        "id": "q_interest_03",
        "dimension": "interest",
        "content": "做小组作业时，你通常是？",
        "options": [
            {"key": "A", "text": "牵头的人，负责分工和推进", "score": 3},
            {"key": "B", "text": "执行主力，把分配的任务做好", "score": 2},
            {"key": "C", "text": "查资料、写文档的人", "score": 2},
            {"key": "D", "text": "不太参与，能少做就少做", "score": 0},
        ],
    },
]

# 维度 -> 附录A 画像标签维度 的映射（用于把测试结果转成 profile_tags）
TEST_DIMENSION_TAG: Dict[str, str] = {
    "clarity": "认知",
    "action": "能力",
    "resume": "痛点",
    "interest": "兴趣",
}

# 每个分项在题库中的满分数值（用于把原始分折算到 0-100）
_DIMENSION_MAX: Dict[str, float] = {
    "clarity": sum(max(o["score"] for o in q["options"]) for q in TEST_QUESTION_BANK if q["dimension"] == "clarity"),
    "action": sum(max(o["score"] for o in q["options"]) for q in TEST_QUESTION_BANK if q["dimension"] == "action"),
    "resume": sum(max(o["score"] for o in q["options"]) for q in TEST_QUESTION_BANK if q["dimension"] == "resume"),
    "interest": sum(max(o["score"] for o in q["options"]) for q in TEST_QUESTION_BANK if q["dimension"] == "interest"),
}


# ---------------------------------------------------------------------------
# 11.2 基础测试表
# ---------------------------------------------------------------------------

def get_test_questions(db: Optional[Session] = None) -> List[TestQuestion]:
    """GET /test/questions：返回题库（骨架为内置占位题库）。

    TODO: 题库落库后改成从 DB 读（5.4 要求 30-50 题）。
    """
    return [
        TestQuestion(
            id=q["id"],
            dimension=q["dimension"],
            content=q["content"],
            options=[TestOption(**opt) for opt in q["options"]],
            multiple=False,
        )
        for q in TEST_QUESTION_BANK
    ]


def submit_test(db: Session, user: User, payload: TestSubmitRequest) -> TestResultResponse:
    """POST /test/submit：算分 → 写 test_results → 生成初始画像（11.3）。"""
    if not payload.answers:
        raise BusinessException(ErrorCode.PARAM_ERROR, "答案不能为空")

    scores = _score_answers(payload.answers)

    # 11.3：三个分项分数（clarity / action / resume）
    profile_scores = calc_profile_scores(scores["clarity"], scores["action"], scores["resume"])

    result = TestResult(
        user_id=user.id,
        answers=payload.answers,
        free_text=payload.free_text,
        clarity_score=float(profile_scores["clarity_score"]),
        action_score=float(profile_scores["action_score"]),
        resume_score=float(profile_scores["resume_score"]),
        total_score=float(profile_scores["total_score"]),
        stage=str(profile_scores["stage"]),
    )
    db.add(result)
    db.commit()
    db.refresh(result)

    # 写画像主表 + 阶段
    profile = get_or_create_profile(db, user.id)
    profile.clarity_score = float(profile_scores["clarity_score"])
    profile.action_score = float(profile_scores["action_score"])
    profile.resume_score = float(profile_scores["resume_score"])
    profile.total_score = float(profile_scores["total_score"])
    profile.stage = str(profile_scores["stage"])
    profile.updated_at = utcnow()
    db.add(profile)
    db.commit()

    # 选择题 -> 标签（11.3 第 1 步：选择题映射标签和分值）
    _apply_test_tags(db, user.id, payload.answers)

    # 11.2 第 4 步：文字补充交给 DeepSeek 抽标签（异步，需要时由调用方 await）
    if payload.free_text and payload.free_text.strip():
        logger.info("test free_text 已保存，等待 AI 抽取标签 user_id=%s", user.id)
        # TODO: 在异步上下文中调用 extract_tags_from_text（AIClient.chat_prompt_json）
        #       当前 router 为同步 route，实际接入时改为 async 并 await，见 README「待确认」。

    db.refresh(result)
    logger.info("测试提交完成 user_id=%s total=%s stage=%s", user.id, result.total_score, result.stage)
    return TestResultResponse.model_validate(result)


def get_test_result(db: Session, user: User) -> Optional[TestResultResponse]:
    """GET /test/result：取最近一次测试结果（用户没测过返回 None）。"""
    latest = get_latest_test_result(db, user.id)
    if latest is None:
        return None
    return TestResultResponse.model_validate(latest)


def get_latest_test_result(db: Session, user_id) -> Optional[TestResult]:
    """内部：最近一条 test_results。"""
    statement = (
        select(TestResult)
        .where(TestResult.user_id == user_id)
        .order_by(TestResult.created_at.desc())  # type: ignore[union-attr]
    )
    return db.exec(statement).first()


def _score_answers(answers: Dict[str, str]) -> Dict[str, float]:
    """按题库把选项折算成 0-100 的分项分。"""
    raw: Dict[str, float] = {"clarity": 0.0, "action": 0.0, "resume": 0.0, "interest": 0.0}
    for question in TEST_QUESTION_BANK:
        chosen = answers.get(question["id"])
        if not chosen:
            continue
        for option in question["options"]:
            if option["key"] == chosen:
                raw[question["dimension"]] += float(option["score"])
                break

    scaled: Dict[str, float] = {}
    for dimension, value in raw.items():
        maximum = _DIMENSION_MAX.get(dimension) or 0.0
        scaled[dimension] = clamp_score(100.0 * value / maximum) if maximum else 0.0
    return scaled


def _apply_test_tags(db: Session, user_id, answers: Dict[str, str]) -> None:
    """把选择题作答映射成画像标签（11.3）。骨架阶段只做两条最有信息量的规则。"""
    tags: List[Dict[str, Any]] = []

    # 规则 1：简历完整度低 -> 痛点“缺项目/无简历”
    resume_answer = answers.get("q_resume_01", "")
    if resume_answer in {"C", "D"}:
        tags.append({"dimension": "痛点", "label": "缺项目经历", "weight": 0.6, "source": "test"})

    # 规则 2：行动不足 -> 能力标签“行动力待提升”
    action_answer = answers.get("q_action_03", "")
    if action_answer in {"C", "D"}:
        tags.append({"dimension": "能力", "label": "行动力待提升", "weight": 0.5, "source": "test"})

    # 规则 3：焦虑程度
    anxiety = answers.get("q_interest_02", "")
    if anxiety == "A":
        tags.append({"dimension": "焦虑", "label": "高", "weight": 0.7, "source": "test"})
    elif anxiety == "B":
        tags.append({"dimension": "焦虑", "label": "中", "weight": 0.5, "source": "test"})

    # 规则 4：兴趣倾向
    interest_map = {"A": "技术/产品", "B": "沟通组织", "C": "数据分析"}
    interest_answer = answers.get("q_interest_01", "")
    if interest_answer in interest_map:
        tags.append({"dimension": "兴趣", "label": interest_map[interest_answer], "weight": 0.6, "source": "test"})

    if tags:
        apply_tags(db, user_id, tags)


# ---------------------------------------------------------------------------
# 画像读写
# ---------------------------------------------------------------------------

def get_or_create_profile(db: Session, user_id) -> Profile:
    """取画像主表，没有就建一条默认（懒创建）。"""
    profile = db.exec(select(Profile).where(Profile.user_id == user_id)).first()
    if profile is None:
        profile = Profile(user_id=user_id, stage=STAGE_EXPLORE)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


def get_profile(db: Session, user: User) -> ProfileResponse:
    """GET /profile：画像主表 + 标签 + 基础资料。"""
    from app.schemas.user import UserResponse

    profile = get_or_create_profile(db, user.id)
    tags = list_tags(db, user.id)
    response = ProfileResponse.model_validate(profile)
    response.tags = [ProfileTagResponse.model_validate(t) for t in tags]
    response.user = UserResponse.model_validate(user)
    return response


def list_tags(db: Session, user_id, dimension: Optional[str] = None) -> List[ProfileTag]:
    """GET /profile/tags：按维度可选过滤，权重降序。"""
    statement = select(ProfileTag).where(ProfileTag.user_id == user_id)
    if dimension:
        statement = statement.where(ProfileTag.dimension == dimension)
    statement = statement.order_by(ProfileTag.weight.desc())  # type: ignore[union-attr]
    return list(db.exec(statement).all())


def list_tags_response(db: Session, user_id, dimension: Optional[str] = None) -> List[ProfileTagResponse]:
    return [ProfileTagResponse.model_validate(t) for t in list_tags(db, user_id, dimension)]


def apply_tags(db: Session, user_id, tags: Sequence[Dict[str, Any]], source: Optional[str] = None) -> List[ProfileTag]:
    """7.8 画像回流入库：同维度同标签做权重融合。

    融合规则（骨架约定，见 README「待确认」）：
    - 已有标签：``new_weight = 0.6 * old + 0.4 * incoming``（新证据多则逐步抬高）
    - 新标签：直接写入
    - extra 合并保存 evidence，便于追溯来源
    """
    results: List[ProfileTag] = []
    for raw in tags or []:
        label = str(raw.get("label") or "").strip()
        if not label:
            continue
        dimension = str(raw.get("dimension") or "其他")
        weight = clamp01(raw.get("weight", 0.5))
        tag_source = str(raw.get("source") or source or "chat")

        existing = db.exec(
            select(ProfileTag).where(
                ProfileTag.user_id == user_id,
                ProfileTag.dimension == dimension,
                ProfileTag.label == label,
            )
        ).first()

        evidence = raw.get("evidence")
        if existing is None:
            existing = ProfileTag(
                user_id=user_id,
                dimension=dimension,
                label=label[:100],
                weight=weight,
                source=tag_source,
                extra={"evidence": evidence} if evidence else None,
            )
            db.add(existing)
        else:
            existing.weight = clamp01(0.6 * existing.weight + 0.4 * weight)
            existing.source = tag_source
            if evidence:
                extra = dict(existing.extra or {})
                extras = list(extra.get("evidence_log") or [])
                extras.append(str(evidence)[:500])
                extra["evidence_log"] = extras[-5:]
                existing.extra = extra
            existing.updated_at = utcnow()
            db.add(existing)
        results.append(existing)

    db.commit()
    for item in results:
        db.refresh(item)
    if results:
        recompute_stage(db, user_id)
    return results


def recompute_stage(db: Session, user_id) -> Profile:
    """重新计算画像分数与阶段（7.8 最后一步）。

    骨架实现：
    - clarity_score：沿用测试/最近一次的值（TODO：按标签质量重算）
    - action_score：已完成任务数 + 已完成步骤数 折算
    - resume_score：最新简历的 completeness/ats_score
    """
    profile = get_or_create_profile(db, user_id)

    # action：完成任务与打卡步骤
    completed_tasks = db.exec(
        select(Task).where(Task.user_id == user_id, Task.status == "已完成")
    ).all()
    task_ids = [t.id for t in completed_tasks]
    completed_steps = 0
    if task_ids:
        completed_steps = len(
            db.exec(
                select(TaskStep).where(TaskStep.task_id.in_(task_ids), TaskStep.completed.is_(True))  # type: ignore[union-attr]
            ).all()
        )
    action_score = clamp_score(min(100.0, 20.0 * len(completed_tasks) + 8.0 * completed_steps), 0.0, 100.0)

    # resume：最新简历的完整度
    latest_resume = db.exec(
        select(Resume).where(Resume.user_id == user_id).order_by(Resume.updated_at.desc())  # type: ignore[union-attr]
    ).first()
    resume_score = clamp_score(latest_resume.completeness or 0.0)

    total = calc_total_score(profile.clarity_score, action_score, resume_score)
    profile.action_score = action_score
    profile.resume_score = resume_score
    profile.total_score = total
    profile.stage = calc_stage(total)
    profile.updated_at = utcnow()
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update_resume_score(db: Session, user_id, completeness: float) -> Profile:
    """11.8 画像回流钩子：简历解析/优化后更新 resume_score 并重算阶段。"""
    profile = get_or_create_profile(db, user_id)
    profile.resume_score = clamp_score(completeness)
    profile.total_score = calc_total_score(profile.clarity_score, profile.action_score, profile.resume_score)
    profile.stage = calc_stage(profile.total_score)
    profile.updated_at = utcnow()
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def feedback(db: Session, user: User, payload: ProfileFeedbackRequest) -> ProfileResponse:
    """POST /profile/feedback：用户对标签的认可/否定。

    - 不认可：权重打折（*0.5），并标记 extra.user_approved=False
    - 认可：权重上调（上限 1.0），标记 extra.user_approved=True
    - 不带 tag_id 时视为整体反馈，只记录日志（TODO：落 reports 表）
    """
    if payload.tag_id is not None:
        tag = db.get(ProfileTag, payload.tag_id)
        if tag is None or tag.user_id != user.id:
            raise BusinessException(ErrorCode.NOT_FOUND, "标签不存在")
        extra = dict(tag.extra or {})
        extra["user_approved"] = bool(payload.approved)
        if payload.comment:
            extra["user_comment"] = payload.comment[:500]
        tag.extra = extra
        tag.weight = clamp01(tag.weight * 1.1 if payload.approved else tag.weight * 0.5)
        tag.updated_at = utcnow()
        db.add(tag)
        db.commit()
    else:
        logger.info("整体画像反馈 user_id=%s approved=%s", user.id, payload.approved)
        # TODO: 写入 reports(type="profile_feedback")，手册未定义该报告类型，见 README「待确认」

    recompute_stage(db, user.id)
    return get_profile(db, user)


def top_pain_points(db: Session, user_id, limit: int = 3) -> List[str]:
    """11.5：从画像标签中挑痛点，供任务生成使用。"""
    tags = db.exec(
        select(ProfileTag)
        .where(ProfileTag.user_id == user_id, ProfileTag.dimension == "痛点")
        .order_by(ProfileTag.weight.desc())  # type: ignore[union-attr]
    ).all()
    return [t.label for t in tags][:limit]


def get_stage(db: Session, user_id) -> str:
    """取当前阶段（供 Prompt 变量使用）。"""
    profile = db.exec(select(Profile).where(Profile.user_id == user_id)).first()
    if profile is None:
        return STAGE_EXPLORE
    if profile.stage not in {STAGE_EXPLORE, STAGE_PREPARE, STAGE_SPRINT}:
        return STAGE_EXPLORE
    return profile.stage


def serialize_tags(tags: Iterable[ProfileTag]) -> List[Dict[str, Any]]:
    """把标签转成 Prompt 变量用的简化结构。"""
    return [
        {"dimension": t.dimension, "label": t.label, "weight": round(t.weight, 2)}
        for t in tags
    ]


def clamp01(value: Any, default: float = 0.5) -> float:
    """权重收敛到 [0,1]。"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, number))


# ---------------------------------------------------------------------------
# 7.8 画像回流：从文本/对话抽取标签（异步，调用 DeepSeek）
# ---------------------------------------------------------------------------

async def extract_tags_from_text(
    db: Session,
    user_id,
    text: str,
    source: str = "chat",
) -> List[Dict[str, Any]]:
    """7.8 钩子：把一段文本交给 ``profile_extract`` Prompt，抽标签并入库。

    调用点（骨架已预留）：
    - ``chat_service.stream_reply``：每轮对话结束后
    - ``resume_service.parse_uploaded_resume`` / ``optimize_resume``：简历解析与优化后
    - ``interview_service.finish_interview``：面试复盘后（由复盘结果直接带 tags）
    - ``task_service.complete_step``：打卡反馈后
    - ``daily_question_service.answer_question``：累计 7 题后

    失败时返回空列表（7.6 兜底），绝不打断主流程。
    """
    from app.ai import deepseek_client
    from app.ai.schemas import ProfileExtractResult, empty_profile_extract
    from app.utils.logger import sanitize

    if not text or not text.strip():
        return []

    try:
        result = await deepseek_client.chat_prompt_json(
            prompt_name="profile_extract",
            variables={"history": text, "last_user_message": text[-200:]},
            schema=ProfileExtractResult,
            default=empty_profile_extract(),
        )
    except Exception as exc:  # noqa: BLE001 - 兜底：画像抽取失败不影响主流程
        logger.warning("画像抽取失败 user_id=%s err=%s", user_id, sanitize(exc))
        return []

    payload = [
        {
            "dimension": tag.dimension,
            "label": tag.label,
            "weight": tag.weight,
            "evidence": tag.evidence,
            "source": source,
        }
        for tag in result.tags
    ]
    if not payload:
        return []
    apply_tags(db, user_id, payload, source=source)
    logger.info("画像回流成功 user_id=%s source=%s tags=%s", user_id, source, len(payload))
    return payload
