"""临时冒烟：对话 v3 接线（chat_service + 供料层 + 空转兜底），全程不联网。

做法：内存 SQLite 建表 -> 造一个用户 + 会话 -> 把 deepseek_client.chat_text / stream_chat
换成桩，然后真跑 send_message 与 stream_reply，断言：
  1. system 里注入了【这一轮你手边有什么】+ 三条硬边界，且**不含**指令式字段；
  2. 模型吐"复述+问句"时，非流式路径会重试一次、再不行用素材兜底（不再返回空转）；
  3. 模型吐正常内容时原样返回（不被篡改）；
  4. 流式路径：整段很短且空转 -> 用户看到的是兜底素材（不是那句空话）；
     长回复 -> 逐块正常流出。
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from sqlmodel import Session  # noqa: E402

from app.ai import deepseek_client  # noqa: E402
from app.db import session as db_session  # noqa: E402
from app.models.conversation import Conversation  # noqa: E402
from app.models.user import User  # noqa: E402
from app.schemas.chat import ChatRequest  # noqa: E402
from app.services import chat_director, chat_service  # noqa: E402

FAILED: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("PASS | " if ok else "FAIL | ") + name + (f" | {detail}" if detail else ""))
    if not ok:
        FAILED.append(name)


EMPTY_TURN = "那你自己有没有想过往哪边走？"
GOOD_TURN = (
    "先说开发这条路吧：日常大部分时间不是在写新功能，是在读别人的代码、改已有的东西、"
    "查一个不知道为什么不对的问题。门槛不是你会几门语言，是你能不能独立把一个小东西做到别人能用。"
)


def setup_db():
    db_session.init_engine("sqlite:///:memory:")
    db_session.create_all()
    db = Session(db_session.engine)
    user = User(username="smoke_user", password_hash="x", major="计算机科学与技术")
    db.add(user)
    db.commit()
    db.refresh(user)
    conversation = Conversation(user_id=user.id)
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return db, user, conversation


async def main() -> int:
    db, user, conversation = setup_db()

    # ---- 0. 桩：把模型换掉（不联网） ----
    calls: list[list] = []

    async def fake_chat_text(messages, **kwargs):
        calls.append(messages)
        return EMPTY_TURN if len(calls) == 1 else GOOD_TURN

    deepseek_client.chat_text = fake_chat_text  # type: ignore[assignment]

    # ---- 1. system 注入检查 ----
    messages, brief = chat_service._build_llm_messages(db, conversation, user)
    system = messages[0]["content"]
    check("1.1 system 里注入了供料块", "【这一轮你手边有什么" in system, f"含'目的地'={'目的地' in system}")
    check("1.2 三条硬边界在", "只有这三条是硬的" in system and "一个字都不许说" in system)
    check(
        "1.3 不再有指令式字段（约束不要太多）",
        not any(w in system for w in ("这轮你要做的事", "从哪个角度说", "必须给内容")),
    )
    check("1.4 认出了方向（计算机）", brief.direction is not None, f"direction={brief.direction}；step={brief.step}")

    # 空转兜底只对"他卡住 / 他在要东西"生效（勘误 9.41）——统一用一个卡住的 brief
    stuck_brief = chat_director.brief_turn(
        "我不知道",
        [("assistant", "嗨，今天过得咋样？"), ("user", "我不知道")],
        profile_text="计算机",
    )

    # ---- 2. 非流式：空转 -> 重试 -> 正常内容 ----
    calls.clear()
    text = await chat_service._generate_guarded(messages, stuck_brief)
    check("2.1 空转后重试一次并采用重试结果", text == GOOD_TURN, f"调用次数={len(calls)}；返回开头={text[:24]!r}")
    check("2.2 重试请求里带了反馈", len(calls) == 2 and "系统提示" in calls[1][-1]["content"])

    # ---- 3. 非流式：一直空转 -> 素材兜底 ----
    async def always_empty(messages, **kwargs):
        calls.append(messages)
        return EMPTY_TURN

    deepseek_client.chat_text = always_empty  # type: ignore[assignment]
    calls.clear()
    text = await chat_service._generate_guarded(messages, stuck_brief)
    check(
        "3.1 两次都空转 -> 用素材兜底（服务端直给一条）",
        text != EMPTY_TURN and len(text) > 40,
        f"调用次数={len(calls)}；返回开头={text[:30]!r}",
    )

    # ---- 3b. 闲聊轮：说一句"哈哈打得不错"不该被当成空转重写（勘误 9.41） ----
    chat_brief = chat_director.brief_turn(
        "我会打乒乓球",
        [("assistant", "你平时都干嘛？"), ("user", "我会打乒乓球")],
        profile_text="计算机",
    )
    calls.clear()
    text = await chat_service._generate_guarded(messages, chat_brief)
    check(
        "3b.1 闲聊轮的空转回复原样保留（不重试、不硬塞内容）",
        text == EMPTY_TURN and len(calls) == 1,
        f"调用次数={len(calls)}；state={chat_brief.user_state}；返回={text[:20]!r}",
    )

    # ---- 4. AI 挂了（兜底话术）不该被当成空转反复重试 ----
    from app.ai.fallbacks import fallback_reply

    async def broken(messages, **kwargs):
        calls.append(messages)
        return fallback_reply()

    deepseek_client.chat_text = broken  # type: ignore[assignment]
    calls.clear()
    text = await chat_service._generate_guarded(messages, stuck_brief)
    check("4.1 AI 失败时不被误判为空转", text == fallback_reply() and len(calls) == 1, f"调用次数={len(calls)}")

    # ---- 5. 流式：短且空转 -> 用户看到兜底素材 ----
    async def stream_empty(messages, **kwargs):
        yield EMPTY_TURN

    deepseek_client.stream_chat = stream_empty  # type: ignore[assignment]
    events = [e async for e in chat_service.stream_reply(
        Session(db_session.engine), user.id, conversation.id, messages, stuck_brief
    )]
    deltas = "".join(e.get("content", "") for e in events if e.get("type") == "delta")
    check(
        "5.1 流式空转 -> 发出的是兜底素材，不是那句空话",
        deltas and deltas != EMPTY_TURN,
        f"用户看到={deltas[:30]!r}",
    )

    # ---- 6. 流式：长回复照常逐块流出，不被拦 ----
    async def stream_good(messages, **kwargs):
        for index in range(0, len(GOOD_TURN), 12):
            yield GOOD_TURN[index:index + 12]

    deepseek_client.stream_chat = stream_good  # type: ignore[assignment]
    events = [e async for e in chat_service.stream_reply(
        Session(db_session.engine), user.id, conversation.id, messages, brief
    )]
    deltas = [e.get("content", "") for e in events if e.get("type") == "delta"]
    check(
        "6.1 长回复逐块流出且内容完整",
        len(deltas) > 1 and "".join(deltas) == GOOD_TURN,
        f"块数={len(deltas)}；拼接后长度={len(''.join(deltas))}",
    )

    # ---- 7. 问句留白：最后一段是提问 -> 先发正文，停顿后再发问（勘误 9.35）----
    import time

    question_reply = (
        "先说开发这条路：日常大部分时间不是在写新功能，是在读别人的代码、改已有的东西、"
        "查一个不知道为什么不对的问题。门槛不是会几门语言，是能不能独立把一个小东西做到别人能用。"
    )

    async def stream_question(messages, **kwargs):
        yield question_reply
        yield "\n\n"
        yield "你 Java 现在大概是什么程度？"

    async def good_chat_text(messages, **kwargs):
        return question_reply + "\n\n你 Java 现在大概是什么程度？"

    deepseek_client.stream_chat = stream_question  # type: ignore[assignment]
    deepseek_client.chat_text = good_chat_text  # type: ignore[assignment]

    started = time.monotonic()
    events = [
        (time.monotonic() - started, event)
        async for event in chat_service.stream_reply(
            Session(db_session.engine), user.id, conversation.id, messages, brief
        )
    ]
    deltas = [(t, event.get("content", "")) for t, event in events if event.get("type") == "delta"]
    question_at = next((t for t, content in deltas if "？" in content), None)
    check(
        "7.1 最后一段是提问 -> 停顿 >=0.8×QUESTION_HOLD_SECONDS 才发问",
        question_at is not None and question_at >= chat_service.QUESTION_HOLD_SECONDS * 0.8,
        f"问句首次出现={question_at if question_at is None else round(question_at, 2)}s；"
        f"停顿设定={chat_service.QUESTION_HOLD_SECONDS}s",
    )
    before = "".join(content for t, content in deltas if question_at is None or t < question_at)
    check(
        "7.2 停顿前只发了正文，问句一个字都没先漏",
        "？" not in before,
        f"停顿前收尾={before[-24:]!r}",
    )

    # ---- 8. 模型与预算口径（勘误 9.36）：不联网，只查 payload ----
    from app.ai.deepseek_client import _payload
    from app.core.config import settings

    chat_payload = _payload(
        [{"role": "user", "content": "hi"}], 0.7, False, settings.DEEPSEEK_CHAT_MAX_TOKENS, thinking=True
    )
    check(
        "8.1 对话 payload：V4.1 Flash + 开思考 + effort 固定 low",
        chat_payload["model"] == "deepseek-flash"
        and chat_payload.get("thinking") == {"type": "enabled"}
        and chat_payload.get("reasoning_effort") == "low",
        f"model={chat_payload['model']} thinking={chat_payload.get('thinking')} "
        f"effort={chat_payload.get('reasoning_effort')}",
    )
    check(
        "8.2 对话 payload：max_tokens=2000 且不带 temperature",
        chat_payload["max_tokens"] == 2000 and "temperature" not in chat_payload,
        f"max_tokens={chat_payload['max_tokens']} keys={sorted(chat_payload)}",
    )
    struct_payload = _payload(
        [{"role": "user", "content": "hi"}], 0.2, False, 2048, json_mode=True, thinking=False
    )
    check(
        "8.3 结构化 payload：关思考 + 带 temperature + 不带 effort",
        struct_payload.get("thinking") == {"type": "disabled"}
        and struct_payload.get("temperature") == 0.2
        and "reasoning_effort" not in struct_payload,
        f"thinking={struct_payload.get('thinking')} temperature={struct_payload.get('temperature')}",
    )

    # ---- 9. chat_json：截断要加倍预算重试，且显式关思考（勘误 9.37） ----
    from app.ai.deepseek_client import chat_json
    from pydantic import BaseModel

    class _Tiny(BaseModel):
        a: int

    class _FakeResp:
        def __init__(self, content: str, finish: str) -> None:
            self._data = {
                "choices": [{"message": {"content": content}, "finish_reason": finish}],
                "usage": {"completion_tokens": 12, "completion_tokens_details": {"reasoning_tokens": 0}},
            }

        def json(self):
            return self._data

    json_calls: list[dict] = []
    original_chat = deepseek_client.chat

    async def fake_chat(messages, temperature, stream, max_tokens, model=None, thinking=None, **kwargs):
        json_calls.append({"max_tokens": max_tokens, "thinking": thinking})
        if len(json_calls) == 1:
            return _FakeResp('{"a": 1', "length")  # 第一次：被截断
        return _FakeResp('{"a": 1}', "stop")  # 第二次：正常

    deepseek_client.chat = fake_chat  # type: ignore[assignment]
    try:
        tiny = await chat_json([{"role": "user", "content": "x"}], _Tiny, max_tokens=2048)
    finally:
        deepseek_client.chat = original_chat  # type: ignore[assignment]

    check("9.1 截断（finish=length）会加倍预算重试", len(json_calls) == 2 and json_calls[1]["max_tokens"] == 4096,
          f"预算序列={[c['max_tokens'] for c in json_calls]}")
    check("9.2 结构化任务显式关思考", all(c["thinking"] is False for c in json_calls),
          f"thinking序列={[c['thinking'] for c in json_calls]}")
    check("9.3 重试后能正常解析出结果", tiny.a == 1, f"结果={tiny!r}")

    # ---- 10. 思考状态：reading -> thinking(心跳) -> writing（勘误 9.38） ----
    async def slow_stream(messages, **kwargs):
        await asyncio.sleep(2.5)  # 模拟"模型在思考"，触发一次心跳
        yield "先说开发这条路：日常大部分时间在读别人的代码、改已有的东西。"

    deepseek_client.stream_chat = slow_stream  # type: ignore[assignment]
    status_events = [
        event
        async for event in chat_service.stream_reply(
            Session(db_session.engine), user.id, conversation.id, messages, brief
        )
        if event.get("type") == "status"
    ]
    stages = [event.get("stage") for event in status_events]
    check("10.1 第一帧状态 = reading（正在翻资料）", stages[:1] == ["reading"], f"stages={stages}")
    check(
        "10.2 思考期间有 thinking 心跳，且带真实耗时",
        "thinking" in stages
        and any(
            event.get("stage") == "thinking" and (event.get("elapsed_ms") or 0) >= 1000
            for event in status_events
        ),
        f"thinking 次数={stages.count('thinking')}；"
        f"elapsed={[e.get('elapsed_ms') for e in status_events if e.get('stage') == 'thinking']}",
    )
    check("10.3 正文开始前有 writing 状态", "writing" in stages, f"stages={stages}")
    order_ok = stages[:1] == ["reading"] and stages.index("writing") > stages.index("thinking")
    check("10.4 顺序是 reading -> thinking -> writing", order_ok, f"stages={stages}")

    print()
    print("=" * 60)
    print(f"通过 {24 - len(FAILED)} / 失败 {len(FAILED)}")
    if FAILED:
        print("失败项：" + "；".join(FAILED))
    print("=" * 60)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
