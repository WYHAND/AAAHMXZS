/**
 * 表单字段长度常量（与后端 Pydantic 的 max_length 对齐，避免提交才 422）
 */

/** schemas/resume.ResumeCreate.title */
export const RESUME_TITLE_MAX = 200
/** schemas/resume.ResumeCreate.target_job */
export const RESUME_TARGET_JOB_MAX = 100

/** schemas/daily_question.DailyAnswerRequest.answer */
export const DAILY_ANSWER_MAX = 200

/** schemas/chat.ChatRequest.content */
export const CHAT_CONTENT_MAX = 2000

/** schemas/interview.InterviewAnswerRequest.answer */
export const INTERVIEW_ANSWER_MAX = 5000

/** schemas/task.TaskStepCompleteRequest.feedback */
export const TASK_FEEDBACK_MAX = 1000

/** schemas/profile.ProfileFeedbackRequest.comment */
export const PROFILE_FEEDBACK_COMMENT_MAX = 500

/** schemas/user.UserCreate：username 3-50 / password 6-64 */
export const USERNAME_MIN = 3
export const USERNAME_MAX = 50
export const PASSWORD_MIN = 6
export const PASSWORD_MAX = 64
