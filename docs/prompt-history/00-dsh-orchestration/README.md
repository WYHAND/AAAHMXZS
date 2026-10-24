# 从规格到前后端骨架：主会话与子智能体编排

## 基本信息

| 项 | 内容 |
|---|---|
| 功能目标 | 按开发手册与设计说明书搭建前端/后端骨架，并用子智能体并行落地 |
| 对应提交 | `3ebd461 / 7df626f` |
| AI 工具 | DeepSeek Desktop（dsh） |
| 模型 | deepseek-flash |
| 时间 | 2026-09-18 18:54:39 起 |
| 会话 ID | `session-f2d1d0de-b3cc-4826-8715-9241d8d679c0` |
| 人类 Prompt 数 | 125 |
| 事件数 | 9295 |

## 这条链证明了什么

- 开始前先给出工作目录、技术栈、硬约束与验收标准；
- AI 按约束读文档、改代码、跑验证，而不是自由发挥；
- 过程里保留了工具调用与报错，可回放到具体文件。

## 如何阅读

1. `prompts.md`：只看人给出的任务书与追加要求；
2. `conversation.md`：完整对话，含 AI 回复与工具调用（输出已截断）；
3. 对照仓库提交：`git show 3ebd461`、`git show 7df626f`。

> 原始数据来自 DeepSeek Desktop 本地会话（zstd 压缩的 JSONL），导出脚本见 `tools/prompt-export/export_dsh.py`。
