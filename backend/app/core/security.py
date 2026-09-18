"""密码哈希与 JWT。

对应《开发手册》6.8 JWT鉴权、11.1 注册登录、14.2 JWT、14.3 密码、14.6 日志脱敏。

- 密码：passlib + bcrypt
- Token：python-jose，HS256，默认 24 小时
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.errors import BusinessException, ErrorCode

# bcrypt 有 72 字节上限，超长密码先截断（否则 passlib 会告警/报错）
_BCRYPT_MAX_BYTES = 72

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _prepare(password: str) -> str:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES].decode("utf-8", errors="ignore")


def hash_password(password: str) -> str:
    """注册/改密时使用。"""
    return pwd_context.hash(_prepare(password))


def verify_password(plain_password: str, password_hash: str) -> bool:
    """登录校验；哈希格式异常时返回 False 而不是抛错。"""
    try:
        return pwd_context.verify(_prepare(plain_password), password_hash)
    except Exception:  # noqa: BLE001 - passlib 可能抛 UnknownHashError 等
        return False


def create_access_token(
    subject: UUID | str,
    expires_minutes: Optional[int] = None,
    extra_claims: Optional[dict[str, Any]] = None,
) -> str:
    """签发 access_token，``sub`` 存用户 id（字符串形式的 UUID）。"""
    minutes = expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=minutes)).timestamp()),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """解析 token；失败抛 1002 未登录（业务异常，HTTP 仍 200）。"""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:  # 过期、签名错误、格式错误
        raise BusinessException(ErrorCode.UNAUTHORIZED, "登录已失效，请重新登录") from exc


def get_subject_from_token(token: str) -> UUID:
    """从 token 取 user_id。供 ``deps.get_current_user`` 使用。"""
    payload = decode_access_token(token)
    sub = payload.get("sub")
    if not sub:
        raise BusinessException(ErrorCode.UNAUTHORIZED, "token 缺少 subject")
    try:
        return UUID(str(sub))
    except ValueError as exc:
        raise BusinessException(ErrorCode.UNAUTHORIZED, "token subject 不是合法用户 id") from exc
