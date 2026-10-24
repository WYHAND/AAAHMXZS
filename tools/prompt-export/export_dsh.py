#!/usr/bin/env python3
"""把 DeepSeek Desktop（dsh）本地会话导出为可提交的 AI 对话历史快照。

数据来源（Windows）：
    %USERPROFILE%\\.dsh\\sessions\\<项目编码目录>\\<session-id>\\session.v4.jsonl.zstd
    （旧版本为 session.v3.jsonl.zstd）

用法：
    python tools/prompt-export/export_dsh.py \
        --session 98ea5bc3-85cf-48e8-bdad-4c69a13b9e69 \
        --out docs/prompt-history/00-dsh-skeleton/01-frontend-skeleton \
        --title "前端骨架" --commit "3ebd461" --feature "React + Vite 前端脚手架"

依赖：zstandard（pip install zstandard）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import zstandard as zstd

ROOT = os.path.expandvars(r"%USERPROFILE%\.dsh\sessions")
PROJECT_DIR = r"--D-~6587~6863-CODE_PROJIECTS-AAA~9E3F~8499~5C31~4E1A~5C0F~52A9~624B--"

SECRET_PATTERNS = [
    (re.compile(r"sk-[A-Za-z0-9_-]{16,}"), "sk-***REDACTED***"),
    (re.compile(r"ghp_[A-Za-z0-9]{30,}"), "ghp_***REDACTED***"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{20,}"), "github_pat_***REDACTED***"),
    (re.compile(r"LTAI[0-9A-Za-z]{12,}"), "LTAI***REDACTED***"),
    (re.compile(r"(?i)Bearer\s+[A-Za-z0-9._-]{20,}"), "Bearer ***REDACTED***"),
    (re.compile(r"C:\\+Users\\+[^\\\s\"']+"), "%USERPROFILE%"),
    (re.compile(r"C:/+Users/+[^/\s\"']+"), "%USERPROFILE%"),
    (re.compile(r"\b15972\b"), "<user>"),
]


def redact(text: str) -> str:
    for pattern, repl in SECRET_PATTERNS:
        text = pattern.sub(repl, text)
    return text


def fmt_time(ms: int | None) -> str:
    if not ms:
        return ""
    return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M:%S")


def load_events(path: Path):
    raw = zstd.ZstdDecompressor().stream_reader(open(path, "rb")).read().decode("utf-8", errors="replace")
    dec = json.JSONDecoder()
    i, n, out = 0, len(raw), []
    while i < n:
        while i < n and raw[i] in " \r\n\t":
            i += 1
        if i >= n:
            break
        try:
            obj, j = dec.raw_decode(raw, i)
        except json.JSONDecodeError:
            j = raw.find("\n", i)
            if j == -1:
                break
            i = j + 1
            continue
        out.append(obj)
        i = j
    return out


def find_session_file(session: str) -> tuple[Path, str]:
    base = Path(ROOT) / PROJECT_DIR / session
    if not base.is_dir():
        sys.exit(f"session dir not found: {base}")
    for name in ("session.v4.jsonl.zstd", "session.v3.jsonl.zstd"):
        p = base / name
        if p.exists():
            return p, name
    sys.exit(f"no session file in {base}")


def message_of(data: dict) -> dict:
    return data.get("message") if isinstance(data.get("message"), dict) else data


def text_of(parts) -> str:
    return "\n".join(p.get("text", "") for p in (parts or []) if p.get("type") == "text" and p.get("text"))


def render_tool(name: str, arguments: str | dict, max_chars: int) -> str:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except Exception:
            pass
    body = json.dumps(arguments, ensure_ascii=False, indent=2) if not isinstance(arguments, str) else arguments
    body = redact(body)
    if len(body) > max_chars:
        body = body[:max_chars] + "\n…（入参已截断）"
    return f"**工具调用：`{name}`**\n\n```json\n{body}\n```\n"


def render_result(parts, is_error: bool, max_chars: int) -> str:
    result = redact(text_of(parts))
    if not result:
        return ""
    if len(result) > max_chars:
        result = result[:max_chars] + "\n…（输出已截断）"
    prefix = "> ⚠️ 工具报错\n\n" if is_error else "结果：\n\n"
    return f"{prefix}```text\n{result}\n```\n"


def export(session: str, out: Path, title: str, commit: str, feature: str, max_chars: int):
    path, fname = find_session_file(session)
    events = load_events(path)
    meta = next((e for e in events if e.get("type") == "session"), {})
    title_event = next((e["data"].get("title") for e in events if e.get("type") == "session/title"), "")
    model = ""
    for e in events:
        if e.get("type") in ("request/context", "request/header"):
            cfg = e["data"].get("config") or e["data"]
            model = cfg.get("model") or model
    model = model or "deepseek-flash"

    parts_md = [
        f"# {title} · 完整对话记录",
        "",
        f"- 会话 ID：`{session}`",
        f"- 会话标题：{title_event or '（无）'}",
        f"- 时间：{fmt_time(meta.get('createdAt'))} 起",
        f"- AI 工具：DeepSeek Desktop（dsh）",
        f"- 模型：{model}",
        f"- 对应提交：`{commit}`",
        f"- 导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 原始文件：`{fname}`",
        "",
        f"> 说明：已省略系统提示、权限通知、AI 内部推理与心跳事件；工具调用保留名称与入参，输出超过 {max_chars} 字符的部分截断。密钥与用户名已脱敏。",
        "",
        "---",
        "",
    ]
    prompts = []
    turn = 0
    rendered_calls = set()
    # 先收集 v4 独立 tool/call 的 callId，避免与 assistant 内的 tool-call 重复
    event_call_ids = {
        e["data"].get("callId")
        for e in events
        if e.get("type") == "tool/call" and e["data"].get("callId")
    }

    for e in events:
        t = e.get("type")
        d = e.get("data") or {}
        if t == "turn/start":
            turn += 1
            parts_md += [f"## 第 {turn} 轮", ""]
        elif t == "user/message":
            msg = message_of(d)
            src = msg.get("source") or {}
            text = text_of(msg.get("content")).strip()
            if not text:
                continue
            if src.get("kind") in ("user-approval", "system", "runtime-context") or text.startswith("The approval policy changed"):
                continue
            if src.get("kind") in ("agent-message", "subagent-settled"):
                parts_md += [f"### 子智能体汇报 · {fmt_time(e.get('time'))}", "", "```text", redact(text[:4000]), "```", ""]
                continue
            prompts.append(text)
            parts_md += [f"### 用户 · {fmt_time(e.get('time'))}", "", "```text", redact(text), "```", ""]
        elif t == "assistant/message":
            msg = message_of(d)
            chunks = []
            for p in msg.get("content", []) or []:
                if p.get("type") == "text" and p.get("text"):
                    chunks.append(redact(p["text"]).strip())
                elif p.get("type") == "tool-call":
                    call_id = p.get("id")
                    if call_id in event_call_ids:
                        continue
                    chunks.append(render_tool(p.get("name", "tool"), p.get("arguments", ""), max_chars))
            if chunks:
                parts_md += [f"### AI · {fmt_time(e.get('time'))}", "", "\n\n".join(chunks), ""]
        elif t == "tool/call":
            call_id = d.get("callId")
            if call_id in rendered_calls:
                continue
            rendered_calls.add(call_id)
            parts_md += [render_tool(d.get("name", "tool"), d.get("arguments", ""), max_chars), ""]
        elif t == "tool/result":
            msg = message_of(d)
            is_error = bool(msg.get("isError") or d.get("isError"))
            block = render_result(msg.get("content"), is_error, max_chars)
            if block:
                parts_md += [block, ""]
        elif t == "assistant/attempt":
            stream = d.get("stream") or []
            for s in stream:
                chunk = s.get("chunk") or {}
                if chunk.get("type") == "finish":
                    reason = chunk.get("reason") or {}
                    if reason.get("kind") == "error":
                        msg = (reason.get("failure") or {}).get("message", "")
                        parts_md += [f"> ⚠️ AI 调用错误：{redact(str(msg))}", ""]
                        break

    out.mkdir(parents=True, exist_ok=True)
    (out / "conversation.md").write_text("\n".join(parts_md), encoding="utf-8")

    plines = [f"# {title} · 人类 Prompt 全记录", ""]
    for i, p in enumerate(prompts, 1):
        plines += [f"## Prompt {i}", "", "```text", redact(p), "```", ""]
    (out / "prompts.md").write_text("\n".join(plines), encoding="utf-8")

    r = [
        f"# {title}",
        "",
        "## 基本信息",
        "",
        "| 项 | 内容 |",
        "|---|---|",
        f"| 功能目标 | {feature} |",
        f"| 对应提交 | `{commit}` |",
        f"| AI 工具 | DeepSeek Desktop（dsh） |",
        f"| 模型 | {model} |",
        f"| 时间 | {fmt_time(meta.get('createdAt'))} 起 |",
        f"| 会话 ID | `{session}` |",
        f"| 人类 Prompt 数 | {len(prompts)} |",
        f"| 事件数 | {len(events)} |",
        "",
        "## 这条链证明了什么",
        "",
        "- 开始前先给出工作目录、技术栈、硬约束与验收标准；",
        "- AI 按约束读文档、改代码、跑验证，而不是自由发挥；",
        "- 过程里保留了工具调用与报错，可回放到具体文件。",
        "",
        "## 如何阅读",
        "",
        "1. `prompts.md`：只看人给出的任务书与追加要求；",
        "2. `conversation.md`：完整对话，含 AI 回复与工具调用（输出已截断）；",
        "3. 对照仓库提交：" + "、".join(f"`git show {c.strip()}`" for c in commit.split("/")) + "。",
        "",
        "> 原始数据来自 DeepSeek Desktop 本地会话（zstd 压缩的 JSONL），导出脚本见 `tools/prompt-export/export_dsh.py`。",
        "",
    ]
    (out / "README.md").write_text("\n".join(r), encoding="utf-8")
    print(f"exported {session} -> {out} (prompts={len(prompts)}, events={len(events)})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--commit", default="（待补）")
    ap.add_argument("--feature", default="（待补）")
    ap.add_argument("--max-tool-chars", type=int, default=1200)
    args = ap.parse_args()
    export(args.session, Path(args.out), args.title, args.commit, args.feature, args.max_tool_chars)


if __name__ == "__main__":
    main()
