# 模拟面试：语音输入与实时语音对话

## 基本信息

| 项 | 内容 |
|---|---|
| 功能目标 | 模拟面试接入语音输入与实时语音对话（ASR/TTS），含方案讨论与降级 |
| 对应提交 | `c55d401` |
| AI 工具 | opencode（本地会话） |
| 模型 | deepseek-v4.1-flash |
| 时间 | 2026-10-20 21:12:53 起 |
| 会话 ID | `ses_ea68e7fc5ffe1FaGvFkT3nD995` |
| 人类 Prompt 数 | 33 |
| 记录条数 | 384 |

## 这条链证明了什么

- 需求由人用自然语言提出，AI 先给方案再改代码；
- 中途出现的问题通过追加 Prompt 纠偏，而不是一次性生成；
- 每次改动都能在 `conversation.md` 里对应到具体的工具调用与文件。

## 如何阅读

1. `prompts.md`：只看人说了什么，能快速看出意图如何收敛；
2. `conversation.md`：完整对话，含 AI 回复与工具调用（输出已截断）；
3. 对照仓库提交：`git show c55d401`。

> 原始数据来自 opencode 本地数据库，导出脚本见 `tools/prompt-export/export_opencode.py`。
