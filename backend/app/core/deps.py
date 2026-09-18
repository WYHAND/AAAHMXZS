"""依赖注入。

对应《开发手册》6.4 依赖注入：get_db / get_current_user / get_settings。
"""

from __future__ import annotations

from typing import Generator, Optional

from fastapi import Depends, Header, Request
from sqlmodel import Session

from app.core.config import Settings, get_settings
from app.core.errors import BusinessException
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
        raise BusinessException.unauthorized("缺少 Authorization 请求头")
    parts = authorization.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise BusinessException.unauthorized("Authorization 格式应为 'Bearer <token>'")
    return parts[1].strip()


def oauth2_scheme(authorization: Optional[str] = Header(default=None)) -> str:
    """认证依赖：从 ``Authorization: Bearer <token>`` 里取出 token 字符串。

    ⚠️ **必须写成普通函数，不要改回"可调用类实例"**（例如 ``oauth2_scheme = _Bearer()``）。
    原因：本模块有 ``from __future__ import annotations``，所有注解都是**字符串**
    （``"Optional[str]"``），FastAPI 需要用函数所在模块的 ``__globals__`` 去解析它。
    FastAPI 取 globalns 的方式是 ``getattr(call, "__globals__", {})`` ——
    **类实例没有 ``__globals__``**（只有函数/绑定方法有），于是 globalns 变成 ``{}``，
    ``Optional`` 解析不出来，生成 OpenAPI 时会炸：

        pydantic.errors.PydanticUserError:
        `TypeAdapter[Annotated[ForwardRef('Optional[str]'), Header(None)]]`
        is not fully defined

    （这个坑就是实际跑 ``app.openapi()`` 时暴露出来的，见 README §5.1 的验证记录。）
    """
    return _extract_bearer(authorization)


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
        raise BusinessException.unauthorized("用户不存在或已注销")
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
