"""统一响应包装。

对应《开发手册》6.5 统一响应格式与 10.1 通用规范::

    {"code": 0, "message": "success", "data": {...}}

设计说明（与 6.2 示例的冲突，见 README「待确认」）：
6.2 的示例写成 ``response_model=ChatResponse``，直接返回业务对象；
6.5/10.1 又要求所有响应包一层 ``{code,message,data}``。
本实现以 6.5/10.1 为准：**所有** JSON 接口都返回信封，
路由上写 ``response_model=ApiResponse[ChatResponse]``，
既满足统一包装，又保留 OpenAPI 的 data 结构描述。
"""

from __future__ import annotations

from typing import Any, Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.core.errors import ErrorCode

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """统一响应信封。``ApiResponse[UserResponse]`` 表示 data 是 UserResponse。"""

    model_config = ConfigDict(from_attributes=True)

    code: int = Field(default=int(ErrorCode.SUCCESS), description="0 表示成功，非 0 见 6.5 错误码表")
    message: str = Field(default="success", description="提示信息")
    data: Optional[T] = Field(default=None, description="业务数据，失败时为 null")

    @property
    def success(self) -> bool:
        return self.code == int(ErrorCode.SUCCESS)

    # ---- 构造工具（需求要求的 ok / fail） ----
    @classmethod
    def ok(cls, data: T = None, message: str = "success") -> "ApiResponse[T]":
        """成功响应。"""
        return cls(code=int(ErrorCode.SUCCESS), message=message, data=data)

    @classmethod
    def fail(cls, code: int = ErrorCode.INTERNAL_ERROR, message: str = "服务器内部错误",
             data: Any = None) -> "ApiResponse[Any]":
        """失败响应；注意 HTTP 状态码仍然是 200（见 6.6）。"""
        return cls(code=int(code), message=message, data=data)


def ok(data: T = None, message: str = "success") -> ApiResponse[T]:
    """函数式写法：``return ok(payload)``。"""
    return ApiResponse.ok(data, message)


def fail(code: int = ErrorCode.INTERNAL_ERROR, message: str = "服务器内部错误",
         data: Any = None) -> ApiResponse[Any]:
    """函数式写法：``return fail(ErrorCode.NOT_FOUND, "简历不存在")``。"""
    return ApiResponse.fail(code, message, data)


class PageData(BaseModel, Generic[T]):
    """列表类接口的 data 结构（10.1 未规定分页体，这里给一个统一形状）。"""

    total: int = 0
    page: int = 1
    page_size: int = 20
    items: List[T] = Field(default_factory=list)
