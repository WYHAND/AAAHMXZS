"""users：用户表（手册 5.3）。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    """统一的时间戳工厂（naive UTC，与 PostgreSQL TIMESTAMP 对齐）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(SQLModel, table=True):
    """用户。

    | 字段 | 类型 | 说明 |
    |---|---|---|
    | id | UUID | 主键 |
    | username | VARCHAR(50) | 用户名/手机号/学号 |
    | password_hash | VARCHAR(255) | 密码哈希 |
    | school | VARCHAR(100) | 学校 |
    | major | VARCHAR(100) | 专业大类 |
    | grade | VARCHAR(20) | 年级 |
    | created_at / updated_at | TIMESTAMP | 时间戳 |
    | deleted_at | TIMESTAMP | 软删除 |
    """

    __tablename__ = "users"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    # 用户名/手机号/学号：唯一，登录标识
    username: str = Field(max_length=50, index=True, unique=True, description="用户名/手机号/学号")
    password_hash: str = Field(max_length=255, description="bcrypt 哈希，禁止出参")

    school: Optional[str] = Field(default=None, max_length=100)
    major: Optional[str] = Field(default=None, max_length=100)
    grade: Optional[str] = Field(default=None, max_length=20)

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True, description="软删除时间，空表示未删除")

    def __repr__(self) -> str:  # 日志脱敏：绝不打印 password_hash
        return f"<User id={self.id} username={self.username}>"
