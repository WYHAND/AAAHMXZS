"""进程内限流（滑动窗口）。

为什么放在这里：项目没有 Redis / 网关限流（手册 2.5 明确不引入 Redis），
而登录爆破、以及"登录用户狂点 AI 接口"是两个真实成本/安全风险。
当前部署是**单 worker**（见 app/tasks/scheduler.py 顶部约束），进程内计数
足够覆盖；多 worker/多副本时必须换成 Redis 或 Nginx 层限流。

设计取舍：
- **按用户**限流：取 ``Authorization`` 头的短哈希做 key，不在内存/日志里存原文；
  未登录请求退回按 IP。不要把 token 原文当 key 打日志。
- **只限"会产生成本或可被爆破"的路径**：登录/注册、AI 生成、语音、流式对话。
  普通 GET 列表不限制，避免正常翻页被误伤。
- 默认阈值刻意宽松（登录 20 次/分、对话流 20 次/分），目标是挡住脚本/连点，
  不是限制正常用户。
- 窗口内保留时间戳列表；每次访问顺带裁掉过期项，并定期清理空 key。
"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from fastapi import Request

from app.core.config import settings


@dataclass(frozen=True)
class Rule:
    """一条限流规则：``path`` 精确匹配，或 ``path`` 前缀 + ``suffix``。"""

    method: str
    path: str
    limit: int
    window: float = 60.0
    scope: str = "user"  # user：优先按 token；ip：按客户端 IP
    suffix: Optional[str] = None


# 顺序有意义：先匹配更具体的规则；最后才落到"所有写操作"的默认阈值。
RULES: Tuple[Rule, ...] = (
    # 匿名入口：按 IP 防爆破
    Rule("POST", "/api/v1/auth/login", 20, 60.0, "ip"),
    Rule("POST", "/api/v1/auth/register", 10, 60.0, "ip"),
    # AI / 外部付费调用
    Rule("POST", "/api/v1/chat/", 20, 60.0, "user", suffix="/stream"),
    Rule("POST", "/api/v1/chat/", 20, 60.0, "user", suffix="/opening"),
    Rule("POST", "/api/v1/voice/transcribe", 20, 60.0, "user"),
    Rule("POST", "/api/v1/voice/tts", 30, 60.0, "user"),
    Rule("POST", "/api/v1/interview/start", 10, 60.0, "user"),
    Rule("POST", "/api/v1/interview/", 30, 60.0, "user", suffix="/answer"),
    Rule("POST", "/api/v1/interview/", 10, 60.0, "user", suffix="/finish"),
    Rule("POST", "/api/v1/task/generate", 10, 60.0, "user"),
    Rule("POST", "/api/v1/resume/polish", 10, 60.0, "user"),
    Rule("POST", "/api/v1/test/submit", 10, 60.0, "user"),
    Rule("POST", "/api/v1/daily/answer", 20, 60.0, "user"),
)

# 兜底：所有写操作按用户 120 次/分。正常前端远达不到，脚本会先撞这里。
DEFAULT_MUTATION = Rule("", "/api/v1/", 120, 60.0, "user")

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_MAX_KEYS = 20_000


def match_rule(method: str, path: str) -> Optional[Rule]:
    """按方法 + 路径找限流规则；没有专门规则时，写操作走默认阈值。"""
    method = method.upper()
    for rule in RULES:
        if method != rule.method:
            continue
        if rule.suffix is not None:
            if path.startswith(rule.path) and path.endswith(rule.suffix):
                return rule
        elif path == rule.path:
            return rule
    if method in _WRITE_METHODS and path.startswith(DEFAULT_MUTATION.path):
        return DEFAULT_MUTATION
    return None


def _identity(request: Request, scope: str) -> str:
    """限流 key 的身份部分：用户 token 短哈希，或客户端 IP。"""
    if scope == "user":
        authorization = request.headers.get("authorization") or ""
        if authorization:
            digest = hashlib.sha256(authorization.encode("utf-8")).hexdigest()[:16]
            return f"u:{digest}"

    ip = ""
    if settings.RATE_LIMIT_TRUST_PROXY_HEADERS:
        forwarded = request.headers.get("x-forwarded-for") or ""
        ip = forwarded.split(",", 1)[0].strip()
        if not ip:
            ip = (request.headers.get("x-real-ip") or "").strip()
    if not ip and request.client is not None:
        ip = request.client.host
    return f"ip:{ip or 'unknown'}"


class SlidingWindowLimiter:
    """线程安全的最小滑动窗口计数器。"""

    def __init__(self) -> None:
        self._hits: Dict[str, List[float]] = {}
        self._lock = threading.Lock()
        self._calls = 0

    def allow(self, key: str, limit: int, window: float) -> bool:
        now = time.monotonic()
        cutoff = now - window
        with self._lock:
            bucket = self._hits.setdefault(key, [])
            # 时间戳按插入顺序递增，裁掉窗口外的即可
            if bucket and bucket[0] <= cutoff:
                index = 0
                for index, stamp in enumerate(bucket):
                    if stamp > cutoff:
                        break
                else:
                    index = len(bucket)
                del bucket[:index]
            if len(bucket) >= limit:
                return False
            bucket.append(now)

            self._calls += 1
            if self._calls % 512 == 0:
                self._cleanup(cutoff)
            return True

    def _cleanup(self, cutoff: float) -> None:
        """定期删掉窗口外且已空的 key，避免长时间运行内存只增不减。"""
        empty = [key for key, bucket in self._hits.items() if not bucket or bucket[-1] <= cutoff]
        for key in empty:
            self._hits.pop(key, None)
        # 极端情况下（大量伪造身份）仍可能膨胀：超过上限直接重置，宁可短时放宽
        if len(self._hits) > _MAX_KEYS:
            self._hits.clear()


limiter = SlidingWindowLimiter()


def check(request: Request) -> Optional[Tuple[Rule, bool]]:
    """返回 ``(命中规则, 是否放行)``；没有规则时返回 ``None``。

    调用方（main.py 中间件）只在 ``False`` 时拒绝请求。
    """
    rule = match_rule(request.method, request.url.path)
    if rule is None:
        return None
    identity = _identity(request, rule.scope)
    key = f"{rule.method}:{rule.path}:{rule.suffix or ''}:{identity}"
    return rule, limiter.allow(key, rule.limit, rule.window)
