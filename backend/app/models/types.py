"""跨方言的列类型（SQLite 与 PostgreSQL 都要能跑）。

背景：本项目原本只面向 PostgreSQL（手册 2.1 / 2.3 / 5.1），所有"扩展字段"
都用了 ``postgresql.JSONB``。但本机既没有 PostgreSQL 也没有 Docker，
联调必须能在 **SQLite** 上跑起来，而 ``JSONB`` 是 PG 专有类型 ——
在 SQLite 上直接建表会失败。

做法：**同一定义用 ``with_variant`` 同时兼容两种方言**：

- PostgreSQL -> ``JSONB``（保留索引、``->``/``->>``/``@>`` 等查询能力）
- 其它方言（SQLite）-> 通用 ``JSON``（SQLite 用 TEXT 存储）

⚠️ 约定（重要）：**所有 JSON 列统一用本模块的 ``json_column()``**，
不要在模型里散写 ``JSONB()`` / ``JSON()`` —— 散写会在切库时二次踩坑，
而且以后想换回 PG 专有能力时找不到集中改造点。

用法::

    from app.models.types import json_column

    conclusion: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=json_column(),          # <= 就是它
        description="结论卡片",
    )

注意：JSON 列在 SQLAlchemy 里**不追踪内部就地修改**（这就是 ``MutableDict``
存在的意义），改内容必须整体赋值。SQLite 与 PostgreSQL 行为一致，见
``backend/README.md`` 的「数据库：SQLite 与 PostgreSQL 的差异」一节。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Column
from sqlalchemy.dialects.postgresql import JSONB

__all__ = ["JSON_VARIANT", "json_column"]

# PostgreSQL 用 JSONB；其它方言退回通用 JSON。
# with_variant 的作用是"同一个类型对象，在不同方言下编译成不同的 DDL"，
# 因此模型定义不需要关心当前连的是哪种库。
JSON_VARIANT = JSONB().with_variant(JSON(), "sqlite")


def json_column(nullable: bool = True, **kwargs: Any) -> Column:
    """返回一个跨方言的 JSON 列（PG=JSONB，SQLite=JSON/TEXT）。

    参数与 ``sqlalchemy.Column`` 一致，常用的是 ``nullable``、``comment``。
    仅接受类型级参数，避免调用方传进来一个需要 ``ForeignKey`` 的复杂列
    （JSON 扩展字段不应该有外键约束）。
    """
    return Column(JSON_VARIANT, nullable=nullable, **kwargs)
