"""FastAPI 应用入口（《开发手册》4.1 main.py）。

职责（对应手册章节）：
- 创建 FastAPI 实例、CORS（3.10 前端跨域）
- 挂载 ``app/api/router.py`` 的 ``/api/v1`` 总路由（6.2 / 6.9 / 10.1）
- 全局异常处理器：BusinessException / 参数校验 / HTTPException / 兜底 500
  （6.6：业务异常返回 HTTP 200 + ``{code,message,data}``）
- 启动时初始化 APScheduler（12.1 / 12.2），关闭时优雅停止

⚠️ 安全：**不挂载** ``uploads/`` 静态目录（14.5 / 14.1）。
现在**没有任何对外读简历文件的端点**（老简历链路的 ``GET /api/v1/resume/{id}/file``
已随链路整体删除，见勘误 9.17）；这条纪律对**以后任何文件类功能**仍然成立，
原因见 ``create_app()`` 里的注释。

启动命令（3.6）::

    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.router import API_V1_PREFIX, api_router
from app.core.api_keys import ApiKeyHeaderMiddleware
from app.core.api_response import ApiResponse
from app.core.config import get_settings
from app.core.errors import (
    DEFAULT_MESSAGES,
    BusinessException,
    ErrorCode,
    http_status_to_code,
)
from app.core.rate_limit import check as check_rate_limit
from app.utils.logger import configure_logging, get_logger, sanitize

settings = get_settings()
logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# 全局异常处理器（6.6 + FIX 3：HTTP 状态码分层）
# ---------------------------------------------------------------------------
#
# 手册 6.6 的示例只针对 BusinessException（返回 HTTP 200）。把 HTTPException 与
# 未捕获异常也压成 200 是对 6.6 的过度应用：浏览器、Nginx、Electron 客户端、监控
# 和 curl 都会分不清「成功」和「服务挂了」，而且 get_current_user 抛的未登录
# 必须是真正的 401，否则前端拦截器与任何标准中间件都会失效。
#
# 最终策略：
#   BusinessException       -> 默认 HTTP 200；若 exc.status_code 有值（401/403/404/400/500）
#                              则用该状态码。业务语义始终在信封 code 里
#   RequestValidationError  -> HTTP 200 + {code: 1001, message, data.errors}
#   HTTPException           -> 原始 HTTP 状态码 + {code: 映射码, message, data:null}
#   未捕获 Exception         -> HTTP 500 + {code: 5000, message:"服务器内部错误", data:null}
#
# 业务语义始终由信封 code 表达，HTTP 状态码只表达传输层语义。

def _envelope(code: int, message: str, data: Any = None, status_code: int = 200) -> JSONResponse:
    """统一 ``{code,message,data}`` 信封；``status_code`` 由调用方按上表给。"""
    return JSONResponse(
        status_code=status_code,
        content=ApiResponse.fail(code, message, data).model_dump(),
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(BusinessException)
    async def business_exception_handler(request: Request, exc: BusinessException) -> JSONResponse:
        """业务异常：默认 HTTP 200（6.6）；带 ``status_code`` 的（401/403/404）用真实状态码。

        例：``BusinessException.not_found("简历不存在")`` -> 404 + ``{"code":2001,...}``；
            ``BusinessException(ErrorCode.PARAM_ERROR, "该消息正在生成回复")`` -> 200 + code 1001。
        """
        status_code = exc.status_code or 200
        logger.info(
            "业务异常 %s %s -> HTTP %s / code=%s message=%s",
            request.method, request.url.path, status_code, exc.code, exc.message,
        )
        return _envelope(exc.code, exc.message, exc.data, status_code=status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        """1001 参数错误 -> **HTTP 400**，并把 Pydantic 报错明细放进 data 方便前端定位。

        为什么是 400 而不是 200：1001 在 `CODE_TO_HTTP_STATUS` 里就推导成 400，
        而 `BusinessException(ErrorCode.PARAM_ERROR, ...)`（如"该用户名已被注册"）
        同样会得到 400。校验失败与业务参数错误是同一类语义，必须同一个状态码，
        否则前端会出现"提交表单有时走成功分支、有时走错误分支"的诡异差异。
        """
        errors = [
            {
                "loc": ".".join(str(part) for part in error.get("loc", [])),
                "msg": error.get("msg", ""),
                "type": error.get("type", ""),
            }
            for error in exc.errors()
        ]
        logger.info("参数校验失败 %s %s -> %s", request.method, request.url.path, errors)
        return _envelope(ErrorCode.PARAM_ERROR, "参数错误", {"errors": errors}, status_code=400)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        """HTTPException 保留原始 HTTP 状态码（401 就是 401），code 按错误码表映射。

        401->1002、403->1003、404->2001、405/409/422 等->1001。
        Nginx 的重试策略、浏览器对 401 的处理、监控告警都依赖这里不被改成 200。
        """
        status_code = exc.status_code
        code = http_status_to_code(status_code)
        detail = exc.detail if isinstance(exc.detail, str) and exc.detail else DEFAULT_MESSAGES.get(code, "请求失败")
        logger.info("HTTPException %s %s -> HTTP %s / code=%s", request.method, request.url.path, status_code, code)
        return _envelope(code, detail, None, status_code=status_code)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        """5000 服务器内部错误 + HTTP 500；日志写全栈，响应里不回传细节（14.6）。"""
        logger.exception("未处理异常 %s %s: %s", request.method, request.url.path, sanitize(exc))
        return _envelope(ErrorCode.INTERNAL_ERROR, "服务器内部错误", None, status_code=500)


# ---------------------------------------------------------------------------
# 生命周期
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """启动/关闭钩子（12.1：启动时初始化 APScheduler）。"""
    configure_logging()
    logger.info("启动 %s (env=%s, debug=%s)", app.title, settings.APP_ENV, settings.DEBUG)

    if not settings.DEEPSEEK_API_KEY or settings.DEEPSEEK_API_KEY.startswith("sk-xxx"):
        logger.warning("DEEPSEEK_API_KEY 未配置，AI 能力将走 7.6 兜底话术")

    # 数据库连通性检查：失败不阻止启动（骨架阶段数据库可能还没建好）
    try:
        from sqlalchemy import inspect, text

        from app.db.session import describe_database, engine

        # ⚠️ inspect(conn) 必须在 with 块**内**调用：退出 with 后连接已关闭，
        # 再用会抛 "This Connection is closed"（曾因此误报"数据库连接失败"）。
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            existing_tables = set(inspect(conn).get_table_names())
            # SQLite 自检：外键强制是否真的开着（见 app/db/session.py 的 connect 监听）。
            # 这条日志同时是一份**运行期证据** —— SQLite 默认不开外键，
            # 早期因此能插入指向不存在父行的孤儿数据，光读代码发现不了。
            foreign_keys_on = (
                conn.execute(text("PRAGMA foreign_keys")).scalar() if settings.is_sqlite else None
            )

        logger.info("数据库连接正常：%s", describe_database())
        if settings.is_sqlite:
            if foreign_keys_on == 1:
                logger.info("SQLite 外键强制已开启（PRAGMA foreign_keys=1）")
            else:
                logger.warning(
                    "SQLite 外键强制**未开启**（PRAGMA foreign_keys=%s）："
                    "会产生指向不存在父行的孤儿数据，请检查 app/db/session.py 的 connect 监听",
                    foreign_keys_on,
                )

        # SQLite 联调的贴心提示：表还没建时给出明确命令（只是日志，不做隐式建表 ——
        # 隐式 DDL 会让人不知道库结构是谁改的；建表请显式执行 init_db，见 README §2.1）
        if settings.is_sqlite and "users" not in existing_tables:
            logger.warning(
                "检测到数据库里还没有表。SQLite 联调请先执行："
                "`python -m app.db.init_db`（或正式流程 `alembic upgrade head`）"
            )
    except Exception as exc:  # noqa: BLE001
        logger.error("数据库连接失败（服务仍会启动，接口会返回错误）：%s", sanitize(exc))

    # 启动定时任务（12.1 / 12.2）
    scheduler = None
    try:
        from app.tasks.scheduler import start_scheduler

        scheduler = start_scheduler()
    except Exception as exc:  # noqa: BLE001 - 定时任务起不来不应导致服务不可用
        logger.error("APScheduler 启动失败：%s", sanitize(exc))

    app.state.settings = settings
    app.state.scheduler = scheduler

    yield

    try:
        from app.tasks.scheduler import shutdown_scheduler

        shutdown_scheduler()
    except Exception as exc:  # noqa: BLE001
        logger.warning("APScheduler 停止异常：%s", sanitize(exc))
    logger.info("服务已停止")


# ---------------------------------------------------------------------------
# 应用实例
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    # /docs、/redoc、/openapi.json 默认只在 DEBUG 开放；
    # 生产要临时排查时显式设 ENABLE_API_DOCS=true，避免默认把整套接口描述裸露。
    docs_enabled = settings.DEBUG or settings.ENABLE_API_DOCS
    application = FastAPI(
        title="高校学生AI就业辅助系统 API",
        description=(
            "FastAPI + PostgreSQL + DeepSeek 后端骨架。\n\n"
            "响应统一为 `{code, message, data}`（手册 6.5）；\n"
            "业务异常也返回 HTTP 200，错误语义由 `code` 表达（手册 6.6）。\n"
            "SSE 接口：`GET /api/v1/chat/conversations/{id}/stream`（手册 7.2）。"
        ),
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    register_exception_handlers(application)

    # 6.2 统一前缀 /api/v1
    application.include_router(api_router)

    # ⚠️ 安全决策（14.5 用户只能访问自己的数据 / 14.1 数据保密）：
    # **这里刻意不挂载 `StaticFiles` 到 /uploads。**
    #
    # 曾经有过这么一行：
    #     application.mount("/uploads", StaticFiles(directory=str(get_upload_root())), name="uploads")
    # 它意味着**任何未登录的人**只要猜到/遍历 `GET /uploads/resumes/{user_id}/{uuid}.pdf`
    # 就能下载别人的简历 —— 简历含姓名、手机号、学校、经历，是典型 PII；
    # 而 `resumes.file_path` 里就带 user_id，路径完全可枚举。
    #
    # 现在**没有任何**对外读简历文件的端点：老的「上传 PDF -> 解析 -> ATS 评分 ->
    # 报告 -> 鉴权下载」链路已于 2026-11 整体移除（见 README §4.10），
    # 现行的简历功能（template / mine / polish）不落文件。
    # 这条"不挂 StaticFiles"的决策仍然保留：uploads 下还有历史文件，
    # 以后新增任何文件类功能也必须走带鉴权的端点，不许静态直出。
    # 也**不要**改成"只在 DEBUG 挂载"：开发环境同样有真实简历，前端也不该依赖这个路径。
    logger.info(
        "uploads 目录不提供静态访问：需要读文件的一律走带鉴权的端点（14.5）"
    )

    @application.middleware("http")
    async def limit_request_body(request: Request, call_next):
        """按 Content-Length 拒绝过大的请求体（413）。

        只做"声明长度"的早拒绝：chunked/伪造 Content-Length 的请求仍可能很大，
        语音接口另有一层**分块累计**上限（见 voice.py::_read_audio_body）。
        两层叠加后，JSON 接口不会因为一个超大 body 先把内存吃掉。
        """
        if request.method in {"POST", "PUT", "PATCH"}:
            declared = request.headers.get("content-length")
            if declared:
                try:
                    length = int(declared)
                except ValueError:
                    length = 0
                if length > settings.MAX_REQUEST_BODY_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content=ApiResponse.fail(
                            ErrorCode.PARAM_ERROR, "请求体过大"
                        ).model_dump(),
                    )
        return await call_next(request)

    @application.middleware("http")
    async def rate_limit_requests(request: Request, call_next):
        """进程内限流：登录爆破 / AI 与语音成本接口。

        单 worker 部署下有效；多 worker 需要 Redis/网关层限流（见 rate_limit.py）。
        """
        if settings.RATE_LIMIT_ENABLED:
            decision = check_rate_limit(request)
            if decision is not None:
                rule, allowed = decision
                if not allowed:
                    logger.warning(
                        "请求被限流 %s %s（%s 次/%ss）",
                        request.method,
                        request.url.path,
                        rule.limit,
                        int(rule.window),
                    )
                    return JSONResponse(
                        status_code=429,
                        content=ApiResponse.fail(
                            ErrorCode.PARAM_ERROR, "请求过于频繁，请稍后再试"
                        ).model_dump(),
                        headers={"Retry-After": str(int(rule.window))},
                    )
        return await call_next(request)

    @application.middleware("http")
    async def add_process_time_header(request: Request, call_next):
        """简单耗时统计（6.7 日志）。"""
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Process-Time"] = f"{elapsed_ms:.1f}"
        if elapsed_ms > 3000:
            logger.warning("慢请求 %s %s 耗时 %.0fms", request.method, request.url.path, elapsed_ms)
        return response

    @application.get("/", tags=["System"], summary="服务信息")
    async def root() -> dict:
        return {
            "code": 0,
            "message": "success",
            "data": {
                "name": "高校学生AI就业辅助系统",
                "version": "0.1.0",
                "api_prefix": API_V1_PREFIX,
                "docs": "/docs" if docs_enabled else None,
                "health": f"{API_V1_PREFIX}/health",
            },
        }

    # 3.10：后端配置 CORS，允许 http://localhost:5173
    #
    # ⚠️ 必须**最后添加**：Starlette 的中间件是"后添加的在外层"，放最后才能让
    # CORS 头也盖住限流 429 / 请求体 413 / 异常 500 —— 否则浏览器只会看到
    # CORS 错误，前端拿不到真正的错误信封。
    #
    # ⚠️ 通配来源与凭证不能同时开：`cors_origin_list` 在 DEBUG 下会追加 "*"，
    # 而 Starlette 在 allow_credentials=True 时会把请求的 Origin 原样反射回去 ——
    # 等价于"任何网站都能带凭证跨域调本 API"。本项目的鉴权走
    # `Authorization: Bearer`，不依赖 Cookie，所以出现通配来源时直接关掉
    # credentials 即可，不影响前端登录。
    cors_origins = settings.cors_origin_list
    # 评委自填 Key：只放在本次请求的上下文里，SSE 流式响应期间也不会丢
    application.add_middleware(ApiKeyHeaderMiddleware)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials="*" not in cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Process-Time"],
    )

    return application


app = create_app()


if __name__ == "__main__":
    # 便于 `python -m app.main` 直接起服务（正式用 uvicorn 命令，见 3.6）
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=settings.DEBUG)
