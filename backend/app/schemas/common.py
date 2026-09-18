"""common：统一响应信封的 schema 出口（实现见 app.core.api_response）。"""

from app.core.api_response import ApiResponse, PageData, fail, ok

__all__ = ["ApiResponse", "PageData", "ok", "fail"]
