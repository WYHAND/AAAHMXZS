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

# HTTP 状态码 -> 业务错误码（6.5 错误码表），供 main.py 的 HTTPException handler 复用。
#
# 背景（6.6 的适用范围）：
# 6.6 示例只讲 ``BusinessException`` 返回 HTTP 200；它并没有要求
# ``HTTPException``（404/401/405…）也变成 200。把传输层错误也压成 200 会让
# 浏览器、Nginx、Electron、监控和 curl 全部分不清"成功"和"服务挂了"，
# 而且 ``get_current_user`` 抛的未登录必须是真正的 401，否则前端拦截器与
# 任何标准中间件都会失效。所以：
#   - ``BusinessException``          -> HTTP 200（照 6.6）
#   - 参数校验失败                     -> HTTP 200 + code 1001
#   - ``HTTPException``              -> 保留原始 HTTP 状态码，code 按本表映射
#   - 未捕获 ``Exception``            -> HTTP 500 + code 5000
# 业务语义始终由信封里的 ``code`` 表达，HTTP 状态码只表达传输层语义。
HTTP_STATUS_TO_CODE: dict[int, int] = {
    400: ErrorCode.PARAM_ERROR,
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.PARAM_ERROR,
    409: ErrorCode.PARAM_ERROR,
    413: ErrorCode.PARAM_ERROR,
    415: ErrorCode.PARAM_ERROR,
    422: ErrorCode.PARAM_ERROR,
    429: ErrorCode.PARAM_ERROR,
    500: ErrorCode.INTERNAL_ERROR,
    502: ErrorCode.INTERNAL_ERROR,
    503: ErrorCode.INTERNAL_ERROR,
    504: ErrorCode.AI_ERROR,
}


def http_status_to_code(status_code: int) -> int:
    """把 HTTP 状态码映射成 6.5 的业务码；未登记的走 2001/5000 大方向。"""
    if status_code in HTTP_STATUS_TO_CODE:
        return int(HTTP_STATUS_TO_CODE[status_code])
    if 400 <= status_code < 500:
        return int(ErrorCode.PARAM_ERROR)
    return int(ErrorCode.INTERNAL_ERROR)


# 业务错误码 -> HTTP 状态码（**唯一推导落点**）。
#
# 为什么必须有这张表：同一个业务码在代码里有两种写法 ——
#   BusinessException(ErrorCode.NOT_FOUND, "简历不存在")   # 裸构造
#   BusinessException.not_found("简历不存在")              # 便捷构造
# 如果只有便捷构造带 status_code，就会出现「语义相同、状态码不同」：
# 实测中发现过 2001 有时 404、有时 200，1002 有时 401、有时 200
# （`security.py` 的三处裸构造就是漏网的）。前端、Nginx、监控只看得到状态码，
# 这种不一致会直接变成"偶发跳不过登录页"这类难排查的问题。
# 因此把推导收进 __init__：只要 code 相同，HTTP 状态就一定相同。
#
# 刻意**不**登记的码（保持 HTTP 200，业务语义由 code 表达）：
#   3001 AI 调用失败 -> 外部依赖抖动的业务结果，前端按 code 提示重试（7.6）
CODE_TO_HTTP_STATUS: dict[int, int] = {
    int(ErrorCode.PARAM_ERROR): 400,
    int(ErrorCode.UNAUTHORIZED): 401,
    int(ErrorCode.FORBIDDEN): 403,
    int(ErrorCode.NOT_FOUND): 404,
    int(ErrorCode.INTERNAL_ERROR): 500,
}



class BusinessException(Exception):
    """可预期的业务失败。

    - ``status_code=None``（默认）-> 全局 handler 返回 **HTTP 200** + ``{code,message,data}``（6.6）
    - ``status_code=401/403/404/...`` -> 保留该 HTTP 状态码，code 仍按错误码表给
      （用于"认证/授权/资源不存在"这类传输层语义必须准确的场景，见 HTTP_STATUS_TO_CODE 注释）

    用法::

        raise BusinessException(ErrorCode.NOT_FOUND, "简历不存在")        # HTTP 200 + code 2001
        raise BusinessException.unauthorized()                          # HTTP 401 + code 1002
        raise BusinessException.forbidden("无权访问")                    # HTTP 403 + code 1003
    """

    def __init__(self, code: int = ErrorCode.INTERNAL_ERROR, message: Optional[str] = None,
                 data: Any = None, status_code: Optional[int] = None) -> None:
        self.code = int(code)
        self.message = message or DEFAULT_MESSAGES.get(self.code, "未知错误")
        self.data = data
        # 未显式指定时按业务码推导（CODE_TO_HTTP_STATUS 是唯一落点）：
        # 这样裸构造与便捷构造得到同一个状态码，不会再出现"同码不同状态"。
        self.status_code = status_code if status_code is not None else CODE_TO_HTTP_STATUS.get(self.code)
        super().__init__(f"[{self.code}] {self.message}")

    # ---- 便捷构造 ----
    # 这些方法**不再显式传 status_code**：HTTP 状态一律由 CODE_TO_HTTP_STATUS 推导，
    # 保证"裸构造 = 便捷构造"，不会出现同码不同状态。
    @classmethod
    def param_error(cls, message: str = "参数错误", data: Any = None) -> "BusinessException":
        return cls(ErrorCode.PARAM_ERROR, message, data)

    @classmethod
    def unauthorized(cls, message: str = "未登录") -> "BusinessException":
        return cls(ErrorCode.UNAUTHORIZED, message)

    @classmethod
    def forbidden(cls, message: str = "权限不足") -> "BusinessException":
        """**慎用**：只用于「请求合法但操作本身越权、与资源归属无关」的场景
        （例如管理员接口、被封禁用户）。查用户私有资源时禁止用它区分归属，
        必须用 :func:`not_found_unless_owner`。见 README §8 的编码规则。
        """
        return cls(ErrorCode.FORBIDDEN, message)

    @classmethod
    def not_found(cls, message: str = "资源不存在") -> "BusinessException":
        return cls(ErrorCode.NOT_FOUND, message)

    @classmethod
    def ai_error(cls, message: str = "AI调用失败") -> "BusinessException":
        # AI 失败是应用层依赖故障，不是传输层错误 -> 仍走 HTTP 200 + code 3001（7.6 语义）
        return cls(ErrorCode.AI_ERROR, message)

    @classmethod
    def internal(cls, message: str = "服务器内部错误") -> "BusinessException":
        return cls(ErrorCode.INTERNAL_ERROR, message)


def not_found_unless_owner(
    resource: Optional[Any],
    current_user_id: Any,
    message: str = "资源不存在",
    owner_attr: str = "user_id",
) -> Any:
    """**项目级编码规则（README §8.1 规则 1）**：按 id 查用户私有资源时，
    「不存在」与「不属于你」返回同一个错误码。

    规则原文（README §8）：

    > 查私有资源时，"不存在"与"不属于你"必须返回同一个错误码 **2001**；
    > 禁止用 1003 区分，否则错误码成为可枚举的 oracle。

    为什么：如果"不属于你"返回 1003、而"不存在"返回 2001，攻击者就能拿错误码当
    oracle —— 遍历 id 时凡是回 1003 的就说明该记录真实存在（只是不属于自己），
    等于白送一份"哪些 id 有效"的清单。简历/面试/对话这类资源一旦确认存在，
    结合其他信息就能进一步推断（谁在用、什么时候创建的）。

    正确做法是统一返回 2001（HTTP 404），让调用方无法区分这两种情况。
    这也符合 OWASP 对 IDOR 的通行建议（返回 404 而不是 403）。

    用法::

        def get_resume(db, user, resume_id) -> Resume:
            return not_found_unless_owner(db.get(Resume, resume_id), user.id, "简历不存在")

    注意：``resource`` 为 ``None`` 时不访问其属性；``owner_id`` 也从 ``resource`` 上取，
    因此传 ``None`` 是安全的。归属不符时**不记日志**（避免被当成探测信号刷日志，
    也避免日志里出现"谁在探测谁的资源"这类无意义噪音）——需要排查时看 404 计数即可。
    """
    owner_id = getattr(resource, owner_attr, None) if resource is not None else None
    if resource is None or owner_id != current_user_id:
        raise BusinessException.not_found(message)
    return resource
