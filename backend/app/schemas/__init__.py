"""schemas：Pydantic 请求/响应模型（《开发手册》6.3 命名规范）。

命名约定：
- 请求 ``XxxRequest``
- 响应 ``XxxResponse``
- 内部 ``XxxCreate`` / ``XxxUpdate``
"""

from app.schemas.badge import BadgeResponse, UserBadgeResponse
from app.schemas.chat import (
    ChatConclusionCard,
    ChatRequest,
    ChatResponse,
    ConversationCreate,
    ConversationResponse,
    ConversationUpdate,
    MessageResponse,
    SSEEvent,
)
from app.schemas.common import ApiResponse, PageData, ok
from app.schemas.daily_question import (
    DailyAnswerRequest,
    DailyAnswerResponse,
    DailyQuestionResponse,
    TodayQuestionResponse,
)
from app.schemas.interview import (
    InterviewAnswerRequest,
    InterviewFinishResponse,
    InterviewQuestionResponse,
    InterviewResponse,
    InterviewReviewResponse,
    InterviewStartRequest,
    InterviewSubmitRequest,
)
from app.schemas.profile import (
    ProfileFeedbackRequest,
    ProfileResponse,
    ProfileTagCreate,
    ProfileTagResponse,
    ProfileUpdate,
)
from app.schemas.report import ReportResponse
from app.schemas.resume import (
    ResumeCreate,
    ResumeOptimizeRequest,
    ResumeOptimizeResponse,
    ResumeParseRequest,
    ResumeResponse,
    ResumeUpdate,
)
from app.schemas.task import (
    TaskDetailResponse,
    TaskGenerateRequest,
    TaskResponse,
    TaskStepCompleteRequest,
    TaskStepResponse,
)
from app.schemas.test import TestQuestion, TestResultResponse, TestSubmitRequest
from app.schemas.user import TokenResponse, UserCreate, UserLoginRequest, UserResponse, UserUpdate

__all__ = [
    # common
    "ApiResponse",
    "PageData",
    "ok",
    # user / auth
    "UserCreate",
    "UserUpdate",
    "UserLoginRequest",
    "UserResponse",
    "TokenResponse",
    # profile
    "ProfileResponse",
    "ProfileUpdate",
    "ProfileTagCreate",
    "ProfileTagResponse",
    "ProfileFeedbackRequest",
    # test
    "TestQuestion",
    "TestSubmitRequest",
    "TestResultResponse",
    # chat
    "ConversationCreate",
    "ConversationUpdate",
    "ConversationResponse",
    "MessageResponse",
    "ChatRequest",
    "ChatResponse",
    "ChatConclusionCard",
    "SSEEvent",
    # resume
    "ResumeCreate",
    "ResumeUpdate",
    "ResumeResponse",
    "ResumeParseRequest",
    "ResumeOptimizeRequest",
    "ResumeOptimizeResponse",
    # interview
    "InterviewStartRequest",
    "InterviewAnswerRequest",
    "InterviewSubmitRequest",
    "InterviewQuestionResponse",
    "InterviewResponse",
    "InterviewFinishResponse",
    "InterviewReviewResponse",
    # task
    "TaskGenerateRequest",
    "TaskResponse",
    "TaskStepResponse",
    "TaskDetailResponse",
    "TaskStepCompleteRequest",
    # daily
    "DailyQuestionResponse",
    "TodayQuestionResponse",
    "DailyAnswerRequest",
    "DailyAnswerResponse",
    # report
    "ReportResponse",
    # badge
    "BadgeResponse",
    "UserBadgeResponse",
]
