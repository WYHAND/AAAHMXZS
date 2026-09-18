"""认证业务逻辑（手册 11.1 注册登录、6.8 JWT、14.3 密码）。"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlmodel import Session, select

from app.core.config import settings
from app.core.errors import BusinessException, ErrorCode
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, utcnow
from app.schemas.user import TokenResponse, UserCreate, UserResponse, UserUpdate
from app.utils.logger import get_logger
from app.utils.stage import STAGE_EXPLORE

logger = get_logger(__name__)


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

    TODO(画像初始化)：注册后是否需要立刻建一条空画像，手册未明确，
    当前做法是懒创建（``profile_service.get_or_create_profile``），见 README「待确认」。
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
    db.commit()
    db.refresh(user)

    # 兜底：确保画像主表存在，阶段默认探索期（附录B 0-30 分）
    _ensure_profile(db, user.id, STAGE_EXPLORE)

    logger.info("用户注册成功 user_id=%s", user.id)
    return build_token_response(db, user)


def login(db: Session, username: str, password: str) -> TokenResponse:
    """登录：校验密码 → 返回 token；失败统一提示，不暴露用户是否存在。"""
    user = get_user_by_username(db, username)
    if user is None or not verify_password(password, user.password_hash):
        logger.warning("登录失败 username=%s", username)
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


def _ensure_profile(db: Session, user_id: UUID, stage: str = STAGE_EXPLORE) -> None:
    """内部：确保画像主表存在（懒创建）。"""
    from app.models.profile import Profile

    existing = db.exec(select(Profile).where(Profile.user_id == user_id)).first()
    if existing is not None:
        return
    profile = Profile(user_id=user_id, stage=stage)
    db.add(profile)
    db.commit()
