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

    # ---------- 数据库（3.5；默认 SQLite，生产建议 PostgreSQL） ----------
    # 默认值改成 SQLite：本机既没有 PostgreSQL 也没有 Docker，SQLite 开箱即跑
    # （用户拍板，见 README §4.13 与第 6 节）。想切回 PostgreSQL 就把 .env 里的
    # DATABASE_URL 换成下面注释的那一行（不用改代码）。
    DATABASE_URL: str = "sqlite:///./data/app.db"
    # DATABASE_URL: str = "postgresql://ai_user:your_password@localhost:5432/ai_career"

    # SQLite 专用：是否对同一连接开启跨线程复用。
    # FastAPI 的同步 route 跑在线程池里（且 SSE 端点会在生成器里再用一次），
    # 不设 False 会报 "SQLite objects created in a thread can only be used in that same thread"。
    SQLITE_CHECK_SAME_THREAD_FALSE: bool = True

    # 是否把每条 SQL 打到日志（SQLAlchemy echo）。
    # 默认关闭：DEBUG=true 时会刷屏（一次建表就能打上千行），排查时再开。
    DB_ECHO: bool = False

    # ---------- JWT（3.5 / 6.8 / 14.2） ----------
    SECRET_KEY: str = "your-secret-key-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 小时
    ALGORITHM: str = "HS256"

    # ---------- DeepSeek（3.5 / 7.1） ----------
    DEEPSEEK_API_KEY: str = "sk-xxxxxxxx"
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    #
    # ⚠️ 模型面以**官方文档 + 实测**为准（勘误 9.32 / 9.36）：
    # 官方 `/models` 只给两个名字，别按版本号猜（``deepseek-v4.1-flash`` 这种会 400）——
    #   · ``deepseek-flash``   = **DeepSeek-V4.1-Flash-1017**（便宜、快、支持视觉）
    #   · ``deepseek-v4-pro``  = DeepSeek-V4-Pro-0813（贵、强）
    # 思考模式：``thinking: {type: enabled|disabled}``，**默认 enabled**；
    #   ``reasoning_effort: none|low|high|max``，**默认 high**（medium/xhigh 会被映射成 high）。
    #   thinking 模式下 temperature / top_p 不生效（传了也不报错）。
    # ``max_tokens``：1 ~ 384K，**不填时默认 8K（非思考）/ 64K（思考）**，
    #   而且**思考 token 也算在这份额度里**（实测 max_tokens=64 时正文直接是空的）。

    # ★ 全项目统一一个模型（勘误 9.32，用户拍板"不要分配模型"）。
    # 2026-10-19 按用户要求换成 V4.1 Flash（API 名就是 ``deepseek-flash``）。
    DEEPSEEK_MODEL: str = "deepseek-flash"
    # 思考强度**固定 low**（用户拍板，勘误 9.36）：实测 low 已经会认真想
    # （363-490 reasoning tokens），high 是同题的 2 倍多（930）。不设成配置项 ——
    # 少一个旋钮，少一处会和"够用"打架的地方（硬编码在 ``deepseek_client.CHAT_REASONING_EFFORT``）。
    DEEPSEEK_TIMEOUT: float = 60.0
    # 开着思考的调用更慢（实测 5-10s 常见），但 120s 已经足够；再长的基本是异常。
    DEEPSEEK_THINKING_TIMEOUT: float = 120.0
    # 对话正文的 max_tokens（勘误 9.36，实测定的"够用"值）：
    # 思考 low ≈ 400-500 + 正文 ≤800 字 ≈ 700 → 实测总用量 447-602，
    # 2000 留了约 3 倍余量，同时把"官方默认 64K"那种跑飞彻底堵住。
    DEEPSEEK_CHAT_MAX_TOKENS: int = 2000
    DEEPSEEK_MAX_RETRIES: int = 1

    # ---------- 云端语音（面试语音对话，2026-10-22 切到阿里云百炼） ----------
    # 面试语音只做「语音 <-> 文字」：录音不落库、不保存，转写文字仍走原有
    # POST /interview/{id}/answer 链路。当前实现接阿里云百炼 DashScope：
    #   ASR  paraformer-realtime-v2（WebSocket，实时 SDK 同步调用）
    #   TTS  cosyvoice-v3-flash     （WebSocket，MP3 24k）
    # ⚠️ 没有 DASHSCOPE_API_KEY 时语音接口返回 3001（AI 依赖不可用），
    #    前端据此隐藏/降级语音入口；不会影响文字面试。
    VOICE_PROVIDER: str = "aliyun"
    # 百炼控制台创建；优先于下面的 VOICE_API_KEY
    DASHSCOPE_API_KEY: str = ""
    # 兼容旧配置：只有没填 DASHSCOPE_API_KEY 时才会用到
    VOICE_API_KEY: str = ""
    # 百炼地域：cn-beijing 是默认地域；工作空间 Key 可能需要配套的 workspace id
    VOICE_REGION: str = "cn-beijing"
    # 可选：只有 "sk-ws-" 开头的工作空间 Key 才需要；
    # 留空时只用默认地址 wss://dashscope.aliyuncs.com/api-ws/v1/inference
    VOICE_WORKSPACE_ID: str = ""
    # 旧硅基流动的 HTTP 地址，仅保留字段避免旧 .env 报 "extra"（已不再使用）
    VOICE_BASE_URL: str = ""
    VOICE_ASR_MODEL: str = "paraformer-realtime-v2"
    VOICE_TTS_MODEL: str = "cosyvoice-v3-flash"
    # 磁性理智男 longtian_v3（30–35 岁）：比有声书音色更像 HR
    VOICE_TTS_VOICE: str = "longtian_v3"
    # 旧硅基流动的音速参数（DashScope 的语速由音色/模型决定，这里仅保留兼容）
    VOICE_TTS_SPEED: float = 1.0
    VOICE_TIMEOUT: float = 30.0
    # 一次回答最长 3 分钟；16k/16bit 单声道 3 分钟约 5.8MB，10MB 留足余量
    VOICE_MAX_AUDIO_BYTES: int = 10485760

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

    @property
    def voice_api_key(self) -> str:
        """语音服务实际使用的 Key：优先 DASHSCOPE_API_KEY，兼容旧 VOICE_API_KEY。"""
        return (self.DASHSCOPE_API_KEY or self.VOICE_API_KEY).strip()

    @property
    def voice_configured(self) -> bool:
        """云端语音是否已配置。

        只认「非空 key + 支持的 provider」：空 key 时前端不该显示一个点了就报错的
        语音入口。provider 的错误值也按未配置处理（避免悄悄打到错误的服务上）。
        """
        provider = self.VOICE_PROVIDER.strip().lower()
        supported = {"aliyun", "dashscope", "bailian"}
        return bool(self.voice_api_key) and provider in supported

    # ---------- 数据库方言判定（SQLite / PostgreSQL 双跑，见 README §4.13） ----------

    @property
    def is_sqlite(self) -> bool:
        """当前是否走 SQLite（``sqlite://`` 或 ``sqlite+pysqlite://``）。"""
        return self.DATABASE_URL.strip().lower().startswith("sqlite")

    @property
    def is_postgres(self) -> bool:
        """当前是否走 PostgreSQL（``postgresql://`` / ``postgres://`` / ``postgresql+psycopg2://``）。"""
        return self.DATABASE_URL.strip().lower().startswith(("postgresql", "postgres"))

    @property
    def is_in_memory_sqlite(self) -> bool:
        """内存库（``sqlite://``、``sqlite:///:memory:``）—— 只用于临时试跑/测试。"""
        return self.is_sqlite and (
            ":memory:" in self.DATABASE_URL or self.DATABASE_URL.rstrip("/").endswith("sqlite:")
        )


@lru_cache
def get_settings() -> Settings:
    """进程内单例；测试时可 ``get_settings.cache_clear()``。"""
    return Settings()


# 便于 ``from app.core.config import settings`` 直接使用（手册 7.1 示例即此写法）
settings = get_settings()
