"""models：SQLModel 数据库模型（《开发手册》第 5 章）。

文件划分照抄 4.1；表与文件的对应关系（4.1 只有 10 个文件；5.2 列了 16 张表，
本骨架另补了 5.4 要求的题库表 ``test_questions``，以及账号级长期记忆表
``user_memories``，实际共 **18 张**）：

======================  ==========================
文件                    表
======================  ==========================
user.py                 users
profile.py              profiles, profile_tags
memory.py               user_memories（账号级动机地图）
test.py                 test_results, test_questions
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
from app.models.memory import UserMemory
from app.models.profile import Profile, ProfileTag
from app.models.report import Report
from app.models.resume import Resume
from app.models.task import Task, TaskStep
from app.models.test import TestQuestion, TestResult
from app.models.user import User

__all__ = [
    "User",
    "Profile",
    "ProfileTag",
    "TestQuestion",
    "TestResult",
    "Conversation",
    "Message",
    "Resume",
    "Interview",
    "InterviewQuestion",
    "Task",
    "TaskStep",
    "UserMemory",
    "DailyQuestion",
    "DailyAnswer",
    "Report",
    "Badge",
    "UserBadge",
]


def all_models() -> list[str]:
    """返回全部模型**类名**（类本身已在模块顶部 import，元数据已注册）。"""
    return list(__all__)
