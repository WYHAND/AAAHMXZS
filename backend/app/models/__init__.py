"""models：SQLModel 数据库模型（《开发手册》第 5 章）。

文件划分照抄 4.1；表与文件的对应关系（因为 4.1 只有 10 个文件，5.2 有 16 张表）：

======================  ==========================
文件                    表
======================  ==========================
user.py                 users
profile.py              profiles, profile_tags
test.py                 test_results
conversation.py         conversations, messages
resume.py               resumes
interview.py            interviews, interview_questions
task.py                 tasks, task_steps
daily_question.py       daily_questions, daily_answers
report.py               reports
badge.py                badges, user_badges
======================  ==========================

注意：``interview_questions`` 出现在 5.2 表清单里，但 5.3 没有给出它的字段表，
本骨架按“面试题目与回答”的语义补齐，见 backend/README.md「待确认」。
"""

from app.models.badge import Badge, UserBadge
from app.models.conversation import Conversation, Message
from app.models.daily_question import DailyAnswer, DailyQuestion
from app.models.interview import Interview, InterviewQuestion
from app.models.profile import Profile, ProfileTag
from app.models.report import Report
from app.models.resume import Resume
from app.models.task import Task, TaskStep
from app.models.test import TestResult
from app.models.user import User

__all__ = [
    "User",
    "Profile",
    "ProfileTag",
    "TestResult",
    "Conversation",
    "Message",
    "Resume",
    "Interview",
    "InterviewQuestion",
    "Task",
    "TaskStep",
    "DailyQuestion",
    "DailyAnswer",
    "Report",
    "Badge",
    "UserBadge",
]


def all_models() -> list:
    """返回全部模型类，迁移 autogenerate 时用来确保元数据已注册。"""
    return list(__all__)
