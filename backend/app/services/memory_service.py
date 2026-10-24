"""账号级长期记忆：把用户自己说过的原话，沉淀成一份“他是谁”。

和 ``profile_tags`` 的分工：
- ``profile_tags``：给推荐/任务/面试用的标签（兴趣、能力、技能、痛点…）；
- 这里：给对话用的“动机地图”（想要的生活、怕什么、愿意付出什么、为什么而努力）。

三条纪律：
1. **只记用户原话**。每条都带 evidence，服务端会把它放回用户消息里核对；
   核对不到就整条丢掉。
2. **只做背景，不做台词**。注入对话时只用来避免重复、把下一句问得更准；
   不许让模型念“根据你的画像”。
3. **不阻塞回复**。提取在后台跑，失败只留日志，不影响用户这一轮。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Iterable, List, Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.schemas import MemoryExtractResult, MemoryItem
from app.db.session import SessionLocal
from app.models.conversation import Message
from app.models.memory import UserMemory
from app.models.user import User
from app.utils.logger import get_logger, sanitize
from app.utils.text import normalize_for_match

logger = get_logger(__name__)

# 后台提取同一用户只跑一份，避免连发消息时并发写同一行。
_running: set[str] = set()

# 每收集到多少条用户消息提取一次（4、6、8…）。
EXTRACT_EVERY_N_USER_MESSAGES = 2
MIN_USER_MESSAGES = 4

# 每个字段最多留几条（记忆要短，不能变成一份档案）。
MAX_ITEMS_PER_FIELD = 6

_MEMORY_FIELDS = (
    "desired_life",
    "undesired_life",
    "values",
    "acceptable_costs",
    "unacceptable_costs",
    "motivation_sources",
    "uncertainty_tolerance",
    "role_models",
    "anti_models",
    "open_questions",
    "facts",
)

# 注入 Prompt 时的中文标签（只给模型看，不直接给用户）。
_FIELD_LABELS = {
    "desired_life": "他想要的生活",
    "undesired_life": "他不想过的生活",
    "values": "他在意的",
    "acceptable_costs": "他愿意付出的",
    "unacceptable_costs": "他绝不接受的",
    "motivation_sources": "他为什么而努力",
    "uncertainty_tolerance": "他对不确定性的态度",
    "role_models": "他想成为的人",
    "anti_models": "他绝不想成为的人",
    "open_questions": "他还没想清楚的问题",
}


def empty_content() -> Dict[str, List[Dict[str, str]]]:
    return {field: [] for field in _MEMORY_FIELDS}


def get_or_create(db: Session, user_id: UUID) -> Optional[UserMemory]:
    """取账号记忆；表还没建时返回 None（不阻塞对话）。"""
    try:
        memory = db.exec(select(UserMemory).where(UserMemory.user_id == user_id)).first()
    except OperationalError:
        logger.warning(
            "user_memories 表不存在，长期记忆暂不可用；请执行 python -m app.db.init_db"
        )
        return None
    if memory is not None:
        return memory

    memory = UserMemory(user_id=user_id, content=empty_content())
    db.add(memory)
    try:
        db.commit()
        db.refresh(memory)
    except Exception as exc:  # noqa: BLE001 - 记忆失败不能影响对话
        db.rollback()
        logger.warning("创建 user_memories 失败（已忽略）user_id=%s err=%s", user_id, sanitize(exc))
        return None
    return memory


def _as_item(value: Any) -> Optional[Dict[str, str]]:
    if isinstance(value, MemoryItem):
        text, evidence = value.text, value.evidence
    elif isinstance(value, dict):
        text, evidence = value.get("text", ""), value.get("evidence", "")
    elif isinstance(value, str):
        text, evidence = value, ""
    else:
        return None
    text = str(text or "").strip()
    evidence = str(evidence or "").strip()
    if not text:
        return None
    return {"text": text, "evidence": evidence}


def _evidence_supported(evidence: str, user_text: str) -> bool:
    """evidence 必须是用户原话里能原样搜到的连续片段。"""
    if not evidence:
        return False
    return normalize_for_match(evidence) in normalize_for_match(user_text)


def _clean_items(values: Iterable[Any], user_text: str) -> List[Dict[str, str]]:
    cleaned: List[Dict[str, str]] = []
    for value in values:
        item = _as_item(value)
        if item is None:
            continue
        if not _evidence_supported(item["evidence"], user_text):
            logger.info("长期记忆丢弃无出处条目：%r（evidence=%r）", item["text"], item["evidence"])
            continue
        cleaned.append(item)
    return cleaned


def _merge_items(
    existing: Iterable[Any], new: Iterable[Any], *, limit: int = MAX_ITEMS_PER_FIELD
) -> List[Dict[str, str]]:
    """合并同一字段的记忆，顺手做“近似重复”收敛。

    除了完全相同的文本，还会把“一条包含另一条”的近似条目合并成更具体的那条
    （例如「讨厌一眼望到头」和「讨厌一眼望到头的生活，觉得活着没意思」）。
    只对 >=4 字的文本做包含判断，避免「稳定」这种短词误吞别的条目。
    """
    items: List[Dict[str, str]] = []
    for value in list(existing) + list(new):
        item = _as_item(value)
        if item is None:
            continue
        key = normalize_for_match(item["text"])
        if not key:
            continue

        replaced = False
        for index, current in enumerate(items):
            current_key = normalize_for_match(current["text"])
            if not current_key:
                continue
            if key == current_key:
                items[index] = item
                replaced = True
                break
            if (
                len(key) >= 4
                and len(current_key) >= 4
                and (key in current_key or current_key in key)
            ):
                if len(key) >= len(current_key):
                    items[index] = item
                replaced = True
                break

        if not replaced:
            items.append(item)

    return items[-limit:]


def _merge(
    existing: Optional[Dict[str, Any]],
    result: MemoryExtractResult,
    user_text: str,
) -> Dict[str, Any]:
    content = dict(existing or empty_content())
    for field in _MEMORY_FIELDS:
        incoming = _clean_items(getattr(result, field, []) or [], user_text)
        content[field] = _merge_items(content.get(field) or [], incoming)
    return content


def format_block(db: Session, user: User) -> str:
    """把动机地图压成几行，给开场白/正文当背景。没有内容时返回空串。"""
    memory = get_or_create(db, user.id)
    if memory is None or not memory.content:
        return ""

    lines: List[str] = []
    for field, label in _FIELD_LABELS.items():
        items = memory.content.get(field) or []
        texts: List[str] = []
        for item in items:
            text = _as_item(item)
            if text and text["text"] not in texts:
                texts.append(text["text"])
            if len(texts) >= 3:
                break
        if texts:
            lines.append(f"- {label}：" + "；".join(texts))
    return "\n".join(lines)


async def update_from_conversation(db: Session, user: User, conversation_id: UUID) -> None:
    """从当前会话的用户原话里提炼一次记忆。失败只留日志。"""
    rows = db.exec(
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.role == "user",
        )
        .order_by(Message.created_at.desc())  # type: ignore[union-attr]
        .limit(20)
    ).all()
    if len(rows) < 2:
        return

    user_text = "\n".join(message.content or "" for message in reversed(rows)).strip()
    if not user_text:
        return

    memory = get_or_create(db, user.id)
    if memory is None:
        return
    existing = memory.content or empty_content()

    try:
        result = await deepseek_client.chat_prompt_json(
            prompt_name="memory_extract",
            variables={
                "existing_memory": json.dumps(existing, ensure_ascii=False),
                "user_messages": user_text,
            },
            schema=MemoryExtractResult,
            default=MemoryExtractResult(),
            temperature=0.2,
            max_tokens=2000,
        )
    except Exception as exc:  # noqa: BLE001 - 记忆失败不影响对话
        logger.warning("长期记忆提炼失败（已忽略）user_id=%s err=%s", user.id, sanitize(exc))
        return

    merged = _merge(existing, result, user_text)
    memory.content = merged
    db.add(memory)
    try:
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.warning("长期记忆写库失败（已忽略）user_id=%s err=%s", user.id, sanitize(exc))
        return

    counts = {field: len(merged.get(field) or []) for field in _MEMORY_FIELDS if merged.get(field)}
    logger.info("长期记忆已更新 user_id=%s 字段=%s", user.id, counts)


def schedule_extraction(user_id: UUID, conversation_id: UUID) -> None:
    """在后台跑一次提炼；同一用户同一时间只跑一份。

    节流：每 2 条用户消息提炼一次（第 4、6、8… 条）。太频繁会白花钱，
    太稀疏又会让“新对话不问旧问题”失效。
    """
    key = str(user_id)
    if key in _running:
        return
    _running.add(key)

    async def _run() -> None:
        try:
            with SessionLocal() as db:
                count = int(
                    db.exec(
                        select(func.count())
                        .select_from(Message)
                        .where(
                            Message.conversation_id == conversation_id,
                            Message.role == "user",
                        )
                    ).one()
                )
                if count < MIN_USER_MESSAGES or count % EXTRACT_EVERY_N_USER_MESSAGES != 0:
                    return
                user = db.get(User, user_id)
                if user is None:
                    return
                await update_from_conversation(db, user, conversation_id)
        except Exception as exc:  # noqa: BLE001 - 后台任务绝不冒泡
            logger.warning(
                "长期记忆后台任务失败（已忽略）user_id=%s conversation_id=%s err=%s",
                user_id,
                conversation_id,
                sanitize(exc),
            )
        finally:
            _running.discard(key)

    try:
        asyncio.create_task(_run())
    except RuntimeError:
        # 没有事件循环（脚本/同步调用）：本次跳过，不影响主流程。
        _running.discard(key)
        logger.debug("没有事件循环，跳过长期记忆提炼")
