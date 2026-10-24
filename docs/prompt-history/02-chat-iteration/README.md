# AI 对话质量迭代：从「像客服」到会追问

## 基本信息

| 项 | 内容 |
|---|---|
| 功能目标 | AI 职业指导对话的语气、追问逻辑与就业引导 |
| 对应提交 | `72a4c18 / c55d401` |
| AI 工具 | opencode（本地会话） |
| 模型 | deepseek-v4.1-flash |
| 时间 | 2026-10-18 00:26:22 起 |
| 会话 ID | `ses_eb5506e03ffdl56wY6ij63Cbp7` |
| 人类 Prompt 数 | 10 |
| 记录条数 | 149 |

## 这条链证明了什么

- 需求由人用自然语言提出，AI 先给方案再改代码；
- 中途出现的问题通过追加 Prompt 纠偏，而不是一次性生成；
- 每次改动都能在 `conversation.md` 里对应到具体的工具调用与文件。

## 如何阅读

1. `prompts.md`：只看人说了什么，能快速看出意图如何收敛；
2. `conversation.md`：完整对话，含 AI 回复与工具调用（输出已截断）；
3. 对照仓库提交：`git show 72a4c18`、`git show c55d401`。

> 原始数据来自 opencode 本地数据库，导出脚本见 `tools/prompt-export/export_opencode.py`。
