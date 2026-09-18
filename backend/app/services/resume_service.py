"""简历生成/优化业务逻辑（手册 11.8、13.x、7.8、附录F）。

画像回流钩子：``parse_uploaded_resume`` / ``optimize_resume`` 都会调用
``profile_service.update_resume_score`` 与 ``profile_service.extract_tags_from_text``。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import STRUCTURED_TEMPERATURE
from app.ai.parser import extract_json
from app.ai.schemas import (
    JOB_KEYWORDS,
    ResumeOptimizeResult,
    ResumeParsed,
    empty_resume_optimize,
    empty_resume_parsed,
)
from app.core.errors import BusinessException, ErrorCode, not_found_unless_owner
from app.models.resume import Resume
from app.models.user import User, utcnow
from app.schemas.resume import (
    ResumeCreate,
    ResumeOptimizeRequest,
    ResumeOptimizeResponse,
    ResumeResponse,
    ResumeUpdate,
)
from app.services import profile_service
from app.utils import file as file_utils
from app.utils.logger import get_logger, sanitize
from app.utils.text import top_keywords

logger = get_logger(__name__)


@dataclass
class ResumeFile:
    """可下载的简历文件（服务层 -> 路由层的纯数据，路由用 FileResponse 返回）。"""

    path: Path
    filename: str
    media_type: str
    size: int = 0


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def list_resumes(db: Session, user: User) -> List[ResumeResponse]:
    """GET /resume：我的简历列表。"""
    statement = (
        select(Resume)
        .where(Resume.user_id == user.id)
        .order_by(Resume.updated_at.desc())  # type: ignore[union-attr]
    )
    return [ResumeResponse.model_validate(r) for r in db.exec(statement).all()]


def get_resume(db: Session, user: User, resume_id: UUID) -> Resume:
    """取当前用户自己的简历（14.5）。

    **「不存在」与「不属于自己」都返回 2001**（项目级编码规则，见 README §8 与
    ``app.core.errors.not_found_unless_owner``）：用 1003 区分会变成可枚举的 oracle。
    本函数服务于 ``GET/PUT /resume/{id}``、``/{id}/optimize``、``/{id}/report``、
    ``/{id}/file`` —— 四个端点行为完全一致。
    """
    return not_found_unless_owner(db.get(Resume, resume_id), user.id, "简历不存在")


def get_resume_detail(db: Session, user: User, resume_id: UUID) -> ResumeResponse:
    """GET /resume/{id}。"""
    return ResumeResponse.model_validate(get_resume(db, user, resume_id))


def create_resume(db: Session, user: User, payload: ResumeCreate) -> ResumeResponse:
    """POST /resume：引导式生成的五步表单结果入库（11.8）。"""
    resume = Resume(
        user_id=user.id,
        title=payload.title,
        target_job=payload.target_job,
        parsed_data=payload.parsed_data,
        completeness=_guess_completeness(payload.parsed_data),
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)

    # 11.8 画像回流：先按表单内容估算完整度
    profile_service.update_resume_score(db, user.id, resume.completeness or 0.0)
    return ResumeResponse.model_validate(resume)


def update_resume(db: Session, user: User, resume_id: UUID, payload: ResumeUpdate) -> ResumeResponse:
    """PUT /resume/{id}。"""
    resume = get_resume(db, user, resume_id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(resume, key, value)
    if payload.parsed_data is not None:
        resume.completeness = _guess_completeness(payload.parsed_data)
    resume.updated_at = utcnow()
    db.add(resume)
    db.commit()
    db.refresh(resume)

    profile_service.update_resume_score(db, user.id, resume.completeness or 0.0)
    return ResumeResponse.model_validate(resume)


# ---------------------------------------------------------------------------
# 上传解析（13.1 / 13.3 / 7.4 resume_parse）
# ---------------------------------------------------------------------------

async def parse_uploaded_resume(
    db: Session,
    user: User,
    filename: str,
    content: bytes,
    content_type: Optional[str] = None,
    title: Optional[str] = None,
    target_job: Optional[str] = None,
) -> ResumeResponse:
    """POST /resume/upload：存盘 -> 抽文本 -> DeepSeek 结构化 -> 入库。

    13.4：解析失败时抛 ``BusinessException``，前端据此提示切换引导式生成。
    """
    ext = file_utils.validate_upload(filename, len(content), content_type)
    absolute_path, relative_path = file_utils.build_resume_path(user.id, ext)
    file_utils.save_bytes(absolute_path, content)

    text = file_utils.extract_text_from_file(absolute_path)

    parsed: ResumeParsed = await deepseek_client.chat_prompt_json(
        prompt_name="resume_parse",
        variables={"resume_text": text[:12000], "target_job": target_job or ""},
        schema=ResumeParsed,
        default=empty_resume_parsed(),
        temperature=STRUCTURED_TEMPERATURE,
    )

    parsed_data = parsed.model_dump()
    resume = Resume(
        user_id=user.id,
        title=title or file_utils.safe_filename(filename) or "我的简历",
        file_path=str(relative_path),
        target_job=target_job or parsed.basics.target_job,
        parsed_data=parsed_data,
        completeness=round(parsed.completeness * 100, 1),
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)

    # 7.8 画像回流：简历解析结果 -> resume_score + 标签
    profile_service.update_resume_score(db, user.id, resume.completeness or 0.0)
    await _extract_resume_tags(db, user.id, parsed_data)

    return ResumeResponse.model_validate(resume)


# ---------------------------------------------------------------------------
# 优化建议与报告（11.8 / 7.4 resume_optimize）
# ---------------------------------------------------------------------------

async def optimize_resume(db: Session, user: User, resume_id: UUID, payload: ResumeOptimizeRequest) -> ResumeOptimizeResponse:
    """POST /resume/{id}/optimize：生成优化建议并落盘为报告文件。"""
    resume = get_resume(db, user, resume_id)
    target_job = payload.target_job or resume.target_job or ""
    keywords = JOB_KEYWORDS.get(target_job, [])

    result: ResumeOptimizeResult = await deepseek_client.chat_prompt_json(
        prompt_name="resume_optimize",
        variables={
            "target_job": target_job or "未指定",
            "job_keywords": keywords or "（岗位库未收录，请按通用标准评估）",
            "focus": payload.focus or "",
            "resume_json": json.dumps(resume.parsed_data or {}, ensure_ascii=False),
        },
        schema=ResumeOptimizeResult,
        default=empty_resume_optimize(),
        temperature=STRUCTURED_TEMPERATURE,
    )

    resume.ats_score = result.ats_score
    resume.completeness = result.completeness
    if target_job:
        resume.target_job = target_job
    resume.updated_at = utcnow()
    db.add(resume)
    db.commit()
    db.refresh(resume)

    response = ResumeOptimizeResponse(
        resume_id=resume.id,
        ats_score=result.ats_score,
        completeness=result.completeness,
        matched_keywords=result.matched_keywords,
        missing_keywords=result.missing_keywords,
        suggestions=[s.model_dump() for s in result.suggestions],
        summary=result.summary,
        generated_at=utcnow(),
    )
    _save_report_file(user.id, resume, response)

    # 7.8 画像回流
    profile_service.update_resume_score(db, user.id, result.completeness)
    await _extract_resume_tags(db, user.id, resume.parsed_data, extra_text=result.summary)

    return response


def get_resume_file(db: Session, user: User, resume_id: UUID) -> ResumeFile:
    """GET /resume/{id}/file：取可下载的简历文件（鉴权 + 归属 + 路径校验）。

    安全要点（14.5 / 14.1 / 14.7）：

    1. **归属**：走 :func:`get_resume` —— 它内部用 ``not_found_unless_owner``，
       不存在**或不属于自己**都返回 2001，不泄露"这个 id 存在但不属于你"；
    2. **越界**：路径交给 ``file_utils.resolve_download_path()``，
       它会规范化后校验仍在 ``UPLOAD_DIR`` 之内（防 ``../`` 穿越与绝对路径逃逸）；
    3. **缺失**：数据库有记录但磁盘文件没了 -> 2001 + warning 日志（记 resume_id 便于排查）。

    返回 :class:`ResumeFile`（纯数据），路由层用 ``FileResponse`` 输出。
    """
    resume = get_resume(db, user, resume_id)

    if not resume.file_path:
        # 引导式生成的简历可能没有上传文件，这是正常状态
        logger.info("简历没有关联文件（可能是引导式生成）resume_id=%s", resume_id)
        raise BusinessException.not_found("该简历没有可下载的文件")

    # 内含目录穿越校验：越界直接按"不存在"拒绝
    path = file_utils.resolve_download_path(str(resume.file_path))

    if not path.exists() or not path.is_file():
        logger.warning("简历文件缺失 resume_id=%s file_path=%s", resume_id, resume.file_path)
        raise BusinessException.not_found("简历文件不存在")

    try:
        size = path.stat().st_size
    except OSError as exc:  # noqa: BLE001 - 极端情况（权限/被删）
        logger.warning("读取简历文件信息失败 resume_id=%s err=%s", resume_id, sanitize(exc))
        raise BusinessException.not_found("简历文件不存在") from exc

    return ResumeFile(
        path=path,
        filename=file_utils.build_download_filename(resume.title, path.suffix),
        media_type=file_utils.content_type_for(path),
        size=size,
    )


def get_resume_report(db: Session, user: User, resume_id: UUID) -> ResumeOptimizeResponse:
    """GET /resume/{id}/report：读取最近一次生成的优化报告。

    报告文件位置：``uploads/resumes/{user_id}/reports/{resume_id}.json``。
    没有生成过则按 2001 返回（前端据此引导用户先点“优化”）。
    """
    resume = get_resume(db, user, resume_id)
    path = _report_file_path(user.id, resume.id)
    if not path.exists():
        raise BusinessException(ErrorCode.NOT_FOUND, "尚未生成优化报告，请先调用优化接口")
    try:
        payload = extract_json(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        logger.error("读取简历报告失败 resume_id=%s err=%s", resume_id, sanitize(exc))
        raise BusinessException(ErrorCode.INTERNAL_ERROR, "报告文件损坏") from exc

    return ResumeOptimizeResponse(
        resume_id=resume.id,
        ats_score=float(payload.get("ats_score") or resume.ats_score or 0.0),
        completeness=float(payload.get("completeness") or resume.completeness or 0.0),
        matched_keywords=list(payload.get("matched_keywords") or []),
        missing_keywords=list(payload.get("missing_keywords") or []),
        suggestions=list(payload.get("suggestions") or []),
        summary=str(payload.get("summary") or ""),
        generated_at=resume.updated_at,
    )


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

def _guess_completeness(parsed_data: Optional[Dict[str, Any]]) -> float:
    """按小节数量粗估完整度 0-100（AI 未返回 completeness 时的兜底，11.8）。"""
    if not parsed_data:
        return 0.0
    weights = {
        "basics": 20.0,
        "education": 20.0,
        "experience": 20.0,
        "projects": 25.0,
        "skills": 15.0,
    }
    score = 0.0
    for key, weight in weights.items():
        value = parsed_data.get(key)
        if value:
            score += weight
    return round(min(100.0, score), 1)


def _report_file_path(user_id, resume_id: UUID):
    """报告落盘路径（13.1 目录 + reports 子目录）。"""
    directory = file_utils.get_resume_dir(user_id) / "reports"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{resume_id}.json"


def _save_report_file(user_id, resume: Resume, response: ResumeOptimizeResponse) -> None:
    """把优化报告写成 JSON 文件（GET /resume/{id}/report 直接读它）。"""
    path = _report_file_path(user_id, resume.id)
    try:
        path.write_text(
            json.dumps(response.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError as exc:
        logger.warning("保存简历报告失败 resume_id=%s err=%s", resume.id, sanitize(exc))


async def _extract_resume_tags(
    db: Session,
    user_id,
    parsed_data: Optional[Dict[str, Any]],
    extra_text: str = "",
) -> List[Dict[str, Any]]:
    """7.8：简历解析/优化结果回流画像。

    先把技能直接映射成“技能”标签（规则部分，附录F），
    再让 AI 从整体内容里抽痛点标签（如“缺量化成果”）。
    """
    if not parsed_data:
        return []

    skills = [str(s) for s in (parsed_data.get("skills") or []) if str(s).strip()]
    rule_tags: List[Dict[str, Any]] = [
        {"dimension": "技能", "label": skill[:100], "weight": 0.7, "source": "resume"} for skill in skills[:10]
    ]
    # 规则：项目/实习为空 -> 痛点“缺项目经历”
    if not (parsed_data.get("projects") or parsed_data.get("experience")):
        rule_tags.append({"dimension": "痛点", "label": "缺项目经历", "weight": 0.8, "source": "resume"})

    if rule_tags:
        profile_service.apply_tags(db, user_id, rule_tags, source="resume")

    # AI 抽取（失败返回空列表，不打断主流程）
    text = json.dumps(parsed_data, ensure_ascii=False)[:4000]
    if extra_text:
        text = f"{text}\n点评：{extra_text}"
    ai_tags = await profile_service.extract_tags_from_text(db, user_id, text, source="resume")
    return rule_tags + ai_tags


def keyword_coverage(parsed_data: Optional[Dict[str, Any]], target_job: str) -> Dict[str, List[str]]:
    """11.8 附录F：规则版关键词覆盖（不调 AI 时的降级实现）。

    TODO: DeepSeek 返回的 matched/missing 优先；本函数用于 AI 不可用时的兜底。
    """
    vocabulary = JOB_KEYWORDS.get(target_job, [])
    text = json.dumps(parsed_data or {}, ensure_ascii=False)
    matched = top_keywords(text, top_n=len(vocabulary) or 1, vocabulary=vocabulary)
    missing = [w for w in vocabulary if w not in matched]
    return {"matched": matched, "missing": missing}
