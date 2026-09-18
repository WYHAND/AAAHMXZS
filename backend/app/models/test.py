"""test_results / test_questions：基础测试表结果与题库。

手册 5.2 的表清单里只有 ``test_results``，没有题库表 —— 但手册 5.4 明确要求
"基础测试题 30-50 题"作为种子数据，而骨架早期把题库硬编码在 Python 常量里，
结果接口 ``GET /test/questions`` 看起来有数据、数据库里却什么都没有
（临时占位题的 id 甚至是全零 UUID），用假数据做题还会污染 ``test_results``。
现在按 5.4 的意图补一张 ``test_questions`` 表，题库真正落库（见 README §6 ㉚）。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel

from app.models.types import json_column
from app.models.user import utcnow


class TestQuestion(SQLModel, table=True):
    """基础测试题（题库，非用户数据）。

    - ``code``：稳定的业务编号（如 ``q_clarity_01``），对外接口的 ``id`` 就是它 ——
      用业务编号而不是 UUID 做对外 id，前端/调试/画像规则引用起来都更稳
      （``_apply_test_tags`` 的规则就是按 code 匹配的）；
    - ``dimension``：``clarity`` / ``action`` / ``resume`` / ``interest``（11.3 的计分维度）；
    - ``options``：``[{"key": "A", "text": "...", "score": 5}, ...]``，score 0-5 用于加权计分；
    - ``order_no``：展示顺序（``order`` 是 SQL 关键字，字段名加 ``_no`` 避免转义）。
    """

    __tablename__ = "test_questions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    code: str = Field(max_length=50, index=True, unique=True, description="稳定业务编号，对外即题目 id")
    dimension: str = Field(max_length=50, index=True, description="clarity/action/resume/interest")
    content: str = Field(description="题干")
    options: Optional[List[Dict[str, Any]]] = Field(
        default=None, sa_column=json_column(), description="选项数组（含分值）"
    )
    multiple: bool = Field(default=False, description="是否多选（当前题库全是单选）")
    order_no: int = Field(default=0, index=True, description="展示顺序")

    created_at: datetime = Field(default_factory=utcnow)


class TestResult(SQLModel, table=True):
    """一次测试提交。

    - ``answers``：逐题作答明细，形如 ``{"q_clarity_01": "B", ...}``（存原始作答，便于复核）；
    - ``free_text``：可选文字补充（11.2 第 4 步交给 DeepSeek 抽标签）；
    - 三个分项分数 / 总分 / 阶段：**与 ``profiles`` 表落库后的值保持一致**
      （提交时先算测试分，再按实际行为重算画像，最后把画像值写回本行）。
      这样 ``POST /test/submit`` 的响应、本行记录、``GET /profile`` 三处不会打架 ——
      曾经出现过"提交返回 100 分/冲刺期、GET /profile 是 40 分/准备期"的实测 bug。
    """

    __tablename__ = "test_results"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    answers: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=json_column(),
        description="答题明细（原始作答）",
    )
    free_text: Optional[str] = Field(default=None, description="可选文字补充")

    clarity_score: float = Field(default=0.0)
    action_score: float = Field(default=0.0)
    resume_score: float = Field(default=0.0)
    total_score: float = Field(default=0.0)
    stage: str = Field(default="探索期", max_length=20)

    created_at: datetime = Field(default_factory=utcnow)
