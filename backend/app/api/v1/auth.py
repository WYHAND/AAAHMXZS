"""Auth 路由（10.2 Auth：register / login / me）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.user import TokenResponse, UserCreate, UserLoginRequest, UserResponse
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["Auth 注册登录"])


@router.post("/register", response_model=ApiResponse[TokenResponse], summary="注册")
def register(payload: UserCreate, db: Session = Depends(get_db)) -> ApiResponse[TokenResponse]:
    """11.1：用户名+密码 -> 创建用户 -> 返回 token。

    ⚠️ 刻意写成同步 ``def``：``bcrypt`` 哈希是 100ms 级的 CPU 密集操作，
    放在 ``async def`` 里会**阻塞整个事件循环**（一个人注册，所有人卡住）。
    同步路由由 FastAPI 丢进线程池执行，不会挡住其它请求。
    """
    return ApiResponse.ok(auth_service.register(db, payload))


@router.post("/login", response_model=ApiResponse[TokenResponse], summary="登录")
def login(payload: UserLoginRequest, db: Session = Depends(get_db)) -> ApiResponse[TokenResponse]:
    """11.1：校验密码 -> 返回 token（有效期 24 小时）。

    同 ``register``：bcrypt 校验是 CPU 密集操作，必须走同步路由的线程池。
    """
    return ApiResponse.ok(auth_service.login(db, payload.username, payload.password))


@router.get("/me", response_model=ApiResponse[UserResponse], summary="当前用户")
async def me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[UserResponse]:
    """6.8：从 Authorization: Bearer <token> 解析当前用户。"""
    return ApiResponse.ok(auth_service.get_me(db, current_user))
