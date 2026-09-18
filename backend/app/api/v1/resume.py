"""Resume 路由（10.2 Resume：list / create / detail / update / upload / optimize / report）。

补实现：
- ``GET /resume/{id}/file``：**带鉴权**的简历文件下载（安全修复，见 README 第 6 节）。
  ``uploads/`` 不再作为静态目录对外暴露 —— 那是未鉴权的 PII 泄露（14.5 / 14.1）。

注意 4.1 目录里没有 ``uploads/`` 的上传路由子模块，上传解析放在本模块
``POST /resume/upload``（手册 10.2 就是这么定义的）。
"""

from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.core.errors import BusinessException, ErrorCode
from app.models.user import User
from app.schemas.resume import (
    ResumeCreate,
    ResumeOptimizeRequest,
    ResumeOptimizeResponse,
    ResumeResponse,
    ResumeUpdate,
)
from app.services import resume_service

router = APIRouter(prefix="/resume", tags=["Resume 简历"])

# 分块读上传文件，避免一次性吃满内存（13.2 上限 10MB）
_CHUNK_SIZE = 1024 * 1024


async def _read_upload(file: UploadFile) -> bytes:
    """按块读取并即时校验大小（13.2）。"""
    chunks: List[bytes] = []
    size = 0
    while True:
        chunk = await file.read(_CHUNK_SIZE)
        if not chunk:
            break
        size += len(chunk)
        if size > settings.MAX_UPLOAD_SIZE:
            raise BusinessException.param_error(
                f"文件超过大小限制 {settings.MAX_UPLOAD_SIZE // (1024 * 1024)}MB"
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.get("", response_model=ApiResponse[List[ResumeResponse]], summary="简历列表")
async def list_resumes(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[List[ResumeResponse]]:
    return ApiResponse.ok(resume_service.list_resumes(db, current_user))


@router.post("", response_model=ApiResponse[ResumeResponse], summary="新建简历")
async def create_resume(
    payload: ResumeCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ResumeResponse]:
    """11.8 引导式生成：五步表单结果入库。"""
    return ApiResponse.ok(resume_service.create_resume(db, current_user, payload))


@router.post("/upload", response_model=ApiResponse[ResumeResponse], summary="上传解析")
async def upload_resume(
    file: UploadFile = File(..., description="PDF / Word，最大 10MB"),
    title: Optional[str] = Form(default=None),
    target_job: Optional[str] = Form(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ResumeResponse]:
    """13.1/13.3：存盘到 uploads/resumes/{user_id}/ -> 抽文本 -> DeepSeek 结构化。

    13.4：解析失败返回 1001，前端提示改用引导式生成。
    """
    content = await _read_upload(file)
    if not content:
        raise BusinessException(ErrorCode.PARAM_ERROR, "上传文件为空")
    return ApiResponse.ok(
        await resume_service.parse_uploaded_resume(
            db,
            current_user,
            filename=file.filename or "resume.pdf",
            content=content,
            content_type=file.content_type,
            title=title,
            target_job=target_job,
        )
    )


@router.get("/{resume_id}", response_model=ApiResponse[ResumeResponse], summary="简历详情")
async def get_resume(
    resume_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ResumeResponse]:
    return ApiResponse.ok(resume_service.get_resume_detail(db, current_user, resume_id))


@router.put("/{resume_id}", response_model=ApiResponse[ResumeResponse], summary="更新简历")
async def update_resume(
    resume_id: UUID,
    payload: ResumeUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ResumeResponse]:
    return ApiResponse.ok(resume_service.update_resume(db, current_user, resume_id, payload))


@router.post(
    "/{resume_id}/optimize",
    response_model=ApiResponse[ResumeOptimizeResponse],
    summary="优化建议",
)
async def optimize_resume(
    resume_id: UUID,
    payload: ResumeOptimizeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ResumeOptimizeResponse]:
    """11.8：ATS 评分（关键词规则 + DeepSeek）+ 逐条优化建议；画像回流 resume_score。"""
    return ApiResponse.ok(await resume_service.optimize_resume(db, current_user, resume_id, payload))


@router.get(
    "/{resume_id}/report",
    response_model=ApiResponse[ResumeOptimizeResponse],
    summary="优化报告",
)
async def get_report(
    resume_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ResumeOptimizeResponse]:
    """读取最近一次生成的优化报告（落盘 JSON）。"""
    return ApiResponse.ok(resume_service.get_resume_report(db, current_user, resume_id))


@router.get(
    "/{resume_id}/file",
    summary="下载/预览简历文件（鉴权）",
    response_class=FileResponse,
    responses={
        200: {
            "content": {
                "application/pdf": {},
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {},
            },
            "description": "简历原始文件（inline 展示）",
        },
        404: {"description": "简历不存在、不属于当前用户、或文件已丢失（code=2001）"},
    },
)
async def download_resume_file(
    resume_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileResponse:
    """**简历文件唯一的读取入口**（14.5 / 14.1）。

    为什么不挂静态目录：``StaticFiles`` 到 ``/uploads`` 意味着任何未登录的人
    只要猜到/遍历 ``/uploads/resumes/{user_id}/{uuid}.pdf`` 就能拿到别人的简历
    （姓名、手机号、学校、经历 = PII），而 ``file_path`` 里就带 user_id，路径可枚举。
    所以现在**只有**本端点能读文件，且必须带 ``Authorization``。

    安全行为：
    - 归属校验：不存在**或不属于当前用户**，一律 404 + ``code 2001``
      （不返回 1003，避免拿错误码当 oracle 枚举简历 id）；
    - 路径校验：``file_path`` 规范化后必须仍在 ``UPLOAD_DIR`` 之内，越界直接拒绝；
    - 文件缺失：数据库有记录但磁盘没了 -> 404 + warning 日志；
    - 响应头：``Content-Type`` 按扩展名（pdf/docx），
      ``Content-Disposition: inline; filename="..."``（文件名已清洗，中文走 RFC 5987）。

    这是二进制响应，**不套** ``ApiResponse`` 信封（同 SSE 的理由）。
    """
    info = resume_service.get_resume_file(db, current_user, resume_id)
    return FileResponse(
        path=info.path,
        media_type=info.media_type,
        filename=info.filename,
        # inline：浏览器/Electron 内嵌预览；要强制下载改成 "attachment"
        content_disposition_type="inline",
    )
