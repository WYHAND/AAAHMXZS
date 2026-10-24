"""后端 QA 探针：接口健康 + 越权矩阵 + 响应时间。

为什么是脚本而不是 pytest：本项目 `backend/tests/` 只有 README，没有安装 pytest
（见 `backend/tests/README.md` 与 §15.1）。验证靠「起真实服务 + 打真实接口」，
与 `backend/scripts/` 下既有的探针脚本一致。

用法（必须用 venv 的解释器，系统 Python 没有依赖）：
    backend\\venv\\Scripts\\python.exe backend\\scripts\\qa_probe.py

账号一律用 `probe_<6位十六进制>` 前缀，符合 `scripts/cleanup_probe_data.py` 的探针约定，
跑完可以用它回收；本脚本自己也会删掉自己建的会话。

退出码：0 = 全部符合预期；1 = 有断言失败（失败项会打印出来）。
"""

from __future__ import annotations

import secrets
import sys
import time

import httpx

BASE = "http://localhost:8000/api/v1"
PREFIX = f"probe_{secrets.token_hex(3)}"

client = httpx.Client(base_url=BASE, timeout=30.0)
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


def join(path: str) -> str:
    return path


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def envelope(resp: httpx.Response) -> tuple[int, dict | None]:
    """返回 (业务 code, data)；无法解析时 code = HTTP 状态码。"""
    try:
        body = resp.json()
    except Exception:  # noqa: BLE001
        return resp.status_code, None
    return int(body.get("code", resp.status_code)), body.get("data")


def register(username: str) -> str | None:
    r = client.post(
        join("/auth/register"),
        json={"username": username, "password": "probe-pass-123456", "grade": "大三"},
    )
    code, data = envelope(r)
    if code == 0 and isinstance(data, dict):
        return data.get("access_token")
    return None


def main() -> int:
    # ---------- 0. 服务可达 ----------
    t0 = time.perf_counter()
    try:
        r = client.get("/auth/me")
    except httpx.HTTPError as exc:
        print(f"!! 后端不可达（{exc}）。先确认 8000 端口在跑。")
        return 1
    reach_ms = (time.perf_counter() - t0) * 1000
    check("服务可达 /auth/me 未带 token 应 401", r.status_code == 401, f"HTTP {r.status_code}，{reach_ms:.0f}ms")

    # ---------- 1. 注册两个探针账号 ----------
    token_a = register(f"{PREFIX}_a")
    token_b = register(f"{PREFIX}_b")
    check("注册探针账号 A/B", bool(token_a and token_b))
    if not (token_a and token_b):
        print("!! 注册失败，后面的越权用例无法进行。")
        report()
        return 1

    # ---------- 2. 各自身份 ----------
    ca, da = envelope(client.get("/auth/me", headers=auth(token_a)))
    cb, _ = envelope(client.get("/auth/me", headers=auth(token_b)))
    check("/auth/me A/B 都能读自己", ca == 0 and cb == 0)

    # ---------- 3. A 建一个会话（越权矩阵的靶子） ----------
    t0 = time.perf_counter()
    r = client.post("/chat/conversations", json={}, headers=auth(token_a))
    conv_ms = (time.perf_counter() - t0) * 1000
    code, conv = envelope(r)
    conv_id = (conv or {}).get("id") if isinstance(conv, dict) else None
    check("A 创建会话", code == 0 and bool(conv_id), f"{conv_ms:.0f}ms")
    if not conv_id:
        report()
        return 1

    # ---------- 4. 越权矩阵：B 碰 A 的会话，必须 404（不是 403，避免存在性泄露） ----------
    cases = [
        ("B 读 A 会话的消息", client.get(f"/chat/conversations/{conv_id}/messages", headers=auth(token_b))),
        ("B 删 A 的会话", client.delete(f"/chat/conversations/{conv_id}", headers=auth(token_b))),
        ("B 向 A 会话发消息", client.post(f"/chat/conversations/{conv_id}/messages", json={"content": "hi"}, headers=auth(token_b))),
    ]
    for name, resp in cases:
        code, _ = envelope(resp)
        check(name + " → 应 404/2001", code == 2001 or resp.status_code == 404, f"code={code} HTTP={resp.status_code}")

    # A 自己访问必须成功（否则说明是"谁都进不去"，不是越权防护）
    ca2, _ = envelope(client.get(f"/chat/conversations/{conv_id}/messages", headers=auth(token_a)))
    check("A 读自己的会话 → 应成功", ca2 == 0, f"code={ca2}")

    # ---------- 5. 响应时间抽样（迭代 3 的基线） ----------
    timings = []
    for path in ["/auth/me", "/chat/conversations", "/profile", "/home/summary"]:
        t0 = time.perf_counter()
        client.get(path, headers=auth(token_a))
        timings.append((path, (time.perf_counter() - t0) * 1000))
    for path, ms in timings:
        check(f"计时 {path}", True, f"{ms:.0f}ms")
    slow = [f"{p} {ms:.0f}ms" for p, ms in timings if ms > 1500]
    check("无接口慢于 1500ms", not slow, ", ".join(slow))

    # ---------- 6. 收尾：删掉自己建的会话（不留数据） ----------
    client.delete(f"/chat/conversations/{conv_id}", headers=auth(token_a))
    check("清理：删掉探针会话", True, "（账号 probe_* 可用 scripts/cleanup_probe_data.py 回收）")

    report()
    return 0 if all(ok for _, ok, _ in results) else 1


def report() -> None:
    print("\n结果")
    print("-" * 72)
    for name, ok, detail in results:
        print(("[OK] " if ok else "[NG] ") + name + (f"   [{detail}]" if detail else ""))
    failed = [n for n, ok, _ in results if not ok]
    print("-" * 72)
    print(f"探针账号前缀：{PREFIX}")
    if failed:
        print(f"失败 {len(failed)} 项：" + " / ".join(failed))
    else:
        print(f"全部通过（{len(results)} 项）")


if __name__ == "__main__":
    sys.exit(main())
