"""成长任务业务逻辑（手册 11.5 痛点诊断与任务推荐、11.6 打卡与画像更新、11.12 奖章触发）。

画像回流钩子（7.8）：
- ``complete_step``：打卡反馈 -> 抽取标签（行动力、自律性）
- ``complete_step`` 末尾 -> ``badge_service.check_and_award``（11.12：一次触发评估
  全部奖章条件，任务数 / 步骤数 / 画像标签数三条一起算）
- ``delete_task``：删任务后 -> ``profile_service.recompute_stage``
  （``action_score`` 是按"已打卡步骤数"算的，删掉带打卡的任务必须立刻重算，
  否则分数会停在旧值直到用户下次打卡）
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import STRUCTURED_TEMPERATURE
from app.ai.schemas import TaskGenerateResult, empty_task_generate
from app.core.errors import BusinessException, ErrorCode, not_found_unless_owner
from app.models.task import Task, TaskStep
from app.models.user import User, utcnow
from app.schemas.task import (
    TaskDeleteResponse,
    TaskDetailResponse,
    TaskGenerateRequest,
    TaskGenerateResponse,
    TaskResponse,
    TaskStepCompleteRequest,
    TaskStepResponse,
)
from app.services import badge_service, profile_service
from app.utils.logger import get_logger, sanitize
from app.utils.reference_match import drop_referenced, looks_referenced
from app.utils.similarity import is_similar, normalize, similarity

logger = get_logger(__name__)

# 任务状态中文枚举（5.3）。去重只跟「进行中」比，见 _find_duplicate_task。
ACTIVE_TASK_STATUS = "进行中"

# 复用已有任务时的固定提示语（前端不应依赖它做判断，判断用 TaskGenerateResponse.reused；
# 这里定义在服务层，是为了让"命中重复"这件事只有一处文案出处）。
REUSED_TASK_MESSAGE = "已经有一个类似的任务了，没有重复生成"

# 第一次生成时 ``{duplicate_feedback}`` 的取值：显式写"本次无"，而不是空串。
# 空串会让 Prompt 里那一行以裸冒号结尾（"换方向提示（…）："），模型可能把它当成
# 一条被截断的指令；写清楚"本次无"更不容易被误读，也便于排查日志时一眼看出
# 这一次到底走没走"撞车重试"。
NO_DUPLICATE_FEEDBACK = "（本次无）"

# 附录E 成长任务模板（11.5：把痛点映射到任务模板）
TASK_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "缺项目": {
        "title": "做一个入门级小项目",
        "description": "选一个你感兴趣的小场景，做出能演示的最小版本。",
        "value_note": "面试官最想听你亲手做过什么，哪怕很小。",
        "difficulty": "中等",
        "estimated_days": 7,
        "steps": [
            {"title": "选定场景并写一句话目标", "action": "写出一句话：给谁解决什么问题，写完发给我看。"},
            {"title": "列出 3 个必须有的功能", "action": "每个功能写一句验收标准，不许多写。"},
            {"title": "做出能点通的最小版本", "action": "允许很丑，但主流程要能走完一遍。"},
            {"title": "录一段 1 分钟演示", "action": "边操作边说，录完自己看一遍。"},
        ],
    },
    "表达差": {
        "title": "每天 1 分钟口头复述",
        "description": "把当天学过的东西讲出来，练表达的结构感。",
        "value_note": "面试的表达能力就是平时讲习惯的复刻。",
        "difficulty": "简单",
        "estimated_days": 7,
        "steps": [
            {"title": "选一个今天的知识点", "action": "用一句话写下它是什么。"},
            {"title": "对着手机录 1 分钟讲解", "action": "必须有开头、中间、结尾三句。"},
            {"title": "回看并记下一个问题", "action": "只记一个你觉得说得最乱的地方。"},
        ],
    },
    "迷茫": {
        "title": "完成一次职业深度对话",
        "description": "找 1-2 位学长学姐或从业者聊清楚一个岗位。",
        "value_note": "迷茫大多来自信息太少，聊一次比想一周有用。",
        "difficulty": "简单",
        "estimated_days": 5,
        "steps": [
            {"title": "列出想问的 5 个问题", "action": "必须包含：每天做什么、最难的是什么、怎么入行。"},
            {"title": "联系 1-2 位可聊的人", "action": "发出具体邀约，说明只要 15 分钟。"},
            {"title": "完成对话并记录", "action": "写下 3 条让你意外的信息。"},
            {"title": "更新你的方向假设", "action": "写一句话：我还想不想做这个方向，为什么。"},
        ],
    },
    "缺实习": {
        "title": "挖掘三段校园经历",
        "description": "把课程作业、社团、比赛改写成可写进简历的经历。",
        "value_note": "没有实习不等于没有经历，关键是把经历讲成能力证据。",
        "difficulty": "简单",
        "estimated_days": 3,
        "steps": [
            {"title": "列出 3 段可写的经历", "action": "每段一句话说明你做了什么。"},
            {"title": "为每段补上结果", "action": "有数字写数字，没数字写影响范围。"},
            {"title": "改写成简历语言", "action": "统一成「动词 + 对象 + 结果」。"},
        ],
    },
    # --- 以下 4 个键对应「成长报告建议」里的 pain_point（report_service.SUGGESTION_RULES），
    #     这样用户在报告页点"去做任务"时，能命中贴切的模板（离线兜底也不会跑偏）。
    "行动力不足": {
        "title": "3 天做完一件小事",
        "description": "挑一件能在 3 天内收尾的小事，做完并留下证据。",
        "value_note": "行动力只能靠「做完过事」证明，做小一点、做完它。",
        "difficulty": "简单",
        "estimated_days": 3,
        "steps": [
            {"title": "选一件 3 天内能做完的事", "action": "写一句话：我做完的标志是什么。"},
            {"title": "拆成 3 个不超过 1 小时的动作", "action": "每个动作都要能立刻开始。"},
            {"title": "今天先做第一个动作", "action": "做完就来打卡，哪怕只花了 20 分钟。"},
            {"title": "收尾并写下结果", "action": "三句话：做了什么、结果如何、下次怎么更快。"},
        ],
    },
    "简历没有可写的经历": {
        "title": "把一段校园经历写进简历",
        "description": "从课程作业、社团、比赛里挑一段，改写成能进简历的经历。",
        "value_note": "简历不是没东西写，是还没把经历翻译成「能力证据」。",
        "difficulty": "简单",
        "estimated_days": 3,
        "steps": [
            {"title": "挑一段最有话可说的经历", "action": "写下背景一句话：给谁、做什么。"},
            {"title": "补上你的角色和动作", "action": "用「动词 + 对象」写 2-3 条。"},
            {"title": "补上结果", "action": "有数字写数字，没数字写影响范围。"},
            {"title": "压缩成 3 行简历语言", "action": "每条不超过 30 字。"},
        ],
    },
    "职业方向不明确": {
        "title": "把方向缩小到 2 个",
        "description": "找 1-2 位从业者聊明白两个具体岗位的日常。",
        "value_note": "方向不是想出来的，是聊出来、比出来的。",
        "difficulty": "简单",
        "estimated_days": 7,
        "steps": [
            {"title": "列出 3 个候选岗位", "action": "每个写一句你为什么想了解它。"},
            {"title": "为每个岗位写 3 个想问的问题", "action": "必须包含：每天做什么、最难的是什么。"},
            {"title": "联系从业者各聊 15 分钟", "action": "至少聊到 1 个人。"},
            {"title": "写下取舍", "action": "最后留 2 个方向，并说明为什么砍掉第三个。"},
        ],
    },
    "缺乏面试经验": {
        "title": "完成一次面试小测试",
        "description": "做一次 3 题的轻量模拟面试，拿到复盘报告。",
        "value_note": "面试是技能，练一次就知道自己卡在哪。",
        "difficulty": "中等",
        "estimated_days": 2,
        "steps": [
            {"title": "准备一段 1 分钟自我介绍", "action": "录下来自己看一遍。"},
            {"title": "完成一次面试小测试", "action": "在面试模块选「小测试」+「HR」。"},
            {"title": "读复盘报告并挑一个问题", "action": "只挑最想改的那一条。"},
            {"title": "照着示范回答再讲一遍", "action": "重新录一次，对比前后。"},
        ],
    },
}

# ---------------------------------------------------------------------------
# 主题素材的机械剔除（"生成的任务主题全都一样"的修复主线）
# ---------------------------------------------------------------------------
#
# ## 现场与根因
# 用户的成长任务列表里三条全是健身（「自动整理健身笔记的桌面小工具」「个人健身数据看板」
# 「健身饮食记录小工具」）；真实库里 ``admin`` 名下是 5 条同主题任务
# （打卡小工具 / 动作计数小工具 / 饮食记录小工具 / 数据看板 / 笔记整理小工具）。
# 根因不是去重，也不是"不该生成健身"（用户明确说"可以生成健身小任务，只是不能全是"）：
# 组装 Prompt 时把**全部**画像标签喂给模型，而该用户画像里「兴趣/健身」权重最高
# （0.90，排在标签列表第一行，来自聊天抽取）；去重那条硬规则说的是**标题**
# （``is_similar``），于是模型给出的答案完全"合规" —— 在同一个主题内不停换角度
# （笔记 → 看板 → 饮食记录 → 动作计数），主题高度同质。
#
# ## 为什么必须**机械剔除**，不能只在 Prompt 里写一句"请注意多样性"
# 1. **软提示压不过输入信号**：Prompt 里标签的权重就是"重要性"的排序，"健身 0.90"
#    摆在第一行；实测加过"换一个完全不同的主题或产物形态"这类措辞之后，模型仍然在
#    健身主题内换产物名 —— 而它这么做并不违反任何一条既有规则（"不能同题"说的是标题）。
# 2. **剔除是可验证的**：日志能直接说出"这次剔掉了哪个标签、依据哪条已有标题"
#    （见 ``_plan_theme_material`` 的 ``logger.info("任务主题剔除…")``）；
#    "模型有没有听话"只能靠结果反推，出了事无法定位。
# 3. **把约束从"模型的自由裁量"搬到"服务端的输入约束"**：标签根本不出现在 Prompt 里，
#    模型即使想锚也无从锚起 —— 与开场白那条 ``_drop_already_asked``
#    （"模型就算想顺着问也没有素材"）是同一个思路，判据也**复用同一份实现**
#    （``app/utils/reference_match.py``）。
#
# ## 边界（别把这条修过头）
# - 只剔**主题标签**，不禁止"健身"这个兴趣本身：剔的是"这一次不许再拿它当主题"，
#   不是"以后都不许提健身"；下一轮如果用户把健身任务做完了（不再「进行中」），
#   这个标签会重新回到候选里。
# - 只拿**【进行中】**任务标题当依据。已完成/已放弃的任务是"可承接"的素材（可以先确认到哪一步再往细节里追），
#   拿它们剔标签会让用户再也做不了想进阶/重做的主题。
# - 剔除后**候选池为空**必须给模型一条明确指令（换维度 / 换痛点词），
#   绝不能让 Prompt 出现"素材一片空白"（见 ``_theme_hint_text``）。
# ---------------------------------------------------------------------------

# ``avoid_themes`` 在"本次没有标签与已有任务主题重叠"时的取值。
# 显式写"本次无"，而不是空串：空串会让 Prompt 里那一行以裸冒号结尾
# （与 ``NO_DUPLICATE_FEEDBACK`` 同一个理由），模型可能把它当成一条被截断的指令。
NO_AVOID_THEMES = "（本次无：没有任何画像标签与【进行中】任务的主题重叠）"


@dataclass
class ThemeMaterial:
    """一次任务生成用的**主题素材**（画像标签已按"已用主题"机械剔除）。

    字段分工：
    - ``profile_tags``：**剔除后**的标签，进 Prompt 的 ``{profile_tags}``
      （已 ``serialize_tags``，可直接 json.dumps）；
    - ``dropped_labels`` / ``evidence``：**只用于留痕日志**，不进 Prompt；
    - ``avoid_themes``：进 Prompt 的**禁止主题清单**（含剔除依据，让模型知道"这几个词
      这次不许再当主题，换说法也不行"）；
    - ``theme_hint``：进 Prompt 的**方向指令**。候选池被剔空时这里明确要求模型
      "不能再围绕已用过的主题"，并给出换维度 / 换痛点维度的具体做法 ——
      保证"素材为空"时模型仍有可执行的指令，而不是一片空白。
    """

    profile_tags: List[Dict[str, Any]]
    dropped_labels: List[str]
    # [(被剔的标签, [命中的已有任务标题])]，仅用于日志与 avoid_themes 的依据行
    evidence: List[Tuple[str, List[str]]]
    avoid_themes: str
    theme_hint: str

    @property
    def pool_empty(self) -> bool:
        """剔除后一个候选主题标签都不剩（新用户 0 标签也走这条路）。"""
        return not self.profile_tags


def _plan_theme_material(
    db: Session, user: User, active_tasks: List[Task], pain_point: str
) -> ThemeMaterial:
    """算出这次生成能用的主题素材：**把已出现在【进行中】标题里的标签机械剔掉**。

    判定走 :func:`~app.utils.reference_match.drop_referenced`（= 开场白那套
    "宁可多剔、不可漏剔"的子串/字覆盖率/英文词根判据），所以中文标签做子串判断即可，
    例如【进行中】标题里都有"健身" -> 「健身」这个标签这一次直接不进 Prompt。

    剔除**必须留痕**（与 ``chat_service._opening_context`` 的日志同一目的）：
    以后"为什么这次没围绕某个标签出题"能直接从日志看出来。日志一行说清三件事：
    剔了哪些标签 / 依据哪些已有标题 / 候选池是否因此为空。

    ⚠️ 已知代价（刻意保留，不是 bug）：``looks_referenced`` 对**短标签**还有一条
    "单字覆盖率 ≥ 0.5"的宽松信号（标签『剪辑』↔"剪视频"），用在任务标题上会误剔 ——
    实测 ``admin`` 的 5 条健身任务里有「健身**作**计数」，于是 2 字标签『写作』
    因为共用"作"字被一起剔掉。这与开场白侧是**同一套"宁可多剔、不可漏剔"口径**：
    多剔一个标签的代价只是"这一次少一个候选主题"，漏剔的代价正是本次要修的
    "主题全都一样"。判定口径不做第二套，避免两处漂移；真要收紧，应该改
    ``app/utils/reference_match.py``（两处一起变），而不是在这里另写一份。
    """
    all_tags = profile_service.list_tags(db, user.id)  # 已按 weight 降序
    active_titles = [(task.title or "").strip() for task in active_tasks if (task.title or "").strip()]

    # 标签可能在不同维度下重名（例如 兴趣/技术 与 技能/技术）：先按标签名去重，
    # 判定以**标签名**为单位（主题是标签级的），再去重结果上做剔除/保留。
    labels: List[str] = list(dict.fromkeys(tag.label for tag in all_tags if tag.label))
    kept_labels, dropped_labels = drop_referenced(labels, active_titles)
    kept_set = set(kept_labels)
    kept_tags = [tag for tag in all_tags if tag.label in kept_set]

    evidence: List[Tuple[str, List[str]]] = [
        (label, [title for title in active_titles if looks_referenced(label, title)])
        for label in dropped_labels
    ]

    if dropped_labels:
        logger.info(
            "任务主题剔除（机械排除已用主题）：user_id=%s 剔除标签=%s 依据【进行中】标题=%s "
            "保留标签=%s 候选池为空=%s",
            user.id,
            dropped_labels,
            "、".join(f"{label}←「{'」「'.join(titles)}」" for label, titles in evidence),
            len(kept_tags),
            not kept_tags,
        )
    elif not all_tags:
        # 新用户（0 标签、0 任务）：没有素材可剔，照旧走痛点模板/兜底方向。
        logger.info(
            "任务主题剔除：user_id=%s 画像没有任何标签（新用户），无需剔除，按痛点「%s」模板方向生成",
            user.id, pain_point,
        )

    return ThemeMaterial(
        profile_tags=profile_service.serialize_tags(kept_tags),
        dropped_labels=list(dropped_labels),
        evidence=evidence,
        avoid_themes=_avoid_themes_text(evidence),
        theme_hint=_theme_hint_text(pain_point, dropped_labels, pool_empty=not kept_tags),
    )


def _avoid_themes_text(evidence: List[Tuple[str, List[str]]]) -> str:
    """Prompt 变量 ``{avoid_themes}``：本次**禁止再当主题**的标签清单 + 剔除依据。

    为什么要把依据（命中的已有标题）也写进 Prompt：只写"不许用健身"时，模型很容易
    从"它为什么不许用"里脑补出一个更窄的禁令（例如"只许用健身但别做打卡"）。
    把"因为这几条进行中任务已经在做健身"摆出来，规则 11 的语义才是完整的。
    """
    if not evidence:
        return NO_AVOID_THEMES
    lines = [
        "以下主题已被系统从你的素材里**机械剔除**，本次一个都不许再用"
        "（换说法、换工具名、换语言、加「进阶版/自动版」都不算换主题）："
        + "、".join(label for label, _ in evidence),
        "剔除依据是它们已经出现在用户「进行中」的任务标题里：",
    ]
    lines.extend(f"- {label} ← 「{'」「'.join(titles)}」" for label, titles in evidence)
    return "\n".join(lines)


def _theme_hint_text(pain_point: str, dropped_labels: List[str], *, pool_empty: bool) -> str:
    """Prompt 变量 ``{theme_hint}``：本次的**主题方向指令**（四种情形，永远非空）。

    为什么每种情形都要有话说：这一行的作用不是"提醒多样性"，而是**替代被剔掉的素材**。
    素材被剔空时若只给一句"请注意多样性"，模型手里就只剩痛点 + 模板，
    实测会退回"围绕同一批进行中任务再换一个角度"（它就是被这么喂出来的）。
    所以空池分支必须给出**可执行的替代路径**（换维度 -> 换痛点维度 -> 必须产出）。

    四种情形：
    1. 池空且剔过标签：明确"你不能再围绕已用过的主题做任务"，要求换维度/换痛点词；
    2. 池空且什么都没剔（新用户 0 标签）：照旧按痛点模板出起步任务，不要被第 1 条误伤；
    3. 剔过标签但还有候选：优先用剩下的标签/其它维度里没碰过的角度，必要时换痛点词；
    4. 什么都没剔：无强制换主题要求，仍要求挑"现有任务没用过"的角度。
    """
    if pool_empty and dropped_labels:
        return (
            "⚠️ 本次候选主题池**已被清空**：画像里的标签全部与【进行中】任务的主题重叠，"
            f"已全部机械剔除（{'、'.join(dropped_labels)}）。你**不能再围绕这些已用过的主题做任务**，"
            "必须换一个方向：\n"
            "1. 优先用**别的维度**里现有任务完全没碰过的角度：痛点 / 焦虑 / 能力 / 认知 / 兴趣 / 技能 都可用；\n"
            f"2. 如果目标痛点「{pain_point}」这个维度确实已经做遍了，就**换一个痛点维度**"
            "（把输出里的 pain_point 改成一个明显不同的词），在新维度下出题 —— 不要硬凑同题；\n"
            "3. 无论素材多少，都必须输出一个具体、可执行的新任务（不许空着、不许报错）。"
        )
    if pool_empty:
        return (
            f"（该用户还没有任何画像标签，也没有与【进行中】任务的主题重叠）"
            f"请直接按目标痛点「{pain_point}」对应的任务模板给出一个具体、可执行的起步任务，"
            "主题自选一个与痛点贴切的即可。"
        )
    if dropped_labels:
        return (
            "本次候选标签里已经剔除了上面那些**已用过的主题**。请优先从**剩下的标签**或其它维度"
            "（痛点 / 焦虑 / 能力 / 认知 / 兴趣 / 技能）里挑一个现有任务**完全没碰过**的角度；"
            "如果目标痛点这个维度剩下的角度确实也都做过了，就换一个痛点维度"
            "（把输出里的 pain_point 改成一个明显不同的词），不要回到被剔除的主题上硬凑。"
        )
    return (
        "（本次无强制换主题要求：候选标签与【进行中】任务没有主题重叠）"
        "从候选标签里挑一个现有任务还没用过的角度出题。"
    )


DEFAULT_TEMPLATE_KEY = "迷茫"


def template_for_pain(pain_point: str) -> Dict[str, Any]:
    """把痛点词映射到任务模板（离线兜底与 Prompt 提示都用它）。

    匹配顺序：精确命中 -> 互相包含 -> 默认模板。
    这样报告建议里的 ``行动力不足`` / ``简历没有可写的经历`` 能命中对应模板，
    而画像标签里的 ``缺项目经验`` 也能通过"包含 缺项目"命中 ``缺项目`` 模板。
    """
    pain = (pain_point or "").strip()
    if pain in TASK_TEMPLATES:
        return TASK_TEMPLATES[pain]
    for key, template in TASK_TEMPLATES.items():
        if pain and (key in pain or pain in key):
            return template
    return TASK_TEMPLATES[DEFAULT_TEMPLATE_KEY]


# ---------------------------------------------------------------------------
# 任务列表 / 详情
# ---------------------------------------------------------------------------

def list_tasks(db: Session, user: User, status: Optional[str] = None) -> List[TaskResponse]:
    """GET /task：我的任务列表，可按状态过滤。"""
    statement = select(Task).where(Task.user_id == user.id)
    if status:
        statement = statement.where(Task.status == status)
    statement = statement.order_by(Task.created_at.desc())  # type: ignore[union-attr]
    return [_to_response(db, task) for task in db.exec(statement).all()]


def get_task_detail(db: Session, user: User, task_id: UUID) -> TaskDetailResponse:
    """GET /task/{id}：含步骤列表。"""
    task = get_task(db, user, task_id)
    steps = list_steps(db, task.id)
    response = TaskDetailResponse.model_validate(task)
    response.progress = _progress(steps)
    response.steps = [TaskStepResponse.model_validate(s) for s in steps]
    return response


def get_task(db: Session, user: User, task_id: UUID) -> Task:
    """取当前用户自己的任务。

    **「不存在」与「不属于自己」都返回 2001**（项目级编码规则，见 README §8 与
    ``app.core.errors.not_found_unless_owner``）。本函数服务于
    ``GET /task/{id}``、``/{id}/steps/{step_id}/complete``、``/{id}/abandon``。
    """
    return not_found_unless_owner(db.get(Task, task_id), user.id, "任务不存在")


def list_steps(db: Session, task_id: UUID) -> List[TaskStep]:
    statement = (
        select(TaskStep)
        .where(TaskStep.task_id == task_id)
        .order_by(TaskStep.step_order.asc())  # type: ignore[union-attr]
    )
    return list(db.exec(statement).all())


# ---------------------------------------------------------------------------
# 生成任务（11.5）
# ---------------------------------------------------------------------------

async def generate_task(
    db: Session, user: User, payload: TaskGenerateRequest
) -> TaskGenerateResponse:
    """POST /task/generate：痛点 -> 任务 + 步骤拆解。

    11.5：优先用调用方传入的 ``pain_point``（例如成长报告建议里带过来的），
    没有就用画像里的痛点标签；再没有就按阶段给一个通用起步任务。

    ``pain_point`` 是自由文本（报告建议给的是"行动力不足"这类词，
    画像标签给的是"缺项目经验"这类词），模板命中用
    :func:`template_for_pain` 做"精确 -> 互相包含 -> 默认"的降级匹配。

    **服务端去重（不靠模型自觉）**：模型即使被 prompt 要求别重复，仍然会吐出同题标题
    （实测同一个痛点连点 3 次「生成任务」就塞进 2 对同题任务），所以生成后必须自己校验：
    新标题与当前用户**「进行中」**任务的标题命中 :func:`~app.utils.similarity.is_similar`
    （Jaccard + 最长公共子串 + 保护词，三条同时成立，口径见该模块 docstring）时，
    **不新建**，直接返回那条已有任务并把 ``reused`` 置 True。

    三条判定边界（都要保守，宁可漏判不可误判）：
    - **只比「进行中」**：已完成 / 已放弃的同题任务不算重复（放弃后想重做是合理的），
      它们只作为 prompt 素材，让模型"承接/加深"而不是同题重做；
    - **只比标题，不比 pain_point**：同一痛点下产出两件不同的事是正常的
      （实测「迷茫」下有"技术方向小实验""用代码解决一个身边小问题""Java 命令行小工具"
      三件必须继续允许的事），按 pain_point 去重会让用户再也拿不到新任务；
    - 相似度用 :mod:`app.utils.similarity`（与 ``cleanup_duplicate_tasks.py`` 同一份实现）。

    **撞车重试一次（而不是直接复用）**：``is_similar`` 收紧之后出现过一个反向的坏体验 ——
    痛点是「缺项目」时画像里反复出现 "健身" 这类主题词，模型被同一批素材困住、反复产出
    "健身 + 小工具"的变体；这些变体命中去重后**直接走"复用"分支**，于是用户连点几次
    「让 AI 生成任务」都只看到"已经有一个类似的任务了"，感觉功能坏了（原话："这样就生成不了新任务了"）。
    所以命中重复时先**带着"撞上了哪些标题"再问模型一次**（prompt 变量 ``duplicate_feedback``），
    让它换主题/换产物形态；**最多重试 1 次**，成本与延迟可控。
    只有重试后仍然同题、或者重试这条路本身不可用，才回到"复用 + ``reused=true``"的既有契约。

    重试有一条不重试的短路（直接复用），为了不让用户白等一次模型调用：
    第一次的 ``result`` 就是 7.6 兜底值（``empty_task_generate``，说明这次模型调用本身失败了，
    再问一次大概率还是失败）。

    **主题素材的机械剔除（本函数第 3 条约束，修的是"生成的任务主题全都一样"）**：
    进 Prompt 的 ``profile_tags`` 不是画像全量，而是先由 :func:`_plan_theme_material`
    把**已经出现在【进行中】任务标题里**的标签剔掉（用户现场：三条进行中任务都含"健身"
    -> 标签「健身」这次不进 Prompt）。理由与边界见该函数上方的长注释 —— 一句话：
    "别重复主题"必须是**服务端的输入约束**（可留痕、可验证），而不是 Prompt 里的一句请求。
    """
    pain_point = payload.pain_point or _pick_pain_point(db, user)

    tasks = db.exec(select(Task).where(Task.user_id == user.id)).all()
    # prompt 素材按状态分开给：进行中的是"红线"（不许同题），已完成/已放弃的是"可承接"。
    active_tasks = [t for t in tasks if t.status == ACTIVE_TASK_STATUS]
    # 按创建时间倒序：相似度打分相同时复用"最近创建的那条"（见 _find_duplicate_task）。
    active_tasks.sort(key=lambda t: t.created_at, reverse=True)
    finished_tasks = [t for t in tasks if t.status != ACTIVE_TASK_STATUS]
    template_hint = template_for_pain(pain_point)
    # 主题素材：**机械剔除**已经出现在【进行中】任务标题里的画像标签（修复"主题全都一样"）。
    # 只算一次、两次调用（首次 + 撞车重试）共用同一份 -- 否则重试那次可能拿到不同的
    # 标签集，出现"重试时素材悄悄变宽/变窄"的静默降质。
    theme = _plan_theme_material(db, user, active_tasks, pain_point)

    # 第一次生成：duplicate_feedback 明确写"（本次无）"，避免模板里那行以裸冒号结尾
    # （给模型一个残缺的指令行）；重试时才替换成真正的换方向说明。
    result = await _generate_once(
        db,
        user,
        pain_point=pain_point,
        active_tasks=active_tasks,
        finished_tasks=finished_tasks,
        template_hint=template_hint,
        theme=theme,
        duplicate_feedback=NO_DUPLICATE_FEEDBACK,
    )

    duplicated = _find_duplicate_task(active_tasks, result.title)
    if duplicated is not None:
        # 撞车（这正是用户抱怨的场景）：第一次的标题与「进行中」任务同题。
        logger.info(
            "生成任务第一次撞车 user_id=%s pain_point=%s 第一次标题=%s 命中的已有任务 title=%s task_id=%s",
            user.id, pain_point, sanitize(result.title), sanitize(duplicated.title), duplicated.id,
        )
        fallback = empty_task_generate(pain_point)
        if _is_fallback_result(result, fallback):
            # 第一次就是 7.6 兜底值（模型调用本身失败了）：再问一次大概率还是失败，直接复用。
            logger.info(
                "生成任务撞车但不重试（第一次走了兜底值） user_id=%s pain_point=%s 最终=复用 task_id=%s",
                user.id, pain_point, duplicated.id,
            )
        else:
            # 唯一的一次重试：把"撞上了哪些标题"明确交给模型，要求换主题/换产物形态。
            retry_result = await _generate_once(
                db,
                user,
                pain_point=pain_point,
                active_tasks=active_tasks,
                finished_tasks=finished_tasks,
                template_hint=template_hint,
                theme=theme,
                duplicate_feedback=_duplicate_feedback(
                    pain_point, duplicated, result.title, [t.title for t in active_tasks]
                ),
            )
            retry_duplicate = _find_duplicate_task(active_tasks, retry_result.title)
            logger.info(
                "生成任务撞车后重试（最多 1 次） user_id=%s pain_point=%s 第一次标题=%s 重试标题=%s 是否仍撞车=%s%s",
                user.id,
                pain_point,
                sanitize(result.title),
                sanitize(retry_result.title),
                retry_duplicate is not None,
                f" 仍命中的已有任务 title={sanitize(retry_duplicate.title)}"
                f" task_id={retry_duplicate.id}" if retry_duplicate is not None else "",
            )
            result = retry_result
            if retry_duplicate is not None:
                duplicated = retry_duplicate
            else:
                # 换方向成功：这次不再复用，往下走"新建"那条路。
                logger.info(
                    "生成任务撞车重试后换到了不同方向，本次新建 user_id=%s pain_point=%s 新标题=%s",
                    user.id, pain_point, sanitize(result.title),
                )
                duplicated = None

    if duplicated is not None:
        # 重试后仍同题（或第一次就是兜底值）：回到既有契约 —— 复用 + reused=true，不新建。
        logger.info(
            "生成任务最终复用已有任务（不新建） user_id=%s task_id=%s "
            "existing_title=%s final_title=%s pain_point=%s",
            user.id,
            duplicated.id,
            sanitize(duplicated.title),
            sanitize(result.title),
            pain_point,
        )
        return _to_generate_response(get_task_detail(db, user, duplicated.id), reused=True)

    task = Task(
        user_id=user.id,
        title=result.title[:200],
        description=result.description,
        pain_point=result.pain_point or pain_point,
        status=ACTIVE_TASK_STATUS,
        value_note=result.value_note,
        difficulty=result.difficulty,
        estimated_days=result.estimated_days,
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    steps = result.steps or []
    for index, step in enumerate(steps, start=1):
        db.add(
            TaskStep(
                task_id=task.id,
                step_order=step.order or index,
                title=step.title[:200],
                action=step.action,
                resource=step.resource,
            )
        )
    db.commit()
    logger.info("生成任务成功 user_id=%s task_id=%s pain_point=%s", user.id, task.id, pain_point)

    return _to_generate_response(get_task_detail(db, user, task.id), reused=False)


# ---------------------------------------------------------------------------
# 打卡（11.6）
# ---------------------------------------------------------------------------

async def complete_step(
    db: Session,
    user: User,
    task_id: UUID,
    step_id: UUID,
    payload: TaskStepCompleteRequest,
) -> TaskDetailResponse:
    """POST /task/{id}/steps/{step_id}/complete：打卡 + 反馈 + 画像更新。"""
    task = get_task(db, user, task_id)

    step = db.get(TaskStep, step_id)
    if step is None or step.task_id != task.id:
        raise BusinessException(ErrorCode.NOT_FOUND, "任务步骤不存在")

    step.completed = True
    step.feedback = payload.feedback
    step.completed_at = utcnow()
    db.add(step)
    db.commit()

    # 进度推进：全部步骤完成 -> 任务完成
    steps = list_steps(db, task.id)
    if all(s.completed for s in steps):
        task.status = "已完成"
    task.updated_at = utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)

    # 7.8 画像回流：打卡反馈 -> 行动力/自律性标签
    await _extract_task_tags(db, user, task, step, payload.feedback)
    profile_service.recompute_stage(db, user.id)

    # 11.12 奖章触发：**打卡路径也要触发**（原先只在任务变成「已完成」时才触发，
    # 于是「坚持打卡者」这种按步骤累计的奖章要等最多一小时（settle_badges）
    # 才发放 —— 用户"明明做到了却没给"）。现在放在这里，且是**无条件**调用：
    # 引擎一次触发会评估全部条件（任务数 / 步骤数 / 画像标签数），所以这一行同时
    # 覆盖「起步行动家」「坚持打卡者」「方向初现」；放在 `_extract_task_tags` 之后
    # 是为了让本次打卡新抽到的标签也能立刻算进画像那枚奖章的进度。
    # event 只是触发器（日志用），不再决定评估哪些奖章 -> 见 badge_service。
    badge_service.check_and_award(db, user, event="steps_completed")

    return get_task_detail(db, user, task.id)


def abandon_task(db: Session, user: User, task_id: UUID) -> TaskResponse:
    """POST /task/{id}/abandon：放弃任务。"""
    task = get_task(db, user, task_id)
    if task.status == "已完成":
        raise BusinessException(ErrorCode.PARAM_ERROR, "已完成的任务不能放弃")
    task.status = "已放弃"
    task.updated_at = utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return _to_response(db, task)


def delete_task(db: Session, user: User, task_id: UUID) -> TaskDeleteResponse:
    """DELETE /task/{id}：**硬删除**任务 + 它的全部步骤，并立刻重算画像。

    三条实现要点，每一条都是踩过的坑：

    1. **显式按顺序发 Core ``delete()``（子表先、父表后）**，不用 ``db.delete(task)``。
       模型里 ``task_steps.task_id`` 只是 ``foreign_key``，**没有** ``relationship()``、
       也没有 ``ondelete="CASCADE"``；SQLite 的外键强制是本项目自己逐连接打开的
       （见 ``app/db/session.py``）。直接 ``db.delete(task)`` 会先删父行，
       于是撞 ``FOREIGN KEY constraint failed``（或在外键没开的库上留下永久孤儿行）。
       与 ``chat_service.delete_conversation`` 同一套做法（那里也是先 messages 后 conversation）。
       用 Core ``delete()`` 还顺手解决了"ORM 集合为空、级联一个都不删"的问题。

    2. **删完立刻 ``profile_service.recompute_stage``**（同一个事务里、只提交一次）。
       ``action_score`` 的算法是"每个已完成步骤 +8、每个整单完成的任务 +20"
       （见 ``recompute_stage`` 的说明），所以删掉带打卡的任务分数**必然**会下降 ——
       这是"分数=证据"的必然结果，不是 bug（前端负责在删除前把后果说清楚）。
       但分数是**落库的冗余值**，不重算就会一直停在旧值，直到用户下次打卡才纠正；
       删除路径必须自己调用重算，与 ``complete_step`` 结尾那一次是同一个入口。
       放在同一个事务里：要么"任务没了 + 分数已更正"，要么整体回滚，
       不允许出现"任务删了、分数还是旧值"的中间态。

    3. **归属校验沿用 ``get_task``**（``not_found_unless_owner``）：
       "不存在"与"不属于自己"都是 2001，不做区分（README §8.1 规则 1，避免枚举 oracle）。
       重复删除同一个 id 第二次返回 2001，符合预期。

    返回值里的 ``completed_steps`` 是**本次真正删掉的已打卡步骤数**，
    供前端在"删除前"说清后果（删除后没人能再数出来了）。
    """
    task = get_task(db, user, task_id)
    # 先取下来：删除之后这两样都读不到了（title 要回给前端做提示）
    task_id_value = task.id
    title = task.title
    steps = list_steps(db, task.id)
    deleted_steps = len(steps)
    completed_steps = sum(1 for step in steps if step.completed)

    # ① 先删子表（task_steps），② 再删父表（tasks）—— 顺序不可交换，见上面第 1 点
    db.execute(sa_delete(TaskStep).where(TaskStep.task_id == task_id_value))
    db.execute(sa_delete(Task).where(Task.id == task_id_value))

    # ③ 立刻重算画像（action_score / total_score / stage），与删除同一个事务，最后只提交一次
    profile_service.recompute_stage(db, user.id, commit=False)
    db.commit()

    logger.info(
        "删除任务 user_id=%s task_id=%s title=%s 删除步骤=%s（其中已打卡=%s）画像已重算",
        user.id, task_id_value, sanitize(title), deleted_steps, completed_steps,
    )
    return TaskDeleteResponse(
        id=task_id_value,
        title=title,
        deleted_steps=deleted_steps,
        completed_steps=completed_steps,
    )


# ---------------------------------------------------------------------------
# 内部工具
# ---------------------------------------------------------------------------

def _is_fallback_result(result: TaskGenerateResult, fallback: TaskGenerateResult) -> bool:
    """判断这次生成是不是 7.6 兜底值（``empty_task_generate`` 的产物）。

    为什么不直接 ``result == fallback``：``chat_json`` 失败时返回的就是**同一个 default
    对象**，正常情况下两个模型字段会不同；但 Pydantic 的 ``__eq__`` 是全字段比较，
    将来给 ``TaskGenerateResult`` 加一个新增字段（例如 ``reason``）而忘了同步兜底值，
    相等判断就会失效。这里只比"用户能看到的两个字段"，语义是"这就是那条通用兜底任务"。
    """
    return result.title == fallback.title and result.description == fallback.description


async def _generate_once(
    db: Session,
    user: User,
    *,
    pain_point: str,
    active_tasks: List[Task],
    finished_tasks: List[Task],
    template_hint: Dict[str, Any],
    theme: ThemeMaterial,
    duplicate_feedback: str,
) -> TaskGenerateResult:
    """调一次 ``task_generate`` Prompt（结构化输出 + 7.6 兜底）。

    ``duplicate_feedback`` = :data:`NO_DUPLICATE_FEEDBACK`（"本次无"）= 第一次生成；
    非空且是真正的换方向说明 = 撞车后的重试 —— 只有重试那次才会把
    "撞上了哪些标题、必须换方向"塞进 Prompt。

    ``theme`` 是**算好的主题素材**（画像标签已机械剔除已用主题；见
    :class:`ThemeMaterial`）。它由调用方算一次、两次调用共用，理由见 ``generate_task``。

    抽成函数是为了让"第一次"和"重试"共用同一套变量拼装：两处一旦分叉，
    很容易出现"重试时忘了给模板/标签"这种静默降质的 bug。
    """
    variables: Dict[str, Any] = {
        "pain_point": pain_point,
        "stage": profile_service.get_stage(db, user.id),
        # ⚠️ 这里是**剔除后**的标签，不是画像全量：已出现在【进行中】任务标题里的主题
        # （例如三条进行中任务都含"健身" -> 标签「健身」）根本不出现在 Prompt 里。
        "profile_tags": theme.profile_tags,
        "active_tasks": [t.title for t in active_tasks],
        "finished_tasks": [t.title for t in finished_tasks],
        "template_hint": json.dumps(template_hint, ensure_ascii=False),
        # 被机械剔除的主题（禁止清单，含剔除依据）+ 本次的主题方向指令
        # （候选池被剔空时，这两段是模型唯一可依据的素材，所以永远非空）。
        "avoid_themes": theme.avoid_themes,
        "theme_hint": theme.theme_hint,
        # 模板里始终有这个占位符：第一次替换成空串，重试时才填入撞车说明
        "duplicate_feedback": duplicate_feedback,
    }
    return await deepseek_client.chat_prompt_json(
        prompt_name="task_generate",
        variables=variables,
        schema=TaskGenerateResult,
        default=empty_task_generate(pain_point),
        temperature=STRUCTURED_TEMPERATURE,
    )


def _duplicate_feedback(pain_point: str, duplicated: Task, first_title: str, active_titles: List[str]) -> str:
    """撞车重试时塞给模型的"换方向"指令（Prompt 变量 ``duplicate_feedback``）。

    必须**点名列出撞上的标题**：只写"别重复"没用（模型看不到自己撞上的是哪一条），
    而且要把用户「进行中」任务的完整清单再说一遍 —— 只列撞上那一条时，模型很容易从
    "清单里其它没被点名的标题"里再挑一个近似的变体，第二次照样撞车。
    """
    blocked = sorted({first_title.strip(), duplicated.title.strip()} - {""})
    quoted = "、".join(f"「{title}」" for title in blocked)
    existing = "、".join(f"「{title}」" for title in sorted(set(active_titles)))
    return "\n".join([
        "【系统提示：你上一次生成的任务与用户「进行中」的任务同题，已被拦下】",
        f"你上一次想出来的标题：{quoted}",
        f"它与用户已有的任务「{duplicated.title}」是同一件事（判定口径：换说法、换语言、",
        "去掉前缀、换量词/数量、换个工具名都不算新任务；主题词相同就算同一条）。",
        f"用户已有的「进行中」任务清单（一条都不许同题）：{existing}",
        "这次必须做到：",
        "1. 换一个**完全不同的主题或产物形态**（换主题词，不是换说法）；",
        f"2. 如果痛点「{pain_point}」的角度确实都做过了，就换一个**痛点维度**，",
        "   并在输出里把 pain_point 改成一个明显不同的词；",
        "3. 标题与上面每一条都要一眼看出不是同一件事。",
    ])


def _pick_pain_point(db: Session, user: User) -> str:
    """11.5：从画像标签里挑痛点，挑不到就用默认模板。"""
    pains = profile_service.top_pain_points(db, user.id, limit=1)
    return pains[0] if pains else DEFAULT_TEMPLATE_KEY


def _find_duplicate_task(candidates: List[Task], new_title: str) -> Optional[Task]:
    """在 ``candidates``（当前用户的「进行中」任务）里找与 ``new_title`` 同题的那条。

    返回相似度最高的一条（**判定走** :func:`~app.utils.similarity.is_similar`，
    它是"Jaccard + 最长公共子串 + 短标题包含判定 + 保护词"的完整口径，见该模块 docstring），
    没有则 ``None``。

    ``candidates`` 按 ``created_at`` 倒序传入：分数相同时保留最近创建的那条
    （用户最近看到、最可能正在做的那条，与 ``cleanup_duplicate_tasks.py`` 的取舍一致）。
    排序用的分数仍是 bigram Jaccard（"最像的那条"用单一连续分数表达最直观），
    但**能否命中**由那几条规则共同决定 —— 所以这里不能再用
    ``score >= CANDIDATE_SIMILARITY_THRESHOLD`` 当判定（那只是第一条）。
    判定口径是**标题**而不是 ``pain_point``：同痛点下的不同事必须继续允许生成。
    """
    best: Optional[Task] = None
    best_score = 0.0
    target = normalize(new_title)
    for task in candidates:
        if not is_similar(new_title, task.title):
            continue
        score = similarity(target, normalize(task.title))
        # 分数并列时保留先遇到的那条（candidates 已按 created_at 倒序 = 最近创建的）
        if best is None or score > best_score:
            best, best_score = task, score
    return best


def _to_generate_response(detail: TaskDetailResponse, *, reused: bool) -> TaskGenerateResponse:
    """``TaskDetailResponse`` -> ``TaskGenerateResponse``（多的只有 reused 一个字段）。"""
    response = TaskGenerateResponse.model_validate(detail.model_dump())
    response.reused = reused
    return response


def _progress(steps: List[TaskStep]) -> float:
    if not steps:
        return 0.0
    done = sum(1 for s in steps if s.completed)
    return round(done / len(steps), 2)


def _to_response(db: Session, task: Task) -> TaskResponse:
    response = TaskResponse.model_validate(task)
    response.progress = _progress(list_steps(db, task.id))
    return response


async def _extract_task_tags(
    db: Session,
    user: User,
    task: Task,
    step: TaskStep,
    feedback: Optional[str],
) -> List[Dict[str, Any]]:
    """7.8：打卡反馈回流画像（行动力、自律性）。"""
    rule_tags: List[Dict[str, Any]] = [
        {"dimension": "能力", "label": "行动力", "weight": 0.6, "source": "task"},
    ]
    profile_service.apply_tags(db, user.id, rule_tags, source="task")

    if not feedback:
        return rule_tags

    text = f"任务：{task.title}\n步骤：{step.title}\n学生的打卡反馈：{feedback}"
    ai_tags = await profile_service.extract_tags_from_text(db, user.id, text, source="task")
    return rule_tags + ai_tags
