# AI 对话历史快照

这里是本项目在 **opencode** 与 **DeepSeek Desktop（dsh）** 中与 AI 协作的原始会话导出，用于证明「代码不是一次性生成的」，每一次功能落地都能对上具体的人类 Prompt、AI 建议与修 Bug 过程。

## 数据来源

| 工具 | 数据位置 | 会话量 | 导出脚本 |
|---|---|---|---|
| DeepSeek Desktop（dsh） | `%USERPROFILE%\.dsh\sessions\...\*.jsonl.zstd` | 本项目 99 个会话 | `tools/prompt-export/export_dsh.py` |
| opencode | `%USERPROFILE%\.local\share\opencode\opencode.db` | 本项目 86 个会话、7,514 条消息 | `tools/prompt-export/export_opencode.py` |

- **脱敏**：API Key、GitHub Token、本机用户名已替换；工具输出超过 900～1,200 字符的部分截断。
- **未包含**：系统提示、AI 内部推理、权限通知、空转记录。
- 导出是**只读**操作：脚本直接读本地会话库，不修改原始记录。

## 核心功能链（4 个功能 / 5 条会话）

### 0. DSH 主会话：从规格到前后端骨架（含子智能体编排）

- 目录：`00-dsh-orchestration/`
- 时间：2026-09-18 ~ 10-09
- 人类 Prompt：125 条 | 事件：9,295 条
- 模型：`deepseek-flash`
- 对应提交：`3ebd461` / `7df626f`
- 这条链里能看到：
  - 先让 AI 读开发手册与前端设计说明书，再出计划、再动工；
  - 用子智能体并行搭前端/后端骨架，主会话负责验收与纠偏；
  - 早期 SSE、M1 联调、时区等 Bug 的修复记录都在子智能体汇报里。
- 说明：这是 9 月 18 日到 10 月 9 日的长会话，包含后期穿插的后端修复；Prompt 保留了原始口语，未做润色。

### 1. 模拟面试：语音输入与实时语音对话

- 目录：`01-voice-interview/`
- 时间：2026-10-20 ~ 10-22
- 人类 Prompt：33 条 | 记录：384 条
- 模型：`deepseek-v4.1-flash`
- 对应提交：`c55d401`
- 这条链里能看到：
  - 先讨论「接第三方语音大模型还是自建」，再对比成本与延迟；
  - 最终确定「题库 + 追问模块已有，只补 ASR/TTS」的克制方案；
  - 语音入口无 Key 时自动隐藏的降级决策。

### 2. AI 对话质量迭代：从「像客服」到会追问

- 目录：`02-chat-iteration/`
- 时间：2026-10-18
- 人类 Prompt：10 条 | 记录：149 条
- 对应提交：`72a4c18`
- 这条链里能看到：
  - 用户指出 AI 把所有人往「打游戏」引导，要求转向就业方向；
  - AI 先给修改方案，再改 prompt 与对话策略；
  - 用户用真实对话截图验收，AI 继续收敛追问方式。

### 3. 简历功能迭代（两条子链）

#### 3.1 布局拥挤与 AI 润色失效

- 目录：`03-resume-iteration/01-layout-polish-bug/`
- 时间：2026-10-17
- 人类 Prompt：2 条 | 记录：87 条
- 对应提交：`3c61de3`
- 这条链里能看到：一次提出 3 个具体缺陷（侧栏占位、AI 润色一直失败、无项目经历的死路），AI 先给方案再动工。

#### 3.2 打印导出丢失分隔线

- 目录：`03-resume-iteration/02-print-export-bug/`
- 时间：2026-10-20 ~ 10-22
- 人类 Prompt：7 条 | 记录：156 条
- 对应提交：`ebd8b89` / `c55d401`
- 这条链里能看到：从「能导出」到「导出必须和页面一模一样」，再到分页/分隔线的逐轮修复。

## 每个目录里有什么

| 文件 | 用途 |
|---|---|
| `README.md` | 该链条的元信息：时间、模型、对应提交、功能目标 |
| `prompts.md` | 只保留人类 Prompt，适合快速看意图如何收敛 |
| `conversation.md` | 完整对话：用户 Prompt + AI 回复 + 工具调用与结果（截断） |

## 怎么核对

1. 打开 `prompts.md`，看需求是怎么一步步变具体的；
2. 打开 `conversation.md`，搜关键词（如「润色」「分隔线」），看 AI 如何定位与修改；
3. 在仓库执行对应提交的 `git show`，确认改动文件与对话里提到的文件一致。

## 重新导出

```powershell
# opencode 会话
.\backend\venv\Scripts\python.exe tools\prompt-export\export_opencode.py `
  --session ses_xxx --out docs\prompt-history\xx-name `
  --title "链条标题" --commit "提交短哈希" --feature "功能目标"

# DeepSeek Desktop（dsh）会话
.\backend\venv\Scripts\python.exe tools\prompt-export\export_dsh.py `
  --session xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx --out docs\prompt-history\xx-name `
  --title "链条标题" --commit "提交短哈希" --feature "功能目标"
```

> 说明：比赛要求至少 3 个核心功能迭代的完整 Prompt 链。这里提供 4 个功能、5 条会话；其中简历功能拆成「布局/润色」与「导出/打印」两条，便于评委看到同一模块的连续演进。DSH 主会话用于补齐 9 月 18 日～10 月 9 日、opencode 数据库中缺失的早期演进。
