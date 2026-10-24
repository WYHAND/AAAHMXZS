"""Test 路由（10.2 Test：questions / submit / result）。

对应业务流程 11.2 / 11.3。业务逻辑在 ``app.services.profile_service``
（4.1 的 services 清单里没有 test_service.py，见 README「待确认」）。
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.test import TestQuestionResponse, TestResultResponse, TestSubmitRequest
from app.services import profile_service

router = APIRouter(prefix="/test", tags=["Test 基础测试表"])


@router.get(
    "/questions",
    response_model=ApiResponse[List[TestQuestionResponse]],
    summary="获取测试题",
)
async def get_questions(
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[List[TestQuestionResponse]]:
    """11.2 第 1 步：获取题目列表（需登录）。

    早期骨架为了让引导页显示题量曾允许匿名读取，属于历史遗留；
    题库与后续提交/结果属于同一条用户链路（``submit`` / ``result`` 都要求登录），
    这里统一要求登录，避免匿名端点成为未登记的攻击面。

    题库来自数据库 ``test_questions`` 表。**若返回空数组**，说明还没初始化，
    请先执行 ``python -m app.db.init_db``（不会再用代码常量假装有题）。
    返回的 ``id`` 是业务编号（如 ``q_clarity_01``），提交答案时用它做 key。
    """
    return ApiResponse.ok(profile_service.get_test_questions(db))


@router.post("/submit", response_model=ApiResponse[TestResultResponse], summary="提交答案")
async def submit(
    payload: TestSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[TestResultResponse]:
    """11.2/11.3：提交答案 -> 计算初始画像 -> 生成阶段 -> 文字补充抽标签（7.8）。

    - 整个流程（test_results + profiles + profile_tags）是**一个事务**，失败整体回滚；
    - 响应里的 ``clarity_score / action_score / resume_score / total_score / stage``
      与随后 ``GET /profile`` **逐字段一致**（都取自重算落库后的 profile）；
    - ``answers`` 的 key 是 ``GET /test/questions`` 返回的题目 ``id``（形如 ``q_clarity_01``）；
    - 落库**之后**再把 ``free_text`` 交给 ``source="test"`` 的 AI 抽标签
      （11.2 第 4 步）：这一步 await 在事务之外，AI 不可用时提交仍然成功（细节见
      ``profile_service.submit_test`` 的 docstring）。
    """
    return ApiResponse.ok(await profile_service.submit_test(db, current_user, payload))


@router.get("/result", response_model=ApiResponse[Optional[TestResultResponse]], summary="获取结果")
async def result(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[Optional[TestResultResponse]]:
    """取最近一次测试结果；没测过时 data 为 null。"""
    return ApiResponse.ok(profile_service.get_test_result(db, current_user))
