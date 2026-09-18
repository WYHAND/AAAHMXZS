"""依赖注入。

对应《开发手册》6.4 依赖注入：get_db / get_current_user / get_settings。
"""

from __future__ import annotations

from typing import Generator, Optional

from fastapi import Depends, Header, Request
from sqlmodel import Session

from app.core.config import Settings, get_settings
from app.core.errors import BusinessException, ErrorCode
from app.core.security import get_subject_from_token
from app.db.session import SessionLocal

__all__ = ["get_db", "get_current_user", "get_current_user_optional", "get_settings", "oauth2_scheme"]


def get_db() -> Generator[Session, None, None]:
    """每个请求一个数据库会话；异常时回滚，结束时关闭。"""
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _extract_bearer(authorization: Optional[str]) -> str:
    """从 ``Authorization: Bearer <token>`` 中取出 token。"""
    if not authorization:
        raise BusinessException(ErrorCode.UNAUTHORIZED, "缺少 Authorization 请求头")
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise BusinessException(ErrorCode.UNAUTHORIZED, "Authorization 格式应为 'Bearer <token>'")
    return parts[1].strip()


class _Bearer:
    """极简认证依赖：避免直接依赖 python-multipart 之外的额外包。

    返回原始 token 字符串，供 ``get_current_user`` 使用。
    """

    async def __call__(self, authorization: Optional[str] = Header(default=None)) -> str:
        return _extract_bearer(authorization)


oauth2_scheme = _Bearer()


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> "object":
    """解析 JWT 并返回当前用户（app.models.user.User）。

    返回类型用字符串注解是为了避免 models -> schemas -> core 的循环导入，
    运行时返回的就是 User 实例。
    """
    from app.models.user import User  # 局部导入，避免循环依赖

    user_id = get_subject_from_token(token)
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise BusinessException(ErrorCode.UNAUTHORIZED, "用户不存在或已注销")
    return user


def get_current_user_optional(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> "Optional[object]":
    """可选登录：无 token 返回 None（供 SSE 等场景降级使用）。"""
    if not authorization:
        return None
    try:
        return get_current_user(_extract_bearer(authorization), db)
    except BusinessException:
        return None


def get_request_settings(request: Request) -> Settings:
    """从 app.state 取配置（main.py 启动时已写入），拿不到则回退全局 settings。"""
    return getattr(request.app.state, "settings", None) or get_settings()
