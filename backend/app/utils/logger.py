"""日志配置（《开发手册》6.7 标准 logging、14.6 日志脱敏）。"""

from __future__ import annotations

import logging
import re
import sys
from typing import Any, Iterable

LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# 14.6：不记录密码、API Key
_SENSITIVE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"(sk-[A-Za-z0-9]{4})[A-Za-z0-9]+"), r"\1***"),
    (re.compile(r"(?i)(password\"?\s*[:=]\s*\"?)([^\",\s]+)"), r"\1***"),
    (re.compile(r"(?i)(authorization\"?\s*[:=]\s*\"?bearer\s+)([^\",\s]+)"), r"\1***"),
    (re.compile(r"(?i)(secret_key\"?\s*[:=]\s*\"?)([^\",\s]+)"), r"\1***"),
)

_CONFIGURED = False


def configure_logging(level: int | None = None) -> None:
    """在 main.py 启动时调用一次；重复调用是幂等的。"""
    global _CONFIGURED
    root = logging.getLogger()
    if _CONFIGURED:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(LOG_FORMAT, DATE_FORMAT))
    root.handlers = [handler]
    if level is not None:
        root.setLevel(level)
    else:
        root.setLevel(logging.INFO)
    # 降低三方库噪音
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.INFO)
    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """``logger = get_logger(__name__)``，等价于 ``logging.getLogger(__name__)``。"""
    return logging.getLogger(name)


def mask_secret(value: str | None, keep: int = 4) -> str:
    """脱敏输出：``sk-abcd****``。"""
    if not value:
        return ""
    if len(value) <= keep:
        return "*" * len(value)
    return f"{value[:keep]}{'*' * (len(value) - keep)}"


def sanitize(text: Any, extra_secrets: Iterable[str] = ()) -> str:
    """把日志文本里的密钥/密码替换成 ***（14.6）。"""
    result = str(text)
    for pattern, repl in _SENSITIVE_PATTERNS:
        result = pattern.sub(repl, result)
    for secret in extra_secrets:
        if secret:
            result = result.replace(secret, "***")
    return result
