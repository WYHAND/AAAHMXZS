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
from app.models.conversation import Conversation, Message
from app.models.profile import Profile, ProfileTag
from app.models.resume import Resume
from app.models.task import Task, TaskStep
from app.models.test import TestQuestion, TestResult
from app.models.user import User, utcnow
from app.schemas.profile import ProfileFeedbackRequest, ProfileResponse, ProfileTagResponse
from app.schemas.test import TestOption, TestQuestionResponse, TestResultResponse, TestSubmitRequest
from app.utils.logger import get_logger, sanitize
from app.utils.stage import (
    STAGE_EXPLORE,
    STAGE_PREPARE,
    STAGE_SPRINT,
    calc_profile_scores,
    calc_stage,
    calc_total_score,
    clamp_score,
)
from app.utils.text import normalize_for_match

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# 题库来源（重要变更）
#
# 手册 5.4 要求"基础测试题 30-50 题"，早期骨架把题目硬编码在本模块的
# TEST_QUESTION_BANK 常量里，结果出现"接口有数据、数据库里空着"的假象：
#   - 库里 test_questions 表 0 行，GET /test/questions 却返回 11 道题；
#   - 前端拿常量里的题作答，提交后 test_results 落库，但题库本身查不到。
# 现在题库**真正落库**（app/db/seed_data.py::TEST_QUESTIONS，由
# `python -m app.db.init_db` 灌入 test_questions 表），本模块只从 DB 读。
# 维度含义：clarity=职业目标清晰度、action=求职行动进度、
#          resume=简历完整度、interest=兴趣倾向
# ---------------------------------------------------------------------------

# 维度 -> 附录A 画像标签维度 的映射（用于把测试结果转成 profile_tags）
TEST_DIMENSION_TAG: Dict[str, str] = {
    "clarity": "认知",
    "action": "能力",
    "resume": "痛点",
    "interest": "兴趣",
}


# ---------------------------------------------------------------------------
# 11.2 基础测试表
# ---------------------------------------------------------------------------

def load_test_bank(db: Session) -> List[TestQuestion]:
    """从数据库读题库（``test_questions`` 表），按 ``order_no`` 展示序。

    返回 ORM 行（不是接口 schema），因为提交计分时要读 ``options`` / ``dimension``。
    """
    statement = select(TestQuestion).order_by(
        TestQuestion.order_no.asc(), TestQuestion.code.asc()  # type: ignore[union-attr]
    )
    return list(db.exec(statement).all())


def get_test_questions(db: Optional[Session] = None) -> List[TestQuestionResponse]:
    """GET /test/questions：从**数据库**返回题库（手册 5.4 要求 30-50 题）。

    题库为空时返回空列表（不再用代码常量假装有数据）；前端应据此提示
    "题库未初始化，请先运行 python -m app.db.init_db"。
    """
    if db is None:
        # 没有会话就没法读库：返回空列表而不是造数据（避免再次出现"接口有数据、库里没有"）
        logger.warning("get_test_questions 未传 db，返回空题库")
        return []
    return [
        TestQuestionResponse(
            id=row.code,  # 对外用业务编号（q_clarity_01），稳定且便于规则引用
            dimension=row.dimension,
            content=row.content,
            options=[TestOption(**opt) for opt in (row.options or [])],
            multiple=bool(row.multiple),
        )
        for row in load_test_bank(db)
    ]


async def submit_test(db: Session, user: User, payload: TestSubmitRequest) -> TestResultResponse:
    """POST /test/submit：算分 → 写 test_results → 生成初始画像（11.3）→ 文字补充抽标签（7.8）。

    **原子性**：算分到落库这一段（写 ``test_results`` + 写 ``profiles`` + 写 ``profile_tags``）
    在**一个事务**里完成，任何一步失败都整体回滚。
    之前每步各自 ``commit``，实测出现过"接口返回 500，但 ``tested`` 已变 true、
    标签已落库"的半成品状态 —— 用户看到失败、重试又会产生重复的 ``test_results``。

    **响应一致性**：返回的分数/总分/阶段取自**重算并落库后的 profile**，
    因此与随后 ``GET /profile`` 逐字段一致。
    之前返回的是"测试原始分"（新用户可能是 clarity/action/resume 全 100、冲刺期），
    而 ``GET /profile`` 是"按实际行为重算过的"（没有任务与简历就是 0），两处打架。

    **为什么是 ``async def``**：11.2 第 4 步要把 ``free_text`` 交给
    ``extract_tags_from_text()``（AI 抽取，必须 await）。该调用放在
    **提交事务之后**，所以抽标签不是这个事务的一部分：

    - AI 失败（无 Key / 401 / 超时 / 返回不是 JSON）由
      ``extract_tags_from_text`` 内部兜底成空列表（照 ``daily_question_service`` 的写法），
      **提交照样成功**，只是画像里少几条标签 —— 抽标签是加分项，不是提交的前提；
    - ``free_text`` 为空/全空白直接短路，省一次 AI 调用；
    - 这一段只会**新增/融合 ``profile_tags``**：``recompute_stage()`` 的
      ``clarity_score`` 是沿用值（见该函数注释），所以分数与阶段口径不变。
    """
    if not payload.answers:
        raise BusinessException(ErrorCode.PARAM_ERROR, "答案不能为空")

    bank = load_test_bank(db)
    if not bank:
        raise BusinessException(
            ErrorCode.PARAM_ERROR,
            "题库为空，请先执行 `python -m app.db.init_db` 初始化基础测试题",
        )

    scores = _score_answers(bank, payload.answers)
    if scores["matched"] == 0:
        raise BusinessException(ErrorCode.PARAM_ERROR, "答案里没有任何已知题目，请重新获取题目后再提交")

    try:
        # 1) 测试结果先入库（分数稍后用重算后的画像值覆盖，保证三处一致）
        result = TestResult(
            user_id=user.id,
            answers=payload.answers,
            free_text=payload.free_text,
        )
        db.add(result)
        db.flush()

        # 2) 画像：clarity 用测试分（它就是"职业目标清晰度"的直接测量），
        #    action / resume 由 recompute_stage 按真实行为算（没有任务/简历就是 0）。
        profile = get_or_create_profile(db, user.id, commit=False)
        profile.clarity_score = float(scores["clarity"])
        profile.updated_at = utcnow()
        db.add(profile)
        db.flush()

        # 3) 选择题 -> 画像标签（11.3 第 1 步）；这里不触发重算，最后统一重算一次
        _apply_test_tags(db, user.id, payload.answers)

        # 4) 重算画像（action/resume/total/stage）并落库
        profile = recompute_stage(db, user.id, commit=False)

        # 5) 把**落库后的画像值**写回 test_results，使 响应 == 本行 == GET /profile
        result.clarity_score = profile.clarity_score
        result.action_score = profile.action_score
        result.resume_score = profile.resume_score
        result.total_score = profile.total_score
        result.stage = profile.stage
        db.add(result)

        # 6) 唯一一次提交：要么全部生效，要么全部回滚
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(result)
    response = TestResultResponse.model_validate(result)

    # 11.2 第 4 步：文字补充交给 DeepSeek 抽标签（7.8 画像回流，source="test"）。
    # 放在 commit 之后 = 与上面那个事务解耦：抽标签失败绝不能让"已经提交成功的测评"变成失败。
    if payload.free_text and payload.free_text.strip():
        try:
            extracted = await extract_tags_from_text(db, user.id, payload.free_text, source="test")
            logger.info("测试文字补充抽标签完成 user_id=%s tags=%s", user.id, len(extracted))
        except Exception as exc:  # noqa: BLE001 - 兜底：抽标签异常不影响已提交的测评
            logger.warning("测试文字补充抽标签异常（已忽略，不影响提交）user_id=%s err=%s", user.id, sanitize(exc))
    else:
        # 空/全空白：不调 AI（省一次调用）
        logger.info("测试文字补充为空，跳过 AI 抽标签 user_id=%s", user.id)

    logger.info(
        "测试提交完成 user_id=%s clarity=%s action=%s resume=%s total=%s stage=%s",
        user.id, response.clarity_score, response.action_score,
        response.resume_score, response.total_score, response.stage,
    )
    return response


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


def _score_answers(bank: Sequence[TestQuestion], answers: Dict[str, str]) -> Dict[str, float]:
    """按**数据库题库**把选项折算成 0-100 的分项分。

    返回 ``{"clarity":..., "action":..., "resume":..., "interest":..., "matched": int}``，
    其中 ``matched`` 是命中的题目数 —— 调用方用它判断"答案里到底有没有有效题目"
    （全部无效时应该报 1001，而不是静默给 0 分写库）。
    """
    raw: Dict[str, float] = {"clarity": 0.0, "action": 0.0, "resume": 0.0, "interest": 0.0}
    max_map: Dict[str, float] = {"clarity": 0.0, "action": 0.0, "resume": 0.0, "interest": 0.0}
    matched = 0

    for question in bank:
        options = question.options or []
        if question.dimension in max_map and options:
            # 该题满分 = 选项里的最高分（题库里每题满分都是 5）
            max_map[question.dimension] += max(float(o.get("score") or 0.0) for o in options)

        chosen = answers.get(question.code)
        if not chosen:
            continue
        for option in options:
            if str(option.get("key")) == str(chosen):
                if question.dimension in raw:
                    raw[question.dimension] += float(option.get("score") or 0.0)
                matched += 1
                break

    scaled: Dict[str, float] = {}
    for dimension, value in raw.items():
        maximum = max_map.get(dimension) or 0.0
        scaled[dimension] = clamp_score(100.0 * value / maximum) if maximum else 0.0
    scaled["matched"] = float(matched)
    return scaled


def _apply_test_tags(db: Session, user_id, answers: Dict[str, str]) -> None:
    """把选择题作答映射成画像标签（11.3 第 1 步）。

    只做最有信息量的几条规则；``commit=False`` + ``recompute=False``
    是因为调用方（``submit_test``）要在最后统一重算并只提交一次。

    ⚠️ 规则引用的四个 code（``q_resume_01`` / ``q_action_03`` / ``q_interest_01`` /
    ``q_interest_02``）在 ``app/db/seed_data.py`` 的题库里必须存在，改题库时不要动。
    """
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
        apply_tags(db, user_id, tags, commit=False, recompute=False)


# ---------------------------------------------------------------------------
# 画像读写
# ---------------------------------------------------------------------------

def get_or_create_profile(db: Session, user_id, *, commit: bool = True) -> Profile:
    """取画像主表，没有就建一条默认（懒创建）。

    ``commit=False`` 时只 ``flush`` 不提交，供需要**跨多步原子写**的调用方使用
    （例如 ``submit_test``：写 test_results + profiles + profile_tags 必须同一个事务）。
    """
    profile = db.exec(select(Profile).where(Profile.user_id == user_id)).first()
    if profile is None:
        profile = Profile(user_id=user_id, stage=STAGE_EXPLORE)
        db.add(profile)
        if commit:
            db.commit()
            db.refresh(profile)
        else:
            db.flush()
    return profile


def has_finished_test(db: Session, user_id) -> bool:
    """该用户是否做过基础测试表（`test_results` 是否存在记录）。

    ⚠️ 前端判断「用户做没做过测评」必须用这个值（``ProfileResponse.tested``），
    **不能**看画像对象是否存在 —— ``get_or_create_profile`` 会懒创建，
    画像存在 ≠ 做过测评，否则「新用户强制去 /test/intro」的漏斗永远不会触发。

    只取一列做 ``LIMIT 1``，避免把整行拉回来（也避免 N+1：调用方一次算好复用）。
    """
    statement = select(TestResult.id).where(TestResult.user_id == user_id).limit(1)
    return db.exec(statement).first() is not None


def get_profile(db: Session, user: User) -> ProfileResponse:
    """GET /profile：画像主表 + 标签 + 基础资料 + 是否做过测评。"""
    from app.schemas.user import UserResponse

    profile = get_or_create_profile(db, user.id)
    tags = list_tags(db, user.id)
    response = ProfileResponse.model_validate(profile)
    response.tested = has_finished_test(db, user.id)
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


def apply_tags(
    db: Session,
    user_id,
    tags: Sequence[Dict[str, Any]],
    source: Optional[str] = None,
    *,
    commit: bool = True,
    recompute: bool = True,
) -> List[ProfileTag]:
    """7.8 画像回流入库：同维度同标签做权重融合。

    ``commit=False`` / ``recompute=False`` 供**跨多步原子写**的调用方使用：
    ``submit_test`` 会在最后统一重算 + 只提交一次（见那里的说明）。

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

    if commit:
        db.commit()
        for item in results:
            db.refresh(item)
    else:
        db.flush()

    if results and recompute:
        recompute_stage(db, user_id, commit=commit)
    return results


def recompute_stage(db: Session, user_id, *, commit: bool = True) -> Profile:
    """重新计算画像分数与阶段（7.8 最后一步 / 11.6 打卡后更新）。

    实现：
    - ``clarity_score``：沿用测试/最近一次的值（TODO：按标签质量重算）
    - ``action_score``：**所有任务**的已完成步骤 + 已完成任务数 折算
    - ``resume_score``：最新简历的 completeness

    ⚠️ ``action_score`` 为什么把**进行中任务**的已完成步骤也算进去：
    手册 11.6 的闭环是"完成任务步骤 → 打卡 → 更新画像"，行动力应该由**行动本身**
    累积，而不是等整个任务做完才给分。原实现只统计 ``status == "已完成"`` 的任务，
    实测出现"用户打了卡、进度条前进，但 action_score 仍是 0.0"——
    用户看不到任何正反馈，与 11.6 的意图相反。
    所以现在分两部分：① 每个已完成步骤 +8（无论任务是否结束）；
    ② 每个**整个完成**的任务额外 +20（把"有始有终"与"只是动了一下"区分开）。
    """
    profile = get_or_create_profile(db, user_id, commit=commit)

    # ① 全部任务的已完成步骤（含进行中任务的）—— 行动力来自行动本身
    all_tasks = db.exec(select(Task).where(Task.user_id == user_id)).all()
    all_task_ids = [t.id for t in all_tasks]
    completed_steps = 0
    if all_task_ids:
        completed_steps = len(
            db.exec(
                select(TaskStep).where(
                    TaskStep.task_id.in_(all_task_ids),  # type: ignore[union-attr]
                    TaskStep.completed.is_(True),  # type: ignore[union-attr]
                )
            ).all()
        )

    # ② 整单完成的任务（额外奖励，区分"有始有终"）
    completed_tasks = [t for t in all_tasks if t.status == "已完成"]

    action_score = clamp_score(
        min(100.0, 20.0 * len(completed_tasks) + 8.0 * completed_steps), 0.0, 100.0
    )

    # resume：最新简历的完整度
    # ⚠️ 新用户**必然没有简历**，latest_resume 就是 None。
    # 这里曾经写成 `latest_resume.completeness or 0.0`，导致「新用户提交测评」
    # 直接 500（AttributeError: 'NoneType' object has no attribute 'completeness'），
    # 也就是 M1 主链路对所有人都是坏的 —— 实测跑通注册→测评时才发现。
    latest_resume = db.exec(
        select(Resume).where(Resume.user_id == user_id).order_by(Resume.updated_at.desc())  # type: ignore[union-attr]
    ).first()
    resume_score = clamp_score(latest_resume.completeness or 0.0) if latest_resume is not None else 0.0

    total = calc_total_score(profile.clarity_score, action_score, resume_score)
    profile.action_score = action_score
    profile.resume_score = resume_score
    profile.total_score = total
    profile.stage = calc_stage(total)
    profile.updated_at = utcnow()
    db.add(profile)

    if commit:
        db.commit()
        db.refresh(profile)
    else:
        db.flush()
    logger.info(
        "画像重算 user_id=%s clarity=%.1f action=%.1f(步骤=%s/完成任务=%s) resume=%.1f total=%.1f stage=%s",
        user_id, profile.clarity_score, action_score,
        completed_steps, len(completed_tasks), resume_score, total, profile.stage,
    )
    return profile


def update_resume_score(db: Session, user_id, completeness: float, *, commit: bool = True) -> Profile:
    """11.8 画像回流钩子：简历解析/优化后更新 resume_score 并重算阶段。"""
    profile = get_or_create_profile(db, user_id, commit=commit)
    profile.resume_score = clamp_score(completeness)
    profile.total_score = calc_total_score(profile.clarity_score, profile.action_score, profile.resume_score)
    profile.stage = calc_stage(profile.total_score)
    profile.updated_at = utcnow()
    db.add(profile)
    if commit:
        db.commit()
        db.refresh(profile)
    else:
        db.flush()
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
    """取当前阶段，返回**中文**阶段名（数据库原值：探索期/准备期/冲刺期）。

    本函数是给**服务端内部**用的（主要用途是拼 Prompt 变量，Prompt 里写的是中文），
    **不要**把它的返回值直接塞进对外 schema。对外接口必须用
    ``app.utils.stage.to_stage_slug()`` 转 slug，或在 schema 层由
    ``_normalize_stage`` 校验器自动转换（README §4.11）。
    """
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

    ⚠️⚠️ **``text`` 必须只包含"用户自己写的东西"**（本期踩过的坑，别再踩）：

    ``ProfileTag.extra.evidence`` 的语义是**用户原话**，服务端读侧会拿它去
    ``messages.role='user'`` 里做子串核对（见 :func:`evidence_for_tags`）。
    曾经 ``chat_service._extract_round_tags`` 传进来的是
    ``build_history_text(最近 8 条消息)`` 拼出来的**整段 transcript**（"学生：… / AI：…"
    都在一起），于是模型把 **AI 自己说过的话**当成用户原话写进了 evidence，真实脏数据：

    - 能力/学习 <- ``会Java和C，说明你编程底子不算白纸``（AI 的话）
    - 兴趣/产品 <- ``AI：你之前提过对技术/产品有点兴趣``（AI 的话，连 ``AI：`` 前缀都在）
    - 痛点/缺项目 <- ``有没有做过完整的小项目？``（AI 的提问）
    - 焦虑/中 <- ``比空焦虑强多了``（AI 的安慰）

    后果是把这种"原话"喂给模型时，它会说「你上次说'有没有做过完整的小项目？'」——
    **把 AI 的话安到用户头上**，正是用户明令禁止的那类杜撰（只是形式更隐蔽）。
    所以：**对话路径只传用户侧文本**；本函数对 ``source="chat"`` 会自己做一次兜底
    （见下面 ``_user_side_text``），即使调用方哪天又传了整段 transcript 也不会污染画像。
    测评文字补充/每日一答/任务反馈这些调用点传进来的本来就是用户写的那一段，不受影响。

    失败时返回空列表（7.6 兜底），绝不打断主流程。
    """
    from app.ai import deepseek_client
    from app.ai.schemas import ProfileExtractResult, empty_profile_extract
    from app.utils.logger import sanitize

    if not text or not text.strip():
        return []

    extract_input = _user_side_text(db, user_id, text, source)

    try:
        result = await deepseek_client.chat_prompt_json(
            prompt_name="profile_extract",
            variables={"history": extract_input, "last_user_message": extract_input[-200:]},
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


# ---------------------------------------------------------------------------
# 证据归属：evidence 只能是"用户自己说过的话"（写入端防不住历史脏数据，读侧再机械过滤）
# ---------------------------------------------------------------------------
#
# 为什么读侧还要再来一道：**历史脏数据无法追溯来源**。上表中那 4 条（AI 的话 / AI 的提问 /
# AI 的安慰）在库里已经躺着了，改写入端只能保证"以后不再产生"。而只要它们被喂进 Prompt，
# 模型就会回述成"你上次说……"，用户看到的就是杜撰。所以所有**准备进 Prompt 的 evidence**
# 都必须先过 :func:`evidence_for_tags`：要求它能在**该用户自己发过的消息**里原样找到。
#
# 判据刻意只认 ``messages.role='user'``：
# - 对话路径：用户消息就是 messages 表里的 user 行；
# - 测评文字补充 / 每日一答 / 任务反馈：确实是用户写的，但存在别的表（test_results.free_text
#   / daily_answers.answer / task_steps.feedback）。它们**不在本函数的认可范围内** ——
#   宁可漏掉（标签照旧只给标签，开场白退化成聊标签本身）也不放宽：真实库里这三类
#   ``free_text`` 全是 NULL、每日一答只有 4 条，放宽换不来可引用原话，却会重新打开
#   "非用户消息也能当证据"的口子。
# - 测评/每日一答/任务来源的标签目前**没有一条**带 evidence，本过滤对它们是无操作。

# 读侧过滤时最多扫多少条用户消息。用户每天都在聊，全表扫没有意义；
# 最近的 2000 条足以覆盖任何还没被删掉的 evidence（真被删掉的会话本就不该再被引用）。
EVIDENCE_POOL_MESSAGE_LIMIT = 2000

# 对话路径重新取用户消息时的条数上限（比 chat_service.HISTORY_LIMIT 宽，
# 因为这里只为了"给抽取模型足够的用户原话"，不占用发给对话模型的 token 预算）。
CONVERSATION_USER_TEXT_LIMIT = 200


def _user_side_text(db: Session, user_id, text: str, source: str) -> str:
    """把**准备喂给抽取 Prompt 的文本**收敛到"用户侧"（对话路径专用兜底）。

    为什么需要它：``chat_service._extract_round_tags`` 曾经拼的是整段 transcript
    （``build_history_text`` 把 ``学生：…`` 和 ``AI：…`` 写在一起），模型于是把 AI 的
    提问/安慰当成了用户原话（见 :func:`extract_tags_from_text` 的脏数据清单）。

    现在的做法（**只有对话来源才动**，其它来源传进来的本来就是用户写的那一段）：

    - ``source == "chat"``：直接从库里取该用户**全部** ``role='user'`` 消息，按时间正序
      拼成"学生：…"多行文本。**AI 的话一个字都不进去**，模型没有可误解的材料。
      刻意从库里取而不是解析调用方传进来的字符串：字符串形态千变万化
      （``build_history_text`` 的转义、有人把 ``【最近一轮】`` 拼进来），
      按 ``AI：`` 做正则切分迟早会漏；从库里取是"只可能包含用户写的字"这一件事的
      唯一可靠实现。
    - 其它来源（test / daily / task / resume / interview）：原样使用调用方给的文本，
      它们是"用户在某个表单里写的那一段"（``payload.free_text`` / ``payload.answer`` /
      ``feedback``），本来就是用户侧内容。
    - 库里一条用户消息都没有（极端：消息刚被删）时退回原文本 —— 宁可让模型看到
      调用方给的文本（抽出来的 evidence 之后照样要过读侧过滤），也不要空跑一次 AI。
    """
    if source != "chat":
        return text

    rows = db.exec(
        select(Message.content)
        .join(Conversation, Message.conversation_id == Conversation.id)  # type: ignore[arg-type]
        .where(Conversation.user_id == user_id, Message.role == "user")
        .order_by(Message.created_at.asc(), Message.id.asc())  # type: ignore[union-attr]
        .limit(CONVERSATION_USER_TEXT_LIMIT)
    ).all()
    lines = [f"学生：{(row or '').strip()}" for row in rows if row and row.strip()]
    if not lines:
        logger.warning(
            "对话路径没取到任何用户消息，退回调用方文本（evidence 仍会被读侧过滤）user_id=%s",
            user_id,
        )
        return text
    return "\n".join(lines)


def _user_messages(db: Session, user_id, exclude_conversation_id=None) -> List[str]:
    """取该用户**自己发的**消息正文（新的在前，已去掉空串）。

    ``exclude_conversation_id``：把某个会话排除在外（当前会话自己会另走"最近 N 条"注入，
    重复给没有收益，还会让 evidence 变成"刚说过的话"）。
    """
    statement = (
        select(Message.content)
        .join(Conversation, Message.conversation_id == Conversation.id)  # type: ignore[arg-type]
        .where(Conversation.user_id == user_id, Message.role == "user")
    )
    if exclude_conversation_id is not None:
        statement = statement.where(Message.conversation_id != exclude_conversation_id)
    statement = statement.order_by(
        Message.created_at.desc(), Message.id.desc()  # type: ignore[union-attr]
    ).limit(EVIDENCE_POOL_MESSAGE_LIMIT)
    return [text for text in db.exec(statement).all() if text and text.strip()]


def _evidence_pool(db: Session, user_id, exclude_conversation_id=None) -> List[str]:
    """把用户消息归一化成"证据比对池"（见 ``app.utils.text.normalize_for_match``）。"""
    return [normalize_for_match(text) for text in _user_messages(db, user_id, exclude_conversation_id)]


def evidence_for_tags(
    db: Session,
    user_id,
    tags: Sequence[ProfileTag],
    *,
    exclude_conversation_id=None,
    pool: Optional[List[str]] = None,
) -> Dict[Any, str]:
    """挑出每个标签**唯一一条**可引用的用户原话（找不到就不返回这个标签）。

    返回 ``{tag.id: 原话}``。命中规则：``extra["evidence"]`` 归一化后必须是某条
    用户消息的子串（对话路径下"用户消息"= ``messages.role='user'``）。

    - **只认 ``extra["evidence"]``，不认 ``extra["evidence_log"]``**：后者是历次追加的
      证据流水（``apply_tags`` 保留最近 5 条），里面混着大量 AI 措辞的改写
      （实测 ``用 Java 或 C 写个命令行版`` / ``现在突然不想搞了`` 都只是**模型对用户原话的
      转述**，用户自己打的是别的话）。首条 evidence 是模型当时"最像原话"的那一条，
      过不了过滤就说明这个标签本来就没有可引用的原话 —— 那就只给标签，不许编。
    - 过不了的 evidence **一律丢弃并留痕**（``logger.info`` 一条汇总 + 每条一条 debug），
      带上 user_id / 标签 / 被丢弃的片段，便于回头查是哪来的脏数据。
      **本函数不改任何历史数据**（只读）。

    ⚠️ ``pool`` 参数只是给批量调用省一次查询（同一批标签共用同一个池）。
    """
    evidence_pool = pool if pool is not None else _evidence_pool(db, user_id, exclude_conversation_id)

    found: Dict[Any, str] = {}
    dropped: List[str] = []
    for tag in tags:
        raw = str((tag.extra or {}).get("evidence") or "").strip()
        if not raw:
            continue
        key = normalize_for_match(raw)
        if key and any(key in message for message in evidence_pool):
            found[tag.id] = raw
        else:
            dropped.append(f"{tag.dimension}/{tag.label} <- {raw[:40]!r}")

    if dropped:
        # 汇总一条 INFO（"这个用户本轮有多少条证据被挡了"一眼可见）+ 逐条 DEBUG
        logger.info(
            "证据过滤：user_id=%s 丢弃 %s 条无法在用户消息里原样找到的 evidence"
            "（不进 Prompt，也不改库）",
            user_id, len(dropped),
        )
        for item in dropped:
            logger.debug("证据过滤明细：user_id=%s %s", user_id, item)
    return found

