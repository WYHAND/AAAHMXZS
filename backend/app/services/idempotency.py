"""对话幂等去重（设计文档 4.3：同一 ``client_msg_id`` 重复提交不得产生
「两条用户消息 + 两次 AI 回复」）。

实现方式：**正式的数据库列 + 唯一约束**。

- ``Message.client_msg_id``（``VARCHAR(64)``，普通索引）
- ``UniqueConstraint("conversation_id", "client_msg_id")``（复合唯一索引）

为什么不用「把标记内联进 content」：那样会跟着 ``MessageResponse.content``
一起发给前端，污染纯文本气泡渲染、历史消息、搜索与长度统计。
现在 ``content`` 永远存纯原话，幂等 id 独立成列。

（本模块曾实现过 ``wrap_content`` / ``strip_client_marker`` / ``extract_client_msg_id``
三个内联标记函数，已按授权删除；现在所有读 ``content`` 的地方都不需要任何 strip。）

偏离说明：``client_msg_id`` 不在手册 5.3 的 ``messages`` 字段表里，
属授权补列，见 backend/README.md 第 6 节 [已决策] 条目与「迁移注意事项」。
"""

from __future__ import annotations

from typing import Optional, Tuple
from uuid import UUID

from sqlmodel import Session, select

from app.models.conversation import Message


def find_client_message(
    db: Session, conversation_id: UUID, client_msg_id: str
) -> Optional[Message]:
    """按 ``client_msg_id`` 取已有的用户消息（同一会话内）。

    一次带索引的等值查询，不再全表遍历 + Python 侧过滤。
    """
    if not client_msg_id:
        return None
    statement = select(Message).where(
        Message.conversation_id == conversation_id,
        Message.client_msg_id == client_msg_id,
    )
    return db.exec(statement).first()


def client_message_exists(db: Session, conversation_id: UUID, client_msg_id: str) -> bool:
    """该会话里是否已经有带这个 client_msg_id 的用户消息。"""
    return find_client_message(db, conversation_id, client_msg_id) is not None


def find_assistant_reply(
    db: Session, conversation_id: UUID, user_message: Message
) -> Optional[Message]:
    """找该用户消息之后的**第一条** assistant 回复。

    AI 是围绕某条用户消息直接作答，且一次请求只会追加一条 assistant 消息，
    所以「该用户消息之后的第一条 assistant」就是首次请求的结果。

    ⚠️ 本函数依赖 ``created_at`` 排序，而"同一批 flush 插入的行时间戳完全相同"是真实
    存在的坑（实测三条消息同为 ``...745818``，导致这里一个都匹配不上）。为此
    ``app.models.user.utcnow`` 已改成**严格单调递增**；这里再补一个 ``id`` 次级排序键，
    并保留一个并列兜底分支，让外部写入（导入历史消息）的数据也能正确回放。
    """
    statement = (
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.role == "assistant",
            Message.created_at > user_message.created_at,
        )
        .order_by(Message.created_at.asc(), Message.id.asc())  # type: ignore[union-attr]
    )
    found = db.exec(statement).first()
    if found is not None:
        return found

    # 兜底：时间戳并列（外部写入/秒级精度的库）时取同一时刻最早的 assistant
    tie_statement = (
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.role == "assistant",
            Message.created_at == user_message.created_at,
        )
        .order_by(Message.id.asc())  # type: ignore[union-attr]
    )
    return db.exec(tie_statement).first()


def resolve_duplicate(
    db: Session, conversation_id: UUID, client_msg_id: Optional[str]
) -> Tuple[Optional[Message], Optional[Message]]:
    """判断是否重复提交。

    返回 ``(已有用户消息, 已有助手回复)``：

    - ``(None, None)``：新请求，正常处理
    - ``(msg, None)``：重复提交但上一轮还没生成完 -> 上层发 ``pending`` 事件
      （`/messages` 返回 code 1001），不重复调 AI
    - ``(msg, reply)``：重复提交且上一轮已完成 -> 上层直接回放 ``reply``
    """
    if not client_msg_id:
        return None, None
    existing = find_client_message(db, conversation_id, client_msg_id)
    if existing is None:
        return None, None
    return existing, find_assistant_reply(db, conversation_id, existing)
