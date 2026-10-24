"""预置演示账号（`demo`）——给评委一个「登录即看完整闭环」的入口。

为什么单独一个文件：
- 种子题库（30 题）只能让用户「有题可做」，但评委还得自己注册、做 30 题、
  等画像生成，才能看到任务/简历/面试/报告；
- 演示账号把这些数据一次性预置好，且**不依赖任何外部 AI Key**。

设计约束：
- **幂等**：`demo` 已存在就跳过，不重复插入；
- **干净**：不复制任何真实用户数据，全部是虚构的示例内容；
- **可关闭**：`python -m app.db.init_db --no-demo` 跳过；
- **不改业务逻辑**：只写数据库，不调用 AI、不调用 service 里的生成逻辑。

账号：`demo` / `demo123456`（仅用于演示，生产环境不要启用）。
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, Optional

from sqlmodel import Session, select

from app.core.security import hash_password
from app.db.session import engine
from app.models.badge import Badge, UserBadge
from app.models.conversation import Conversation, Message
from app.models.daily_question import DailyAnswer, DailyQuestion
from app.models.interview import Interview, InterviewQuestion
from app.models.profile import Profile, ProfileTag
from app.models.report import Report
from app.models.resume import Resume
from app.models.task import Task, TaskStep
from app.models.test import TestResult
from app.models.user import User, utcnow
from app.utils.stage import calc_profile_scores

logger = logging.getLogger(__name__)

DEMO_USERNAME = "demo"
DEMO_PASSWORD = "demo123456"
DEMO_SCHOOL = "示例大学"
DEMO_MAJOR = "计算机科学与技术"
DEMO_GRADE = "大三"


def _days_ago(days: int, hours: int = 0):
    return utcnow() - timedelta(days=days, hours=hours)


def seed_demo_user() -> bool:
    """创建演示账号与完整演示数据；已存在则直接返回 False。"""
    with Session(engine) as db:
        existing = db.exec(select(User).where(User.username == DEMO_USERNAME)).first()
        if existing is not None:
            logger.info("seed_demo_user: 已存在 demo 账号，跳过（幂等）")
            return False

        now = utcnow()

        # ---------------- 用户 ----------------
        user = User(
            username=DEMO_USERNAME,
            password_hash=hash_password(DEMO_PASSWORD),
            school=DEMO_SCHOOL,
            major=DEMO_MAJOR,
            grade=DEMO_GRADE,
            created_at=_days_ago(21),
            updated_at=now,
        )
        db.add(user)
        db.flush()

        # ---------------- 画像 ----------------
        scores = calc_profile_scores(clarity=72, action=58, resume=62)
        profile = Profile(
            user_id=user.id,
            clarity_score=float(scores["clarity_score"]),
            action_score=float(scores["action_score"]),
            resume_score=float(scores["resume_score"]),
            total_score=float(scores["total_score"]),
            stage=str(scores["stage"]),
            ai_summary="你偏技术实现，愿意动手把东西跑通；下一步不是再学一门课，而是把做过的项目写成别人能验证的成果。",
            ai_summary_key="demo-v1",
            updated_at=_days_ago(1),
        )
        db.add(profile)

        tags = [
            ("兴趣", "后端开发", 0.82, "chat", "聊到接口设计时明显更愿意展开"),
            ("兴趣", "AI 应用", 0.68, "test", "测评中选择「让 AI 帮人解决具体问题」"),
            ("能力", "编码实现", 0.78, "task", "独立完成过课程项目的后端接口"),
            ("能力", "调试排查", 0.64, "interview", "能复述一次接口 500 的定位过程"),
            ("技能", "Python", 0.80, "resume", "简历技能栏明确列出 Python"),
            ("技能", "FastAPI", 0.72, "resume", "项目中使用 FastAPI 写过 6 个接口"),
            ("痛点", "项目经历说不清", 0.76, "interview", "复盘时项目结果缺少量化"),
            ("焦虑", "实习投递没回音", 0.55, "daily", "每日一问里提到投了 8 家没有回复"),
            ("认知", "先做出能演示的版本", 0.60, "chat", "认同「先闭环再优化」"),
            ("认知", "需要有人给反馈", 0.48, "daily", "希望有学长/老师帮忙看简历"),
        ]
        for dimension, label, weight, source, evidence in tags:
            db.add(
                ProfileTag(
                    user_id=user.id,
                    dimension=dimension,
                    label=label,
                    weight=weight,
                    source=source,
                    extra={"evidence": evidence, "confidence": 0.9},
                    updated_at=_days_ago(2),
                )
            )

        # ---------------- 测评记录 ----------------
        db.add(
            TestResult(
                user_id=user.id,
                answers={},
                free_text="想把课程项目写进简历，但不知道怎么讲清楚自己做了什么。",
                clarity_score=float(scores["clarity_score"]),
                action_score=float(scores["action_score"]),
                resume_score=float(scores["resume_score"]),
                total_score=float(scores["total_score"]),
                stage=str(scores["stage"]),
                created_at=_days_ago(21),
            )
        )

        # ---------------- 成长任务 ----------------
        task_ongoing = Task(
            user_id=user.id,
            title="把课程项目写成一段 STAR 案例",
            description="选一个你真正写过后端的项目，把情境、任务、行动、结果四段写清楚，结果尽量带数字。",
            pain_point="项目经历说不清",
            status="进行中",
            value_note="面试里 80% 的追问都从项目经历开始；先写清楚，才有得聊。",
            difficulty="中等",
            estimated_days=3,
            created_at=_days_ago(5),
            updated_at=_days_ago(1),
        )
        task_done = Task(
            user_id=user.id,
            title="完成一次 15 分钟模拟面试",
            description="选「小测试」模式，先把开口说完整，再考虑说得漂亮。",
            pain_point="缺乏面试经验",
            status="已完成",
            value_note="第一次面试的目标不是满分，是知道自己卡在哪。",
            difficulty="简单",
            estimated_days=1,
            created_at=_days_ago(9),
            updated_at=_days_ago(4),
        )
        task_abandoned = Task(
            user_id=user.id,
            title="整理 10 家公司的岗位 JD 对照表",
            description="把岗位要求拆成「必须会 / 加分 / 可以学」三列。",
            pain_point="职业方向不明确",
            status="已放弃",
            value_note="范围太大时先缩小到 3 家，避免停在准备阶段。",
            difficulty="中等",
            estimated_days=2,
            created_at=_days_ago(12),
            updated_at=_days_ago(8),
        )
        db.add_all([task_ongoing, task_done, task_abandoned])
        db.flush()

        steps = [
            # 进行中：2/3
            TaskStep(task_id=task_ongoing.id, step_order=1, title="选出要写的项目", action="只选一个你真正写过后端的项目，不要写课程大作业综述。", completed=True, feedback="选了校园二手交易平台", completed_at=_days_ago(4)),
            TaskStep(task_id=task_ongoing.id, step_order=2, title="按 STAR 写四句话", action="每段一句话，结果那句必须有数字或可验证的产出。", completed=True, feedback="写完了，但结果只有「上线了」，还没补数字", completed_at=_days_ago(2)),
            TaskStep(task_id=task_ongoing.id, step_order=3, title="找一个人读一遍并追问", action="让同学/学长只问「为什么这么做」，把答不上来的地方补回去。", completed=False),
            # 已完成：3/3
            TaskStep(task_id=task_done.id, step_order=1, title="选模式和场景", action="小测试 + 技术面。", completed=True, feedback="选了小测试/技术面", completed_at=_days_ago(6)),
            TaskStep(task_id=task_done.id, step_order=2, title="完成 3 道题", action="每题先说结论，再展开例子。", completed=True, feedback="第 2 题卡住了，其他两题还行", completed_at=_days_ago(5)),
            TaskStep(task_id=task_done.id, step_order=3, title="读复盘并记一条改进", action="只记一条最想改的，下一次面试只练它。", completed=True, feedback="下次先讲结果再讲过程", completed_at=_days_ago(4)),
            # 已放弃：1/2
            TaskStep(task_id=task_abandoned.id, step_order=1, title="先选 3 家公司", action="不要一次整理 10 家。", completed=True, feedback="选了 3 家", completed_at=_days_ago(10)),
            TaskStep(task_id=task_abandoned.id, step_order=2, title="拆 JD 关键词", action="按必须会/加分/可以学分三列。", completed=False),
        ]
        db.add_all(steps)

        # ---------------- 对话 ----------------
        conversation = Conversation(
            user_id=user.id,
            title="实习方向怎么选：后端还是 AI 应用",
            created_at=_days_ago(2),
            updated_at=_days_ago(2),
        )
        db.add(conversation)
        db.flush()

        chat = [
            ("user", "我现在在纠结实习投后端还是 AI 应用，两个都沾一点，简历上又都不算深。", _days_ago(2, 1)),
            ("assistant", "先不急着二选一。你更愿意做哪件事的「脏活」：调接口、查日志、把稳定性做上去，还是试模型、改 prompt、看效果？愿意反复做的部分，才是方向。", _days_ago(2, 1) + timedelta(seconds=30)),
            ("user", "查日志还行，调接口也不烦；模型效果不好的时候我会一直试。", _days_ago(2, 1) + timedelta(minutes=2)),
            ("assistant", "那你的优势更像「能把 AI 能力接进业务」的人，而不是纯算法。投后端时强调接口设计与稳定性，投 AI 应用时强调你把模型接进真实流程的那部分，同一段项目可以有两种讲法。", _days_ago(2, 1) + timedelta(minutes=2, seconds=30)),
            ("user", "那我项目里那个智能客服算吗？", _days_ago(2) + timedelta(minutes=5)),
            ("assistant", "算，但要按「你解决了什么」讲：原来人工回复要多久、接进去之后覆盖了多少问题、失败时怎么降级。把这三个数补上，它就不是课程作业了。", _days_ago(2) + timedelta(minutes=5, seconds=30)),
        ]
        for i, (role, content, created) in enumerate(chat):
            db.add(
                Message(
                    conversation_id=conversation.id,
                    role=role,
                    content=content,
                    client_msg_id=f"demo-msg-{i}" if role == "user" else None,
                    created_at=created,
                )
            )

        # ---------------- 面试 ----------------
        interview = Interview(
            user_id=user.id,
            mode="小测试",
            scene="技术",
            status="已完成",
            created_at=_days_ago(4),
            updated_at=_days_ago(4),
        )
        db.add(interview)
        db.flush()

        questions: list[tuple[str, str, Optional[list[Dict[str, Any]]], float]] = [
            (
                "选一个你写过的接口，说说它为什么这么设计。",
                "做了校园二手交易的商品列表接口，按发布时间倒序，支持分页和关键词过滤。",
                [{"round": 1, "q": "为什么不用 offset 分页？", "a": "数据量不大时 offset 够用；如果数据量大，我会改成游标分页，避免深分页扫描。"}],
                80,
            ),
            (
                "接口突然 500，你怎么定位？",
                "先看日志里的请求 id，确认是参数问题还是数据库问题，再本地复现。",
                [{"round": 1, "q": "如果是偶发呢？", "a": "加时间戳和用户 id 的日志，先缩小时间段，再看是不是并发或连接池。"}],
                74,
            ),
            (
                "项目里最不满意的地方是什么？",
                "失败重试做得比较粗糙，AI 调用失败时只是返回兜底话术，没有区分限流和超时。",
                None,
                70,
            ),
        ]
        for i, (content, answer, followups, score) in enumerate(questions, 1):
            db.add(
                InterviewQuestion(
                    interview_id=interview.id,
                    question_order=i,
                    content=content,
                    answer=answer,
                    followups=followups,
                    score=score,
                    answered_at=_days_ago(4),
                )
            )

        interview.report = {
            "overall_score": 76,
            "dimension_scores": {
                "沟通表达": 82,
                "逻辑思维": 74,
                "专业基础": 78,
                "项目经验": 70,
                "求职动机": 76,
            },
            "strengths": ["回答有具体例子", "能说清自己负责的部分"],
            "improvements": ["项目结果缺少量化", "技术选型理由讲得不够"],
            "question_reviews": [
                {
                    "question": questions[0][0],
                    "answer_summary": questions[0][1],
                    "score": 80,
                    "comment": "设计理由说清了，深分页的替代方案也能接住。",
                    "better_answer": "补一句「当前数据量下 offset 足够，超过 10 万行会切游标」，把取舍讲完整。",
                },
                {
                    "question": questions[1][0],
                    "answer_summary": questions[1][1],
                    "score": 74,
                    "comment": "定位顺序是对的，偶发问题的排查还可以更具体。",
                    "better_answer": "先说日志字段（请求 id、用户 id、耗时），再说怎么用时间窗和连接池指标缩小范围。",
                },
                {
                    "question": questions[2][0],
                    "answer_summary": questions[2][1],
                    "score": 70,
                    "comment": "能承认不足，但没说下一步怎么改。",
                    "better_answer": "补一句「下一步把限流和超时分开处理，限流直接提示稍后再试，超时才走兜底」。",
                },
            ],
            "summary": "表达清楚，项目细节还需要再往下挖一层；把结果量化，分数会明显不同。",
            "generated_at": _days_ago(4).isoformat(),
        }

        # ---------------- 成长报告快照（给 delta 一个基线） ----------------
        db.add(
            Report(
                user_id=user.id,
                type="growth",
                content={
                    "stage": "prepare",
                    "stage_label": "准备期",
                    "stage_changed": False,
                    "clarity_score": 66.0,
                    "action_score": 52.0,
                    "resume_score": 58.0,
                    "total_score": 58.9,
                    "score_delta": {
                        "clarity_score": 0.0,
                        "action_score": 0.0,
                        "resume_score": 0.0,
                        "total_score": 0.0,
                    },
                    "completed_tasks": 0,
                    "completed_steps": 2,
                    "active_days": 2,
                    "highlights": ["累计打卡 2 个步骤"],
                    "suggestions": [
                        {"text": "优先做一件能在 3 天内完成的小事，把行动分拉起来", "pain_point": "行动力不足"}
                    ],
                    "user_note": "这周先把项目经历写清楚。",
                    "saved_at": _days_ago(7).isoformat(),
                },
                created_at=_days_ago(7),
            )
        )

        # ---------------- 简历 ----------------
        db.add(
            Resume(
                user_id=user.id,
                title="我的简历",
                target_job="后端开发实习生",
                ats_score=78.0,
                completeness=82.0,
                parsed_data={
                    "basic": {
                        "name": "林同学",
                        "gender": "男",
                        "grade": "大三",
                        "major": "计算机科学与技术",
                        "school": "示例大学",
                        "contact": "demo@example.com",
                    },
                    "target": {"direction": "后端开发实习生", "city": "杭州"},
                    "education": [
                        {
                            "school": "示例大学",
                            "major": "计算机科学与技术",
                            "period": "2023.09 - 2027.06",
                            "highlights": ["专业排名前 15%", "数据结构 92 分"],
                        }
                    ],
                    "skills": ["Python", "FastAPI", "SQL", "Git", "Docker"],
                    "projects": [
                        {
                            "name": "校园二手交易平台",
                            "role": "后端开发",
                            "period": "2025.03 - 2025.06",
                            "star": {
                                "situation": "课程项目需要做一个校内二手交易平台，原有群聊交易信息分散。",
                                "task": "负责商品发布、列表与搜索接口。",
                                "action": "用 FastAPI + SQLite 实现 6 个接口，加关键词过滤与分页。",
                                "result": "上线后 120 名同学使用，商品列表 P95 响应 180ms。",
                            },
                        }
                    ],
                    "campus": [
                        {
                            "name": "学院技术社团",
                            "role": "后端组负责人",
                            "period": "2024.09 - 2025.06",
                            "star": {
                                "situation": "社团项目缺后端，前端同学只能看假数据。",
                                "task": "带 2 名同学把接口补齐。",
                                "action": "先定接口契约，再按周拆任务，用 Postman 做联调。",
                                "result": "项目在社团展示周正常演示，接口零阻塞。",
                            },
                        }
                    ],
                    "self_evaluation": "做事比较较真，答应的事会做完；不太会主动争取，正在改。",
                },
                created_at=_days_ago(6),
                updated_at=_days_ago(3),
            )
        )

        # ---------------- 每日一问 ----------------
        daily_questions = db.exec(select(DailyQuestion).limit(2)).all()
        for i, question in enumerate(daily_questions):
            db.add(
                DailyAnswer(
                    user_id=user.id,
                    question_id=question.id,
                    answer=["投了 8 家，只有 1 家回复", "先把项目结果补上再投"][i],
                    answered_at=_days_ago(3 - i),
                )
            )

        # ---------------- 奖章 ----------------
        badge_names = ["起步行动家", "坚持打卡者", "方向初现"]
        badges = db.exec(select(Badge).where(Badge.name.in_(badge_names))).all()
        for i, badge in enumerate(badges):
            db.add(
                UserBadge(
                    user_id=user.id,
                    badge_id=badge.id,
                    obtained_at=_days_ago(4 - i),
                )
            )

        db.commit()
        logger.info(
            "seed_demo_user: 已创建演示账号 %s / %s（画像 1、标签 %s、任务 3、对话 1、面试 1、简历 1、报告 1）",
            DEMO_USERNAME, DEMO_PASSWORD, len(tags),
        )
        return True


__all__ = ["seed_demo_user", "DEMO_USERNAME", "DEMO_PASSWORD"]
