"""schemas：Pydantic 请求/响应模型（《开发手册》6.3 命名规范）。

命名约定：
- 请求 ``XxxRequest``
- 响应 ``XxxResponse``
- 内部 ``XxxCreate`` / ``XxxUpdate``
"""

from app.schemas.badge import (
    BadgeItemResponse,
    BadgeOverviewResponse,
    BadgeProgress,
    BadgeResponse,
)
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    ConversationCreate,
    ConversationResponse,
    ConversationUpdate,
    MessageResponse,
    PendingChatResponse,
    SSEEvent,
    SSEEventType,
)
from app.schemas.common import ApiResponse, PageData, ok
from app.schemas.daily_question import (
    DailyAnswerRequest,
    DailyAnswerResponse,
    DailyQuestionResponse,
    TodayQuestionResponse,
)
from app.schemas.event import (
    MAX_EVENTS_PER_BATCH,
    EventItem,
    EventStats,
    EventSubmitRequest,
)
from app.schemas.home import (
    HomeAiFinding,
    HomeDailyQuestion,
    HomeNextAction,
    HomeOngoingTask,
    HomeProfileSummary,
    HomeSummaryResponse,
    HomeTag,
)
from app.schemas.interview import (
    InterviewAnswerRequest,
    InterviewAnswerResponse,
    InterviewFinishResponse,
    InterviewQuestionResponse,
    InterviewQuestionsResponse,
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
from app.schemas.report import (
    GrowthReportContent,
    GrowthReportResponse,
    GrowthSuggestion,
    ReportResponse,
    ReportSaveRequest,
    ReportScoreDelta,
    USER_NOTE_MAX_LENGTH,
)
from app.schemas.resume import ResumeResponse
from app.schemas.task import (
    TaskDeleteResponse,
    TaskDetailResponse,
    TaskGenerateRequest,
    TaskResponse,
    TaskStepCompleteRequest,
    TaskStepResponse,
)
from app.schemas.test import TestQuestionResponse, TestResultResponse, TestSubmitRequest
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
    "TestQuestionResponse",
    "TestSubmitRequest",
    "TestResultResponse",
    # chat
    "ConversationCreate",
    "ConversationUpdate",
    "ConversationResponse",
    "MessageResponse",
    "ChatRequest",
    "ChatResponse",
    "PendingChatResponse",
    "SSEEvent",
    "SSEEventType",
    # resume（现行：模板 / mine / polish；老的 ResumeCreate/Update/Parse/Optimize 已随 ATS 链路移除）
    "ResumeResponse",
    # interview
    "InterviewStartRequest",
    "InterviewAnswerRequest",
    "InterviewSubmitRequest",
    "InterviewQuestionResponse",
    "InterviewQuestionsResponse",
    "InterviewResponse",
    "InterviewAnswerResponse",
    "InterviewFinishResponse",
    "InterviewReviewResponse",
    # task
    "TaskGenerateRequest",
    "TaskResponse",
    "TaskStepResponse",
    "TaskDetailResponse",
    "TaskStepCompleteRequest",
    "TaskDeleteResponse",
    # daily
    "DailyQuestionResponse",
    "TodayQuestionResponse",
    "DailyAnswerRequest",
    "DailyAnswerResponse",
    # report
    "ReportResponse",
    "GrowthReportResponse",
    "GrowthReportContent",
    "GrowthSuggestion",
    "ReportScoreDelta",
    "ReportSaveRequest",
    "USER_NOTE_MAX_LENGTH",
    # badge
    "BadgeResponse",
    "BadgeProgress",
    "BadgeItemResponse",
    "BadgeOverviewResponse",
    # home（设计说明书 5.4 补实现）
    "HomeSummaryResponse",
    "HomeProfileSummary",
    "HomeTag",
    "HomeDailyQuestion",
    "HomeAiFinding",
    "HomeOngoingTask",
    "HomeNextAction",
    # events（设计说明书 5.4 补实现）
    "EventItem",
    "EventSubmitRequest",
    "EventStats",
    "MAX_EVENTS_PER_BATCH",
]
