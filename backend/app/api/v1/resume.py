"""Resume 路由（"模板 -> 用户填 -> AI 只润色"）。

现行端点（本模块**全部**对外契约）：

- ``GET /resume/template``：学生简历模板（要问用户哪些字段，纯静态配置）；
- ``GET|PUT /resume/mine``：唯一一份简历的读写（没有时 ``data=null``，不 404）；
- ``POST /resume/polish``：AI 只润色用户已填内容（服务端机械校验数字/空字段）。

已整体移除（老的 ATS 链路，2026-11，前端页面同步删除）：

- ``GET /resume``（列表）、``POST /resume``（新建）、``POST /resume/upload``（上传解析）、
  ``GET|PUT /resume/{id}``、``POST /{id}/optimize``、``GET /{id}/report``、
  ``GET /{id}/file``（鉴权下载）。

因此本模块现在**只有固定路径**，不再有 ``/{resume_id}`` 动态段，
"固定段必须注册在动态段之前"这条路径顺序约束也随之消失。
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.resume import (
    ResumeMineUpdate,
    ResumePolishRequest,
    ResumeResponse,
    ResumeTemplateResponse,
)
from app.services import resume_service

router = APIRouter(prefix="/resume", tags=["Resume 简历"])


@router.get(
    "/template",
    response_model=ApiResponse[ResumeTemplateResponse],
    summary="学生简历模板（要问用户哪些字段）",
)
async def get_resume_template(
    current_user: User = Depends(get_current_user),
) -> ApiResponse[ResumeTemplateResponse]:
    """返回"简历需要填什么"的**唯一来源**（纯静态配置，不查库、不调 AI）。

    前端照 ``data.sections[].fields[].question`` 一条一条问用户，
    用户填完调 ``POST /resume/polish`` 润色；字段名/必填标记都以本接口为准。
    """
    return ApiResponse.ok(ResumeTemplateResponse(**resume_service.get_resume_template()))


@router.get(
    "/mine",
    response_model=ApiResponse[Optional[ResumeResponse]],
    summary="我的简历（唯一一份）",
)
async def get_my_resume(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[Optional[ResumeResponse]]:
    """取当前用户唯一一份简历；**没有就返回 ``data=null``（刻意不 404）**。

    为什么不是 404：前端的空态判断是"data 为空 -> 展示模板表单"，
    而 404 会被全局异常处理包成 ``code=2001`` 的错误信封，前端必须为
    "还没建简历"写一条特例分支 —— 那是把"正常空态"当错误。
    """
    return ApiResponse.ok(resume_service.get_my_resume(db, current_user))


@router.post(
    "/polish",
    response_model=ApiResponse[ResumeResponse],
    summary="润色我填的简历（只改写，不新增事实）",
)
async def polish_resume(
    payload: ResumePolishRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ResumeResponse]:
    """AI **只润色用户已经写下的内容**（口语 -> 简历口吻 / STAR），写进唯一一份简历。

    红线与落地方式（改 Prompt 请先读这里）：

    - ``resume_polish.txt`` 写死"一个字的事实都不许新增"；
    - 服务端另外做两道**机械校验**（不依赖模型自觉）：
      ① 润色结果里的数字必须是用户原文数字的子集；
      ② 用户没填的字段不许被填。
      命中任一条就把**那个字段**回退成用户原文，并 warning 留痕；
    - AI 失败/坏 JSON -> 退回用户原文（7.6 兜底），**永远不 500**。
    """
    resume, message = await resume_service.polish_resume(
        db, current_user, payload.parsed_data, payload.target_job
    )
    return ApiResponse.ok(resume, message=message)


@router.put(
    "/mine",
    response_model=ApiResponse[ResumeResponse],
    summary="保存我编辑的简历（不调 AI）",
)
async def update_my_resume(
    payload: ResumeMineUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[ResumeResponse]:
    """用户在表单里手改后保存（全量覆盖 ``parsed_data``），同样刷新完整度与画像分数。"""
    return ApiResponse.ok(
        resume_service.save_my_resume(
            db,
            current_user,
            payload.parsed_data,
            title=payload.title,
            target_job=payload.target_job,
        )
    )
