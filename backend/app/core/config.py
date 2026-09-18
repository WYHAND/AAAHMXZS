"""应用配置。

对应《开发手册》3.5 环境变量清单，使用 pydantic-settings 从 .env 读取。

注意：pydantic-settings 是 pydantic v2 的独立包，手册 2.6 的最小依赖清单里
没有列出，但 3.5 要求用 .env 驱动配置，因此 requirements.txt 中已补充
``pydantic-settings``（见 backend/README.md 的“待确认”小节）。
"""

from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """全部可配置项，字段名与 .env 变量名一致（大小写不敏感）。"""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---------- 数据库（3.5） ----------
    DATABASE_URL: str = "postgresql://ai_user:your_password@localhost:5432/ai_career"

    # ---------- JWT（3.5 / 6.8 / 14.2） ----------
    SECRET_KEY: str = "your-secret-key-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 小时
    ALGORITHM: str = "HS256"

    # ---------- DeepSeek（3.5 / 7.1） ----------
    DEEPSEEK_API_KEY: str = "sk-xxxxxxxx"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    # 以下三个不在 3.5 清单中，但 7.1/7.6 的封装需要，给出默认值
    DEEPSEEK_MODEL: str = "deepseek-chat"
    DEEPSEEK_TIMEOUT: float = 60.0
    DEEPSEEK_MAX_RETRIES: int = 1

    # ---------- 文件存储（3.5 / 13.1 / 13.2） ----------
    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE: int = 10485760  # 10MB

    # ---------- 应用（3.5） ----------
    APP_ENV: str = "development"
    DEBUG: bool = True

    # ---------- 派生配置（不在 3.5 清单中，CORS 需要，见 README 待确认） ----------
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> List[str]:
        """把 CORS_ORIGINS 逗号串拆成列表；开发环境额外放开全部来源。"""
        origins = [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]
        if self.DEBUG:
            origins.append("*")
        return origins

    @property
    def is_development(self) -> bool:
        return self.APP_ENV.lower() in {"development", "dev", "local"}


@lru_cache
def get_settings() -> Settings:
    """进程内单例；测试时可 ``get_settings.cache_clear()``。"""
    return Settings()


# 便于 ``from app.core.config import settings`` 直接使用（手册 7.1 示例即此写法）
settings = get_settings()
