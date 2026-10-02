"""DailyQuestion 路由（10.2 DailyQuestion：today / answer）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.daily_question import (
    DailyAnswerRequest,
    DailyAnswerResponse,
    DailyHistoryResponse,
    TodayQuestionResponse,
)
from app.services import daily_question_service

router = APIRouter(prefix="/daily", tags=["DailyQuestion 每日一问"])


@router.get("/today", response_model=ApiResponse[TodayQuestionResponse], summary="今日问题")
async def today(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[TodayQuestionResponse]:
    """11.7：每天 1 题；已答过则回传答案。"""
    return ApiResponse.ok(daily_question_service.get_today_question(db, current_user))


@router.post("/answer", response_model=ApiResponse[DailyAnswerResponse], summary="回答")
async def answer(
    payload: DailyAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[DailyAnswerResponse]:
    """11.7：累计 7 题触发画像微调（7.8 回流）。"""
    return ApiResponse.ok(await daily_question_service.answer_question(db, current_user, payload))


@router.get("/history", response_model=ApiResponse[DailyHistoryResponse], summary="每日一问历史")
async def history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[DailyHistoryResponse]:
    """每日一问历史：当前用户答过的题 + 自己的答案，``answered_at`` **倒序**（最新在前）。

    - 只查当前 token 的用户（不接收任何 id），因此不涉及 2001 越权规则；
    - **不分页**（10.2 没有分页约定，不自创 offset/cursor）：``items`` 服务端硬上限
      100 条，``total`` 仍是真实总数（见 ``daily_question_service.HISTORY_MAX_ITEMS``）；
    - 题目 join 不到（历史脏数据）时该条照常返回，``content`` 为 ``""``、
      ``dimension`` 为 ``null``，不会 500、也不会静默丢条目。
    """
    return ApiResponse.ok(daily_question_service.get_history(db, current_user))
