# 测试目录（骨架阶段为空）

## 为什么没有测试文件

任务要求骨架阶段**不写测试文件**，因此本目录只保留占位说明。

## 有 Python 3.12 后怎么补测试（手册 15.1 / 15.3 / 15.4）

```bash
pip install pytest pytest-asyncio
pytest -q
```

约定：

- `test_auth.py`：注册 / 登录 / me（11.1）
- `test_profile.py`：测试表提交 -> 画像生成 -> 阶段判定（11.2 / 11.3 / 附录B）
- `test_chat.py`：SSE 流式端点（7.2）+ 追问计数（7.7）
- `test_ai_schema.py`：固定输入校验 Pydantic 结构化输出（15.3）
- `conftest.py`：`TestClient` fixture + Mock DeepSeek（15.4，避免真实调用花钱）

Mock DeepSeek 的推荐做法：monkeypatch `app.ai.deepseek_client.chat_text`
与 `app.ai.deepseek_client.stream_chat`，直接返回固定文本 / 固定增量序列。
