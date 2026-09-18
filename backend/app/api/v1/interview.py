"""Interview 路由（10.2 Interview：start / questions / answer / finish / review）。"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.interview import (
    InterviewAnswerRequest,
    InterviewAnswerResponse,
    InterviewFinishResponse,
    InterviewQuestionsResponse,
    InterviewResponse,
    InterviewReviewResponse,
    InterviewStartRequest,
)
from app.services import interview_service

router = APIRouter(prefix="/interview", tags=["Interview 模拟面试"])


@router.post("/start", response_model=ApiResponse[InterviewResponse], summary="开始面试")
async def start(
    payload: InterviewStartRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[InterviewResponse]:
    """11.9：选模式与场景 -> 基于简历出题。"""
    return ApiResponse.ok(await interview_service.start_interview(db, current_user, payload))


@router.get(
    "/{interview_id}/questions",
    response_model=ApiResponse[InterviewQuestionsResponse],
    summary="获取题目",
)
async def questions(
    interview_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[InterviewQuestionsResponse]:
    return ApiResponse.ok(interview_service.get_questions(db, current_user, interview_id))


@router.post(
    "/{interview_id}/answer",
    response_model=ApiResponse[InterviewAnswerResponse],
    summary="提交回答",
)
async def answer(
    interview_id: UUID,
    payload: InterviewAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[InterviewAnswerResponse]:
    """11.9：存回答 -> 判断是否追问（每题最多 2 轮）-> 返回下一题。"""
    return ApiResponse.ok(await interview_service.submit_answer(db, current_user, interview_id, payload))


@router.post(
    "/{interview_id}/finish",
    response_model=ApiResponse[InterviewFinishResponse],
    summary="结束面试",
)
async def finish(
    interview_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[InterviewFinishResponse]:
    """11.9：生成复盘报告；7.8 画像回流在 service 内完成。"""
    return ApiResponse.ok(await interview_service.finish_interview(db, current_user, interview_id))


@router.get(
    "/{interview_id}/review",
    response_model=ApiResponse[InterviewReviewResponse],
    summary="复盘报告",
)
async def review(
    interview_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[InterviewReviewResponse]:
    return ApiResponse.ok(interview_service.get_review(db, current_user, interview_id))
