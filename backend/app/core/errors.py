"""业务错误码与业务异常。

对应《开发手册》6.5 错误码表与 6.6 异常处理。

矛盾记录（手册内部冲突，见 backend/README.md「待确认」）：
- 6.5 的“统一响应格式”示例里 ``data`` 是 ``{}``；
- 6.6 的异常处理器示例里 ``data`` 是 ``None``。
本实现按 6.6 处理：成功时 data 为业务对象，失败时 data 为 None（``ApiResponse.fail``）。
"""

from __future__ import annotations

from enum import IntEnum
from typing import Any, Optional


class ErrorCode(IntEnum):
    """6.5 / 10.3 错误码表。"""

    SUCCESS = 0
    PARAM_ERROR = 1001
    UNAUTHORIZED = 1002
    FORBIDDEN = 1003
    NOT_FOUND = 2001
    AI_ERROR = 3001
    INTERNAL_ERROR = 5000


# 便于 handler 里直接引用（``from app.core.errors import CODE_NOT_FOUND``）
CODE_SUCCESS = ErrorCode.SUCCESS
CODE_PARAM_ERROR = ErrorCode.PARAM_ERROR
CODE_UNAUTHORIZED = ErrorCode.UNAUTHORIZED
CODE_FORBIDDEN = ErrorCode.FORBIDDEN
CODE_NOT_FOUND = ErrorCode.NOT_FOUND
CODE_AI_ERROR = ErrorCode.AI_ERROR
CODE_INTERNAL_ERROR = ErrorCode.INTERNAL_ERROR

DEFAULT_MESSAGES: dict[int, str] = {
    ErrorCode.SUCCESS: "success",
    ErrorCode.PARAM_ERROR: "参数错误",
    ErrorCode.UNAUTHORIZED: "未登录",
    ErrorCode.FORBIDDEN: "权限不足",
    ErrorCode.NOT_FOUND: "资源不存在",
    ErrorCode.AI_ERROR: "AI调用失败",
    ErrorCode.INTERNAL_ERROR: "服务器内部错误",
}


class BusinessException(Exception):
    """所有可预期的业务失败都抛这个，由全局 handler 转成 HTTP 200 + {code,message,data}。

    用法::

        raise BusinessException(ErrorCode.NOT_FOUND, "简历不存在")
        raise BusinessException.not_found("简历不存在")
    """

    def __init__(self, code: int = ErrorCode.INTERNAL_ERROR, message: Optional[str] = None,
                 data: Any = None) -> None:
        self.code = int(code)
        self.message = message or DEFAULT_MESSAGES.get(self.code, "未知错误")
        self.data = data
        super().__init__(f"[{self.code}] {self.message}")

    # ---- 便捷构造 ----
    @classmethod
    def param_error(cls, message: str = "参数错误", data: Any = None) -> "BusinessException":
        return cls(ErrorCode.PARAM_ERROR, message, data)

    @classmethod
    def unauthorized(cls, message: str = "未登录") -> "BusinessException":
        return cls(ErrorCode.UNAUTHORIZED, message)

    @classmethod
    def forbidden(cls, message: str = "权限不足") -> "BusinessException":
        return cls(ErrorCode.FORBIDDEN, message)

    @classmethod
    def not_found(cls, message: str = "资源不存在") -> "BusinessException":
        return cls(ErrorCode.NOT_FOUND, message)

    @classmethod
    def ai_error(cls, message: str = "AI调用失败") -> "BusinessException":
        return cls(ErrorCode.AI_ERROR, message)

    @classmethod
    def internal(cls, message: str = "服务器内部错误") -> "BusinessException":
        return cls(ErrorCode.INTERNAL_ERROR, message)
