"""users：用户表（手册 5.3）。"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel

# 保证时间戳严格单调递增所需的进程内状态（见 utcnow 的说明）
_ts_lock = threading.Lock()
_last_ts: Optional[datetime] = None


def utcnow() -> datetime:
    """统一的时间戳工厂：**严格单调递增**的 naive UTC 时间。

    为什么不是裸的 ``datetime.now()``（这是实测抓到的真 bug）：

    SQLAlchemy 在 **flush 时**才求值 Python 侧默认值，同一批 INSERT 又是在一个紧凑
    循环里完成的，于是"同一事务里插入的多行"会拿到**完全相同的微秒**——实测三条消息
    的 ``created_at`` 都等于 ``2026-09-18 13:08:54.745818``。而本项目有两处关键逻辑
    依赖 ``created_at`` 排序：

    1. ``idempotency.find_assistant_reply()`` 用 ``created_at > user_message.created_at``
       找某条用户消息的回复 —— 时间并列时**一个都匹配不上**，幂等回放会降级成 pending；
    2. ``chat_service._recent_messages()`` 按 ``created_at`` 取最近 N 条拼 Prompt ——
       并列时顺序交给数据库决定，**可能把用户/助手的话说反**。

    所以这里自己保证单调：新取的 now 若不大于上一个值，就在上一个值上加 1 微秒。
    加锁是因为 FastAPI 的同步路由跑在线程池里，多个线程会同时取时间。

    注意：
    - 只保证**单进程内**单调。多 worker 部署时不同进程仍可能产生相同时间戳，
      但那种并列只可能发生在不同会话之间，而排序都是"会话内"的，所以无影响；
    - 显式传 ``created_at`` 的调用方（导入历史数据、测试）会绕过这个保证，
      那时并列时间戳的顺序仍是未定义；相关查询已补 ``id`` 作次级排序键，
      至少保证**同一次查询的结果稳定**（不会同一次跑出两种顺序）。
    """
    global _last_ts
    with _ts_lock:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if _last_ts is not None and now <= _last_ts:
            now = _last_ts + timedelta(microseconds=1)
        _last_ts = now
        return now


class User(SQLModel, table=True):
    """用户。

    | 字段 | 类型 | 说明 |
    |---|---|---|
    | id | UUID | 主键 |
    | username | VARCHAR(50) | 用户名/手机号/学号 |
    | password_hash | VARCHAR(255) | 密码哈希 |
    | school | VARCHAR(100) | 学校 |
    | major | VARCHAR(100) | 专业大类 |
    | grade | VARCHAR(20) | 年级 |
    | created_at / updated_at | TIMESTAMP | 时间戳 |
    | deleted_at | TIMESTAMP | 软删除 |
    """

    __tablename__ = "users"

    id: UUID = Field(default_factory=uuid4, primary_key=True)

    # 用户名/手机号/学号：唯一，登录标识
    username: str = Field(max_length=50, index=True, unique=True, description="用户名/手机号/学号")
    password_hash: str = Field(max_length=255, description="bcrypt 哈希，禁止出参")

    school: Optional[str] = Field(default=None, max_length=100)
    major: Optional[str] = Field(default=None, max_length=100)
    grade: Optional[str] = Field(default=None, max_length=20)

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    deleted_at: Optional[datetime] = Field(default=None, index=True, description="软删除时间，空表示未删除")

    def __repr__(self) -> str:  # 日志脱敏：绝不打印 password_hash
        return f"<User id={self.id} username={self.username}>"
