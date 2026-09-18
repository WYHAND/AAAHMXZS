"""user / auth 相关 schema。"""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserCreate(BaseModel):
    """注册入参（11.1：用户名 + 密码）。"""

    username: str = Field(min_length=3, max_length=50, description="用户名/手机号/学号")
    password: str = Field(min_length=6, max_length=64, description="明文密码，仅入参使用")
    school: Optional[str] = Field(default=None, max_length=100)
    major: Optional[str] = Field(default=None, max_length=100)
    grade: Optional[str] = Field(default=None, max_length=20, description="大一/大二/大三/大四/研究生")


class UserUpdate(BaseModel):
    """可更新的资料字段（不含密码）。"""

    school: Optional[str] = Field(default=None, max_length=100)
    major: Optional[str] = Field(default=None, max_length=100)
    grade: Optional[str] = Field(default=None, max_length=20)


class UserLoginRequest(BaseModel):
    """登录入参。"""

    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1, max_length=64)


class UserResponse(BaseModel):
    """用户出参（绝不包含 password_hash）。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    school: Optional[str] = None
    major: Optional[str] = None
    grade: Optional[str] = None
    created_at: datetime


class TokenResponse(BaseModel):
    """注册/登录返回：token 及其元信息。"""

    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="有效期秒数")
    user: UserResponse
