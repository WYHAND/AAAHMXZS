"""种子数据（手册 5.4）。

这里放**真正的种子内容**，由 ``python -m app.db.init_db`` 落库：

| 数据 | 数量 | 落库表 | 依据 |
|---|---|---|---|
| 基础测试题 | 30 | ``test_questions`` | 5.4「基础测试题 30-50 题，纯选择题，四维度」 |
| 每日一问题库 | 30 | ``daily_questions`` | 5.4「每日一问题库 30 题，四维度轮换」 |
| 奖章 | 2 | ``badges`` | 5.4「奖章：起步行动家」+ 11.12 |

**仍然留在代码里的两组数据**（不落库，理由见 README §5.2）：

- 成长任务模板（附录E）：``task_service.TASK_TEMPLATES`` —— 它是喂给
  ``task_generate`` Prompt 的**参考模板**，不是用户可见数据；
- 岗位关键词库（附录F）：``ai/schemas.py::JOB_KEYWORDS`` —— 它是 ATS 评分的**词表**，
  同样不是用户可见数据。

测试题的四个维度（对应 11.3 的计分，见 ``app/utils/stage.py`` 附录B）：

- ``clarity``：职业目标清晰度（权重 0.40）
- ``action``：求职行动进度（权重 0.35）
- ``resume``：简历完整度（权重 0.25）
- ``interest``：兴趣倾向（不直接计分，用于生成画像标签）

**注意**：``q_resume_01`` / ``q_action_03`` / ``q_interest_01`` / ``q_interest_02``
这四个 code 被 ``profile_service._apply_test_tags()`` 的画像规则引用，
**改题库时不要改这四个 code**，否则标签规则会静默失效。
"""

from __future__ import annotations

from typing import Any, Dict, List

# ---------------------------------------------------------------------------
# 基础测试题（30 题：clarity 8 + action 8 + resume 7 + interest 7）
# 每题最多 5 分，因此每个维度的满分 = 5 * 题目数；计分时按满分折算到 0-100。
# ---------------------------------------------------------------------------

TEST_QUESTIONS: List[Dict[str, Any]] = [
    # ---------------- clarity 职业目标清晰度（8） ----------------
    {
        "code": "q_clarity_01",
        "dimension": "clarity",
        "content": "你目前有明确的职业方向吗？",
        "options": [
            {"key": "A", "text": "很清楚，已经锁定具体岗位", "score": 5},
            {"key": "B", "text": "有大致方向，还在验证", "score": 3},
            {"key": "C", "text": "有几个感兴趣的领域，说不清哪个更适合", "score": 2},
            {"key": "D", "text": "完全没想过", "score": 0},
        ],
    },
    {
        "code": "q_clarity_02",
        "dimension": "clarity",
        "content": "你了解自己想去的岗位每天在做什么吗？",
        "options": [
            {"key": "A", "text": "了解，问过从业者或做过相关项目", "score": 5},
            {"key": "B", "text": "看过一些介绍，大概知道", "score": 3},
            {"key": "C", "text": "只有模糊印象", "score": 1},
            {"key": "D", "text": "完全不了解", "score": 0},
        ],
    },
    {
        "code": "q_clarity_03",
        "dimension": "clarity",
        "content": "你了解自己的优势吗？",
        "options": [
            {"key": "A", "text": "很清楚，能说出具体例子", "score": 5},
            {"key": "B", "text": "知道大概，但举不出例子", "score": 3},
            {"key": "C", "text": "别人说过，自己不太确定", "score": 2},
            {"key": "D", "text": "没想过", "score": 0},
        ],
    },
    {
        "code": "q_clarity_04",
        "dimension": "clarity",
        "content": "你知道自己想做的工作需要哪些核心能力吗？",
        "options": [
            {"key": "A", "text": "知道，并且已经在补其中一两项", "score": 5},
            {"key": "B", "text": "知道个大概", "score": 3},
            {"key": "C", "text": "说不出具体的", "score": 1},
            {"key": "D", "text": "没考虑过", "score": 0},
        ],
    },
    {
        "code": "q_clarity_05",
        "dimension": "clarity",
        "content": "如果有两个方向你都想试，你现在会怎么做？",
        "options": [
            {"key": "A", "text": "分别找从业者聊过，已有取舍", "score": 5},
            {"key": "B", "text": "先各做一个小尝试再决定", "score": 4},
            {"key": "C", "text": "继续纠结，等想清楚再说", "score": 1},
            {"key": "D", "text": "随便选一个，区别不大", "score": 0},
        ],
    },
    {
        "code": "q_clarity_06",
        "dimension": "clarity",
        "content": "你对自己专业的就业去向了解多少？",
        "options": [
            {"key": "A", "text": "很清楚主流去向和薪资区间", "score": 5},
            {"key": "B", "text": "知道几个常见去向", "score": 3},
            {"key": "C", "text": "只听说过一两个", "score": 1},
            {"key": "D", "text": "完全不清楚", "score": 0},
        ],
    },
    {
        "code": "q_clarity_07",
        "dimension": "clarity",
        "content": "你有明确的 1 年内想达成的求职目标吗？",
        "options": [
            {"key": "A", "text": "有，写下来过并且能衡量", "score": 5},
            {"key": "B", "text": "心里有个方向", "score": 3},
            {"key": "C", "text": "只有一个模糊愿望", "score": 1},
            {"key": "D", "text": "没有", "score": 0},
        ],
    },
    {
        "code": "q_clarity_08",
        "dimension": "clarity",
        "content": "如果现在有人问你「你想做什么工作」，你会怎么回答？",
        "options": [
            {"key": "A", "text": "能说出具体岗位和理由", "score": 5},
            {"key": "B", "text": "能说出一个行业方向", "score": 3},
            {"key": "C", "text": "只能说「和专业相关」", "score": 1},
            {"key": "D", "text": "答不上来", "score": 0},
        ],
    },
    # ---------------- action 求职行动进度（8） ----------------
    {
        "code": "q_action_01",
        "dimension": "action",
        "content": "你写过简历吗？",
        "options": [
            {"key": "A", "text": "写过，并且针对岗位改过至少 2 个版本", "score": 5},
            {"key": "B", "text": "写过一版", "score": 3},
            {"key": "C", "text": "有素材但没整理成简历", "score": 1},
            {"key": "D", "text": "完全没写过", "score": 0},
        ],
    },
    {
        "code": "q_action_02",
        "dimension": "action",
        "content": "你参加过实习或与专业相关的实践吗？",
        "options": [
            {"key": "A", "text": "有 2 段及以上相关经历", "score": 5},
            {"key": "B", "text": "有 1 段相关经历", "score": 3},
            {"key": "C", "text": "做过零散实践，不算正式经历", "score": 2},
            {"key": "D", "text": "完全没有", "score": 0},
        ],
    },
    {
        "code": "q_action_03",
        "dimension": "action",
        "content": "最近一个月，你为就业做过哪些具体的事？",
        "options": [
            {"key": "A", "text": "投递/面试/做项目，每周都有动作", "score": 5},
            {"key": "B", "text": "偶尔看过岗位或改过简历", "score": 3},
            {"key": "C", "text": "只是想过，没行动", "score": 1},
            {"key": "D", "text": "没有", "score": 0},
        ],
    },
    {
        "code": "q_action_04",
        "dimension": "action",
        "content": "你主动了解过目标岗位的招聘要求吗？",
        "options": [
            {"key": "A", "text": "看过很多 JD，并总结过共性要求", "score": 5},
            {"key": "B", "text": "看过几份", "score": 3},
            {"key": "C", "text": "只听说过", "score": 1},
            {"key": "D", "text": "没看过", "score": 0},
        ],
    },
    {
        "code": "q_action_05",
        "dimension": "action",
        "content": "你有没有为了求职专门学过一项技能？",
        "options": [
            {"key": "A", "text": "有，学到了能拿出手的程度", "score": 5},
            {"key": "B", "text": "有，但只是入门", "score": 3},
            {"key": "C", "text": "收藏了课程但没开始", "score": 1},
            {"key": "D", "text": "没有", "score": 0},
        ],
    },
    {
        "code": "q_action_06",
        "dimension": "action",
        "content": "你和学长学姐或从业者聊过就业吗？",
        "options": [
            {"key": "A", "text": "聊过多次，并且记了笔记", "score": 5},
            {"key": "B", "text": "聊过一两次", "score": 3},
            {"key": "C", "text": "想聊但没找到人", "score": 1},
            {"key": "D", "text": "没聊过也没想过", "score": 0},
        ],
    },
    {
        "code": "q_action_07",
        "dimension": "action",
        "content": "你参加过的比赛、社团或项目里，有能写进简历的吗？",
        "options": [
            {"key": "A", "text": "有 3 段以上", "score": 5},
            {"key": "B", "text": "有 1-2 段", "score": 3},
            {"key": "C", "text": "参加过但觉得没什么可写的", "score": 1},
            {"key": "D", "text": "没参加过", "score": 0},
        ],
    },
    {
        "code": "q_action_08",
        "dimension": "action",
        "content": "你有没有为自己设过求职时间表并执行？",
        "options": [
            {"key": "A", "text": "有，按周推进并复盘", "score": 5},
            {"key": "B", "text": "有大概的时间点", "score": 3},
            {"key": "C", "text": "想过但没写下来", "score": 1},
            {"key": "D", "text": "没有", "score": 0},
        ],
    },
    # ---------------- resume 简历完整度（7） ----------------
    {
        "code": "q_resume_01",
        "dimension": "resume",
        "content": "你的简历里有可以量化的项目或实习成果吗？",
        "options": [
            {"key": "A", "text": "有，多条都有具体数字或结果", "score": 5},
            {"key": "B", "text": "有 1-2 条", "score": 3},
            {"key": "C", "text": "只写了职责，没有结果", "score": 1},
            {"key": "D", "text": "没有可写的经历", "score": 0},
        ],
    },
    {
        "code": "q_resume_02",
        "dimension": "resume",
        "content": "你知道目标岗位的关键词、知道简历要往上靠吗？",
        "options": [
            {"key": "A", "text": "知道，并且简历里已经对齐", "score": 5},
            {"key": "B", "text": "知道有这回事，但没做", "score": 2},
            {"key": "C", "text": "第一次听说", "score": 0},
        ],
    },
    {
        "code": "q_resume_03",
        "dimension": "resume",
        "content": "你的简历有几页、排版清楚吗？",
        "options": [
            {"key": "A", "text": "一页，重点突出、排版干净", "score": 5},
            {"key": "B", "text": "一页，但内容有点挤", "score": 3},
            {"key": "C", "text": "两三页，很多无关内容", "score": 1},
            {"key": "D", "text": "还没有简历", "score": 0},
        ],
    },
    {
        "code": "q_resume_04",
        "dimension": "resume",
        "content": "简历里的经历描述，是「做了什么」还是「做成了什么」？",
        "options": [
            {"key": "A", "text": "基本都是后者，有结果", "score": 5},
            {"key": "B", "text": "一半一半", "score": 3},
            {"key": "C", "text": "大多是前者，只写了动作", "score": 1},
            {"key": "D", "text": "没写过经历描述", "score": 0},
        ],
    },
    {
        "code": "q_resume_05",
        "dimension": "resume",
        "content": "你会针对不同岗位投不同版本的简历吗？",
        "options": [
            {"key": "A", "text": "会，每个方向一版", "score": 5},
            {"key": "B", "text": "会微调关键词", "score": 3},
            {"key": "C", "text": "一版投所有", "score": 1},
            {"key": "D", "text": "还没到投递阶段", "score": 0},
        ],
    },
    {
        "code": "q_resume_06",
        "dimension": "resume",
        "content": "你的简历里有没有明确的求职意向？",
        "options": [
            {"key": "A", "text": "有，写了具体岗位", "score": 5},
            {"key": "B", "text": "写了行业方向", "score": 3},
            {"key": "C", "text": "没写", "score": 0},
        ],
    },
    {
        "code": "q_resume_07",
        "dimension": "resume",
        "content": "有人帮你看过简历并给过具体修改意见吗？",
        "options": [
            {"key": "A", "text": "有，而且我改了", "score": 5},
            {"key": "B", "text": "有人看过，但没给具体建议", "score": 3},
            {"key": "C", "text": "没有人看过", "score": 0},
        ],
    },
    # ---------------- interest 兴趣倾向（7，不直接计分，用于生成标签） ----------------
    {
        "code": "q_interest_01",
        "dimension": "interest",
        "content": "如果可以选，你更想做哪种类型的工作？",
        "options": [
            {"key": "A", "text": "和技术/产品打交道，做出东西", "score": 3},
            {"key": "B", "text": "和人打交道，做沟通与组织", "score": 3},
            {"key": "C", "text": "和数据打交道，做分析与决策支持", "score": 3},
            {"key": "D", "text": "还不确定，都行", "score": 1},
        ],
    },
    {
        "code": "q_interest_02",
        "dimension": "interest",
        "content": "你对未来就业焦虑吗？",
        "options": [
            {"key": "A", "text": "非常焦虑，经常影响状态", "score": 3},
            {"key": "B", "text": "有点焦虑", "score": 2},
            {"key": "C", "text": "还好，走一步看一步", "score": 1},
            {"key": "D", "text": "不焦虑", "score": 1},
        ],
    },
    {
        "code": "q_interest_03",
        "dimension": "interest",
        "content": "做小组作业时，你通常是？",
        "options": [
            {"key": "A", "text": "牵头的人，负责分工和推进", "score": 3},
            {"key": "B", "text": "执行主力，把分配的任务做好", "score": 2},
            {"key": "C", "text": "查资料、写文档的人", "score": 2},
            {"key": "D", "text": "不太参与，能少做就少做", "score": 0},
        ],
    },
    {
        "code": "q_interest_04",
        "dimension": "interest",
        "content": "以下哪种事你做起来最不觉得累？",
        "options": [
            {"key": "A", "text": "把一个东西从 0 做出来", "score": 3},
            {"key": "B", "text": "把复杂的事讲清楚", "score": 3},
            {"key": "C", "text": "从一堆数据里找出规律", "score": 3},
            {"key": "D", "text": "把大家组织起来完成一件事", "score": 3},
        ],
    },
    {
        "code": "q_interest_05",
        "dimension": "interest",
        "content": "你平时会主动关注行业或岗位的信息吗？",
        "options": [
            {"key": "A", "text": "会，有固定关注的渠道", "score": 3},
            {"key": "B", "text": "偶尔刷到会看", "score": 2},
            {"key": "C", "text": "很少", "score": 1},
            {"key": "D", "text": "完全不关注", "score": 0},
        ],
    },
    {
        "code": "q_interest_06",
        "dimension": "interest",
        "content": "如果让你免费做一件事做三个月，你会选？",
        "options": [
            {"key": "A", "text": "做一个自己的小产品", "score": 3},
            {"key": "B", "text": "帮别人解决具体问题", "score": 3},
            {"key": "C", "text": "研究一个感兴趣的话题并写出来", "score": 3},
            {"key": "D", "text": "组织一场活动", "score": 3},
        ],
    },
    {
        "code": "q_interest_07",
        "dimension": "interest",
        "content": "你更希望第一份工作的哪一点最重要？",
        "options": [
            {"key": "A", "text": "能学到东西、成长快", "score": 3},
            {"key": "B", "text": "稳定、压力可控", "score": 2},
            {"key": "C", "text": "薪资高", "score": 2},
            {"key": "D", "text": "离兴趣近", "score": 3},
        ],
    },
]


# ---------------------------------------------------------------------------
# 每日一问题库（30 题：6 个维度各 5 题，与 11.7「四维度轮换」一致）
# options 里的 weight 用于画像回流时的权重参考。
# ---------------------------------------------------------------------------

DAILY_QUESTIONS: List[Dict[str, Any]] = [
    # ---------------- 兴趣 ----------------
    {
        "dimension": "兴趣",
        "content": "如果可以选，你更想做哪种工作？",
        "options": [
            {"key": "A", "text": "做出具体的东西", "weight": 3},
            {"key": "B", "text": "和人打交道、组织协调", "weight": 3},
            {"key": "C", "text": "和分析数据打交道", "weight": 3},
            {"key": "D", "text": "还没想清楚", "weight": 1},
        ],
    },
    {
        "dimension": "兴趣",
        "content": "你最近一次觉得「这事挺有意思」是什么时候，在做什么？",
        "options": [
            {"key": "A", "text": "写代码/做作品的时候", "weight": 3},
            {"key": "B", "text": "和一群人把事推动起来的时候", "weight": 3},
            {"key": "C", "text": "把一团乱数据理清楚的时候", "weight": 3},
            {"key": "D", "text": "想不起来了", "weight": 0},
        ],
    },
    {
        "dimension": "兴趣",
        "content": "你平时刷手机最爱看哪类内容？",
        "options": [
            {"key": "A", "text": "产品/技术/数码", "weight": 3},
            {"key": "B", "text": "职场/沟通/表达", "weight": 3},
            {"key": "C", "text": "商业分析/财经", "weight": 3},
            {"key": "D", "text": "娱乐为主，没什么垂直偏好", "weight": 1},
        ],
    },
    {
        "dimension": "兴趣",
        "content": "如果给你一个完全自由的周末，你会用来做什么？",
        "options": [
            {"key": "A", "text": "折腾一个自己的小项目", "weight": 3},
            {"key": "B", "text": "约人聊天、参加活动", "weight": 3},
            {"key": "C", "text": "看资料、学点东西", "weight": 3},
            {"key": "D", "text": "休息，什么都不干", "weight": 1},
        ],
    },
    {
        "dimension": "兴趣",
        "content": "以下哪句话最像你？",
        "options": [
            {"key": "A", "text": "我想做出别人会用的东西", "weight": 3},
            {"key": "B", "text": "我想把事情组织得井井有条", "weight": 3},
            {"key": "C", "text": "我想把问题分析清楚再动手", "weight": 3},
            {"key": "D", "text": "我还没找到想做的事", "weight": 1},
        ],
    },
    # ---------------- 能力 ----------------
    {
        "dimension": "能力",
        "content": "做小组作业时，你通常是？",
        "options": [
            {"key": "A", "text": "牵头分工的人", "weight": 3},
            {"key": "B", "text": "执行主力", "weight": 2},
            {"key": "C", "text": "查资料写文档", "weight": 2},
            {"key": "D", "text": "参与较少", "weight": 0},
        ],
    },
    {
        "dimension": "能力",
        "content": "让你把一个复杂的事讲给别人听，你觉得自己怎么样？",
        "options": [
            {"key": "A", "text": "能讲清楚，还知道对方哪里没懂", "weight": 3},
            {"key": "B", "text": "能讲出来，但不太有结构", "weight": 2},
            {"key": "C", "text": "讲着讲着就乱了", "weight": 1},
            {"key": "D", "text": "很怕当众讲", "weight": 0},
        ],
    },
    {
        "dimension": "能力",
        "content": "遇到完全不会的任务，你第一反应是？",
        "options": [
            {"key": "A", "text": "拆开看哪不会，先查再问", "weight": 3},
            {"key": "B", "text": "先找人问", "weight": 2},
            {"key": "C", "text": "先放一放", "weight": 1},
            {"key": "D", "text": "很有压力，容易卡住", "weight": 0},
        ],
    },
    {
        "dimension": "能力",
        "content": "你做事会给自己定检查点吗？",
        "options": [
            {"key": "A", "text": "会，按节点复盘调整", "weight": 3},
            {"key": "B", "text": "偶尔会", "weight": 2},
            {"key": "C", "text": "基本靠感觉", "weight": 1},
            {"key": "D", "text": "不会，常常拖到最后", "weight": 0},
        ],
    },
    {
        "dimension": "能力",
        "content": "别人给你提反对意见时，你通常？",
        "options": [
            {"key": "A", "text": "先问清理由，再判断要不要改", "weight": 3},
            {"key": "B", "text": "会听，但不一定改", "weight": 2},
            {"key": "C", "text": "有点不舒服", "weight": 1},
            {"key": "D", "text": "不太想听", "weight": 0},
        ],
    },
    # ---------------- 技能 ----------------
    {
        "dimension": "技能",
        "content": "你现在能拿得出手的技能有哪些？",
        "options": [
            {"key": "A", "text": "有 1-2 项能实际做出东西", "weight": 3},
            {"key": "B", "text": "学过多项，但都只是入门", "weight": 2},
            {"key": "C", "text": "说不清自己会什么", "weight": 1},
            {"key": "D", "text": "暂时没有", "weight": 0},
        ],
    },
    {
        "dimension": "技能",
        "content": "你用过哪些工具解决实际问题？",
        "options": [
            {"key": "A", "text": "办公/数据类（Excel、SQL、PPT 等）", "weight": 2},
            {"key": "B", "text": "编程/开发类", "weight": 2},
            {"key": "C", "text": "设计/剪辑类", "weight": 2},
            {"key": "D", "text": "基本没深入用过", "weight": 0},
        ],
    },
    {
        "dimension": "技能",
        "content": "如果这周要开始学一项技能，你会选？",
        "options": [
            {"key": "A", "text": "目标岗位 JD 里出现最多的那个", "weight": 3},
            {"key": "B", "text": "我已经会一点的，继续深入", "weight": 3},
            {"key": "C", "text": "别人推荐的热门技能", "weight": 2},
            {"key": "D", "text": "不知道从哪开始", "weight": 0},
        ],
    },
    {
        "dimension": "技能",
        "content": "你的技能有作品或成果可以证明吗？",
        "options": [
            {"key": "A", "text": "有，能直接展示", "weight": 3},
            {"key": "B", "text": "有一些练习作品", "weight": 2},
            {"key": "C", "text": "只有学习记录", "weight": 1},
            {"key": "D", "text": "没有", "weight": 0},
        ],
    },
    {
        "dimension": "技能",
        "content": "你会用搜索和文档解决技术问题吗？",
        "options": [
            {"key": "A", "text": "会，能自己查到并验证", "weight": 3},
            {"key": "B", "text": "会查，但常常看不明白", "weight": 2},
            {"key": "C", "text": "主要靠问别人", "weight": 1},
            {"key": "D", "text": "基本不会", "weight": 0},
        ],
    },
    # ---------------- 痛点 ----------------
    {
        "dimension": "痛点",
        "content": "现在最让你卡住的一件事是什么？",
        "options": [
            {"key": "A", "text": "没有项目/实习经历", "weight": 3},
            {"key": "B", "text": "不知道该投什么岗位", "weight": 3},
            {"key": "C", "text": "简历写不出东西", "weight": 3},
            {"key": "D", "text": "面试不敢开口", "weight": 3},
        ],
    },
    {
        "dimension": "痛点",
        "content": "如果只能解决一个就业问题，你会选？",
        "options": [
            {"key": "A", "text": "有一段能拿出手的经历", "weight": 3},
            {"key": "B", "text": "把方向定下来", "weight": 3},
            {"key": "C", "text": "把简历改好", "weight": 3},
            {"key": "D", "text": "面试能说清楚", "weight": 3},
        ],
    },
    {
        "dimension": "痛点",
        "content": "你觉得自己离「可以开始投递」还差什么？",
        "options": [
            {"key": "A", "text": "差经历", "weight": 3},
            {"key": "B", "text": "差方向", "weight": 3},
            {"key": "C", "text": "差技能", "weight": 3},
            {"key": "D", "text": "差信心", "weight": 2},
        ],
    },
    {
        "dimension": "痛点",
        "content": "你有没有「想做但一直没开始」的事？",
        "options": [
            {"key": "A", "text": "有，而且拖了很久", "weight": 3},
            {"key": "B", "text": "有，刚起步", "weight": 2},
            {"key": "C", "text": "有过，后来放弃了", "weight": 2},
            {"key": "D", "text": "没有", "weight": 1},
        ],
    },
    {
        "dimension": "痛点",
        "content": "上次你想找实习/项目机会，最后卡在哪？",
        "options": [
            {"key": "A", "text": "不知道自己够不够格，没敢投", "weight": 3},
            {"key": "B", "text": "投了没有回音", "weight": 3},
            {"key": "C", "text": "不知道去哪找", "weight": 3},
            {"key": "D", "text": "还没开始找", "weight": 2},
        ],
    },
    # ---------------- 焦虑 ----------------
    {
        "dimension": "焦虑",
        "content": "想到就业这件事，你的第一感觉是？",
        "options": [
            {"key": "A", "text": "很慌，但不知道从哪下手", "weight": 3},
            {"key": "B", "text": "有点压力，还行", "weight": 2},
            {"key": "C", "text": "比较平静", "weight": 1},
            {"key": "D", "text": "没什么感觉", "weight": 0},
        ],
    },
    {
        "dimension": "焦虑",
        "content": "看到同学拿到 offer，你会？",
        "options": [
            {"key": "A", "text": "很受影响，怀疑自己", "weight": 3},
            {"key": "B", "text": "有点着急，会转为行动", "weight": 2},
            {"key": "C", "text": "会参考他的路径", "weight": 1},
            {"key": "D", "text": "不太在意", "weight": 1},
        ],
    },
    {
        "dimension": "焦虑",
        "content": "你最近睡眠或状态受就业影响吗？",
        "options": [
            {"key": "A", "text": "经常影响", "weight": 3},
            {"key": "B", "text": "偶尔", "weight": 2},
            {"key": "C", "text": "很少", "weight": 1},
            {"key": "D", "text": "没有", "weight": 0},
        ],
    },
    {
        "dimension": "焦虑",
        "content": "你觉得自己的焦虑主要来自？",
        "options": [
            {"key": "A", "text": "不知道自己要什么", "weight": 3},
            {"key": "B", "text": "知道自己要什么但还差得远", "weight": 2},
            {"key": "C", "text": "外部比较和家里期待", "weight": 2},
            {"key": "D", "text": "经济压力", "weight": 2},
        ],
    },
    {
        "dimension": "焦虑",
        "content": "如果焦虑能换一个具体行动，你希望换什么？",
        "options": [
            {"key": "A", "text": "今天就做一件小事", "weight": 3},
            {"key": "B", "text": "找个人聊聊", "weight": 2},
            {"key": "C", "text": "先把信息查清楚", "weight": 2},
            {"key": "D", "text": "想先休息一下", "weight": 1},
        ],
    },
    # ---------------- 认知 ----------------
    {
        "dimension": "认知",
        "content": "你觉得产品经理主要是做什么的？",
        "options": [
            {"key": "A", "text": "定义要做什么，并对结果负责", "weight": 3},
            {"key": "B", "text": "画原型、写文档", "weight": 2},
            {"key": "C", "text": "管项目进度", "weight": 1},
            {"key": "D", "text": "不太清楚", "weight": 0},
        ],
    },
    {
        "dimension": "认知",
        "content": "你觉得「实习」对求职最大的作用是什么？",
        "options": [
            {"key": "A", "text": "验证方向 + 攒可讲的经历", "weight": 3},
            {"key": "B", "text": "给简历加分", "weight": 2},
            {"key": "C", "text": "拿转正机会", "weight": 2},
            {"key": "D", "text": "没什么用", "weight": 0},
        ],
    },
    {
        "dimension": "认知",
        "content": "你觉得面试官最想听什么？",
        "options": [
            {"key": "A", "text": "你具体做了什么、结果如何", "weight": 3},
            {"key": "B", "text": "你的态度和热情", "weight": 2},
            {"key": "C", "text": "你的学习成绩", "weight": 1},
            {"key": "D", "text": "不太确定", "weight": 0},
        ],
    },
    {
        "dimension": "认知",
        "content": "你认为「职业规划」是什么？",
        "options": [
            {"key": "A", "text": "一个不断验证和修正的假设", "weight": 3},
            {"key": "B", "text": "一条定好就不改的路线", "weight": 2},
            {"key": "C", "text": "写给别人看的材料", "weight": 1},
            {"key": "D", "text": "没想过", "weight": 0},
        ],
    },
    {
        "dimension": "认知",
        "content": "你觉得「经历不够」最有效的补法是什么？",
        "options": [
            {"key": "A", "text": "做一个能讲清楚的小项目", "weight": 3},
            {"key": "B", "text": "把已有经历写细写实", "weight": 3},
            {"key": "C", "text": "多考证", "weight": 1},
            {"key": "D", "text": "等毕业再说", "weight": 0},
        ],
    },
]


# ---------------------------------------------------------------------------
# 奖章（5.4「奖章：起步行动家」+ 11.12）
# condition 的结构由 badge_service.check_and_award 解释：{event, threshold}
# ---------------------------------------------------------------------------

BADGES: List[Dict[str, Any]] = [
    {
        "name": "起步行动家",
        "condition": {"event": "task_completed", "threshold": 1,
                      "description": "完成第一个成长任务"},
    },
    {
        "name": "坚持打卡者",
        "condition": {"event": "steps_completed", "threshold": 5,
                      "description": "累计打卡 5 个任务步骤"},
    },
]
