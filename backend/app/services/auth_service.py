"""认证业务逻辑（手册 11.1 注册登录、6.8 JWT、14.3 密码）。"""

from __future__ import annotations

import hashlib
from typing import Optional
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.config import settings
from app.core.errors import BusinessException, ErrorCode
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, utcnow
from app.schemas.user import TokenResponse, UserCreate, UserResponse, UserUpdate
from app.utils.logger import get_logger, sanitize
from app.utils.stage import STAGE_EXPLORE

logger = get_logger(__name__)


def _identifier_fingerprint(value: str) -> str:
    """日志用的账号指纹：用户名/手机号/学号可能是 PII，不能原样落日志。

    用稳定短哈希而不是掩码（``138****1234``）：既能关联"同一账号的连续失败"，
    又不会把手机号的前后几位写进日志文件。
    """
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """按用户名查用户，已软删除的不返回。"""
    statement = select(User).where(User.username == username, User.deleted_at.is_(None))  # type: ignore[union-attr]
    return db.exec(statement).first()


def get_user_by_id(db: Session, user_id: UUID) -> Optional[User]:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        return None
    return user


def build_token_response(db: Session, user: User) -> TokenResponse:
    """签发 token（11.1 第 1/2 步都返回 token）。"""
    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserResponse.model_validate(user),
    )


def register(db: Session, payload: UserCreate) -> TokenResponse:
    """注册：用户名+密码 → 创建用户 → 返回 token。

    用户行与画像行在**同一个事务**里提交：画像创建失败时用户也不会留下，
    不会出现"能登录但没有画像"的半条注册记录。

    并发注册同名用户时，``get_user_by_username`` 的预检查会同时通过，
    真正兜底的是 ``users.username`` 的唯一索引；捕获 ``IntegrityError``
    后返回 1001，而不是让 500 冒到前端。
    """
    if get_user_by_username(db, payload.username) is not None:
        raise BusinessException(ErrorCode.PARAM_ERROR, "该用户名已被注册")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        school=payload.school,
        major=payload.major,
        grade=payload.grade,
    )
    db.add(user)
    try:
        # 先 flush 用户行：唯一索引冲突在此暴露，此时还没有提交任何数据。
        db.flush()

        # 画像初始化与用户同一事务（阶段默认探索期，附录B 0-30 分）。
        from app.models.profile import Profile  # 局部导入，避免 models 包级循环

        db.add(Profile(user_id=user.id, stage=STAGE_EXPLORE))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        logger.warning(
            "注册失败（数据约束冲突，通常是用户名已被占用） username_fp=%s err=%s",
            _identifier_fingerprint(payload.username),
            sanitize(exc),
        )
        raise BusinessException(ErrorCode.PARAM_ERROR, "该用户名已被注册") from exc

    db.refresh(user)
    logger.info("用户注册成功 user_id=%s", user.id)
    return build_token_response(db, user)


def login(db: Session, username: str, password: str) -> TokenResponse:
    """登录：校验密码 → 返回 token；失败统一提示，不暴露用户是否存在。"""
    user = get_user_by_username(db, username)
    if user is None or not verify_password(password, user.password_hash):
        logger.warning("登录失败 username_fp=%s", _identifier_fingerprint(username))
        raise BusinessException(ErrorCode.PARAM_ERROR, "用户名或密码错误")
    logger.info("用户登录成功 user_id=%s", user.id)
    return build_token_response(db, user)


def get_me(db: Session, user: User) -> UserResponse:
    """GET /auth/me。"""
    return UserResponse.model_validate(user)


def update_me(db: Session, user: User, payload: UserUpdate) -> UserResponse:
    """更新个人资料（骨架扩展，路由层未开放，供 profile 模块复用）。"""
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(user, key, value)
    user.updated_at = utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)
