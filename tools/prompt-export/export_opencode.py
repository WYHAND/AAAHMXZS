#!/usr/bin/env python3
"""把 opencode 本地会话导出为可提交的「AI 对话历史快照」。

数据来源（Windows）：
    %USERPROFILE%\\.local\\share\\opencode\\opencode.db
    （macOS/Linux：~/.local/share/opencode/opencode.db）

用法：
    python tools/prompt-export/export_opencode.py \
        --session ses_xxx --out docs/prompt-history/01-xxx \
        --title "xxx" --commit "3c61de3" --feature "xxx"

输出：
    <out>/README.md          # 链条说明：时间、模型、对应提交、目标、关键 Prompt
    <out>/conversation.md    # 完整对话：用户 Prompt / AI 回复 / 工具调用与结果（截断）
    <out>/prompts.md         # 只含人类 Prompt，方便评委快速看意图演进
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_DB = os.path.expandvars(r"%USERPROFILE%\.local\share\opencode\opencode.db")

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


def load_messages(con: sqlite3.Connection, sid: str):
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "select id, type, seq, time_created, data from session_message "
        "where session_id=? order by seq",
        (sid,),
    ).fetchall()
    out = []
    for r in rows:
        try:
            data = json.loads(r["data"])
        except Exception:
            data = {"raw": r["data"]}
        out.append({"id": r["id"], "type": r["type"], "seq": r["seq"], "time": r["time_created"], "data": data})
    return out


def part_text(part: dict) -> str:
    return part.get("text", "") or ""


def tool_block(part: dict, max_chars: int) -> str:
    name = part.get("name", "tool")
    state = part.get("state", {}) or {}
    inp = state.get("input", {})
    status = state.get("status", "")
    lines = [f"**工具调用：`{name}`**（state={status}）", ""]
    if inp:
        rendered = redact(json.dumps(inp, ensure_ascii=False, indent=2))
        if len(rendered) > max_chars:
            rendered = rendered[:max_chars] + "\n…（入参已截断）"
        lines += ["```json", rendered, "```", ""]
    content = state.get("content", []) or []
    texts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
    result = "\n".join(t for t in texts if t)
    if result:
        if len(result) > max_chars:
            result = result[:max_chars] + "\n…（输出已截断）"
        lines += ["结果：", "```text", redact(result), "```", ""]
    return "\n".join(lines)


def export(sid: str, out: Path, title: str, commit: str, feature: str, db: str, max_chars: int):
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    meta = con.execute("select title, time_created, directory from session_v2 where id=?", (sid,)).fetchone()
    if not meta:
        sys.exit(f"session not found: {sid}")
    session_title, started, directory = meta
    msgs = load_messages(con, sid)

    users = []
    for m in msgs:
        if m["type"] == "user":
            t = (m["data"].get("text") or "").strip()
            if t and not t.startswith("You are a subagent"):
                users.append(t)

    models = []
    for m in msgs:
        if m["type"] == "assistant":
            model = (m["data"].get("model") or {}).get("id")
            if model and model not in models:
                models.append(model)

    # ---- conversation.md ----
    lines = [
        f"# {title} · 完整对话记录",
        "",
        f"- 会话 ID：`{sid}`",
        f"- 会话标题：{session_title or '（无）'}",
        f"- 时间：{fmt_time(started)} 起，共 {len(msgs)} 条记录",
        f"- 模型：{', '.join(models) or '未知'}",
        f"- 对应提交：`{commit}`",
        f"- 导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "> 说明：已省略系统提示、空转记录与 AI 内部推理；工具调用保留名称与关键入参，输出超过 "
        f"{max_chars} 字符的部分截断。密钥与用户名已脱敏。",
        "",
        "---",
        "",
    ]
    turn = 0
    for m in msgs:
        d = m["data"]
        t = m["type"]
        if t == "user":
            text = (d.get("text") or "").strip()
            if not text or text.startswith("You are a subagent"):
                continue
            turn += 1
            lines += [f"## 第 {turn} 轮 · 用户 · {fmt_time(m['time'])}", "", "```text", redact(text), "```", ""]
        elif t == "assistant":
            model = (d.get("model") or {}).get("id", "")
            chunks = []
            for p in d.get("content", []) or []:
                if p.get("type") == "text" and p.get("text"):
                    chunks.append(redact(p["text"]).strip())
                elif p.get("type") == "tool":
                    chunks.append(tool_block(p, max_chars))
            err = d.get("error")
            if err:
                chunks.append(f"> ⚠️ AI 调用错误：`{err.get('type')}` {redact(str(err.get('message', '')))}")
            if not chunks:
                continue
            lines += [f"### AI · {fmt_time(m['time'])}" + (f"（{model}）" if model else ""), ""]
            lines += ["\n\n".join(chunks), ""]
        elif t == "model-switched":
            lines += [f"> 切换模型：`{json.dumps(d, ensure_ascii=False)[:300]}`", ""]

    out.mkdir(parents=True, exist_ok=True)
    (out / "conversation.md").write_text("\n".join(lines), encoding="utf-8")

    # ---- prompts.md ----
    plines = [f"# {title} · 人类 Prompt 全记录", ""]
    for i, u in enumerate(users, 1):
        plines += [f"## Prompt {i}", "", "```text", redact(u), "```", ""]
    (out / "prompts.md").write_text("\n".join(plines), encoding="utf-8")

    # ---- README.md ----
    r = [
        f"# {title}",
        "",
        "## 基本信息",
        "",
        "| 项 | 内容 |",
        "|---|---|",
        f"| 功能目标 | {feature} |",
        f"| 对应提交 | `{commit}` |",
        f"| AI 工具 | opencode（本地会话） |",
        f"| 模型 | {', '.join(models) or '未知'} |",
        f"| 时间 | {fmt_time(started)} 起 |",
        f"| 会话 ID | `{sid}` |",
        f"| 人类 Prompt 数 | {len(users)} |",
        f"| 记录条数 | {len(msgs)} |",
        "",
        "## 这条链证明了什么",
        "",
        "- 需求由人用自然语言提出，AI 先给方案再改代码；",
        "- 中途出现的问题通过追加 Prompt 纠偏，而不是一次性生成；",
        "- 每次改动都能在 `conversation.md` 里对应到具体的工具调用与文件。",
        "",
        "## 如何阅读",
        "",
        "1. `prompts.md`：只看人说了什么，能快速看出意图如何收敛；",
        "2. `conversation.md`：完整对话，含 AI 回复与工具调用（输出已截断）；",
        "3. 对照仓库提交：" + "、".join(f"`git show {c.strip()}`" for c in commit.split("/")) + "。",
        "",
        "> 原始数据来自 opencode 本地数据库，导出脚本见 `tools/prompt-export/export_opencode.py`。",
        "",
    ]
    (out / "README.md").write_text("\n".join(r), encoding="utf-8")

    print(f"exported {sid} -> {out} (users={len(users)}, msgs={len(msgs)})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--commit", default="（待补）")
    ap.add_argument("--feature", default="（待补）")
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--max-tool-chars", type=int, default=1200)
    args = ap.parse_args()
    export(args.session, Path(args.out), args.title, args.commit, args.feature, args.db, args.max_tool_chars)


if __name__ == "__main__":
    main()
