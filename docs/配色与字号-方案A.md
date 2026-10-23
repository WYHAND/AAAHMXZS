# 方案 A 落地规范（暖纸 · 墨蓝 · 赭金）

> 2026-10-22。这份文档是**改页面时唯一的口径**，与代码冲突时以本文为准并顺手改代码。
> token 已经落在 `frontend/src/index.css`，**页面里不要再写十六进制色值**。

---

## 一、这套方案解决什么问题

旧版三处病根（已确认）：

1. 全站黑白 → 所有色块都是米白，分区读不出来；
2. 正文 12–14px → 一屏 77% 的文字在 12–13px，层级等于没有；
3. 循环动效被禁 → 页面只剩进场，静。

方案 A 的答案：**暖纸底 + 白卡 + 一个赭金强调色 + 更大的字号**。不加彩虹，不加弹跳。

---

## 二、色板（只认这套）

| 用途 | token | 值 |
|---|---|---|
| 页面画布 | `bg-surface` / `bg-canvas` | `#F2EBE1` |
| 卡片 | `bg-card` | `#FFFFFF` |
| 侧栏 / 卡外浅底 | `bg-surface-container-low` | `#ECE2D5` |
| 卡内浅底块 | `bg-surface-inset` | `#F5EFE6` |
| 主墨（标题/正文/主按钮） | `text-primary` / `bg-primary` | `#0B1526` |
| 次要文字 | `text-on-surface-variant` | `#5F6470` |
| **强调（唯一彩色）** | `text-secondary` / `bg-secondary` | `#B4551F` |
| 浅赭小底（chip/标记） | `bg-secondary-fixed` | `#FAEDE3` |
| 正向 / 已完成 | `text-settled` | `#3F6B45` |
| 错误 / 真正的停滞（极少用） | `text-attention` | `#B04A3A` |
| 描边 | `border-border` | 暖棕 16% |
| caption 文字 | `text-caption-foreground` | `#6B6154` |

### 用色纪律（违反就会回到"花"）

0. **预览图里没有的颜色，一律不许出现**。蓝、紫、青、天蓝全部退场。
   `--signal` 这个 token 名字还在，但值已经等于赭金——老代码里 `tone="signal"`
   不会再带出蓝色。新代码请直接用 `accent` / `text-secondary`。
1. **赭金一屏最多一处实心**（一个按钮 / 一个色块）。其余只做：细线、小圆点、文字、数据图形。
2. 赭金负责"现在要看的 / 可以点的 / 数据图形"；墨色负责"内容本身"；绿只给"已经到手"；
   红只给真正的错误，一屏最多一处，**能不用就不用**。
3. 状态色只落在图形和小圆点上，不做整块底色，也不给正文上色。
4. 图表底一律中性（`bg-surface-inset` 或 `bg-surface-container-low`），不要用彩色当大底。
5. 禁止 Tailwind 默认色板（`bg-amber-500`、`text-blue-600`、`bg-gray-100`…）。颜色只从 token 取。

---

## 三、字号阶（只有这 8 档）

| token | px / 行高 | 用在哪 |
|---|---|---|
| `text-display-xl` | 46 / 56 / 700 | 仅首页问候。其它页面禁止 |
| `text-display` | 34 / 44 / 700 | **每页最多一处**的主角数字 / 首页焦点卡主句 |
| `text-headline-xl` | 30 / 38 / 700 | 页面 h1（`PageHeader` 已内置）、首页"今日一问" |
| `text-headline-lg` | 24 / 32 / 600 | 大分节 |
| `text-headline-md` | **20 / 28 / 600** | **卡内标题 / 结论句（最常用）** |
| `text-headline-sm` | 17 / 25 / 600 | 列表项标题、卡片副标题 |
| `text-body-lg` | 16 / 26 | 页面导语、重点说明 |
| `text-body-md` | **15 / 25** | 正文（默认） |
| `text-body-sm` | 14 / 22 | 次要说明（**承载信息的最低档**） |
| `text-label-md` | 14 / 20 / 500 | 按钮、导航、表单标签 |
| `text-caption` | 13 / 19 | **只做装饰**：日期、`3/200` 计数、角标、分组小标题 |

### 字号纪律

1. **`text-caption` 不许承载信息**。凡是"用户需要读到才能做决定"的文字，最低 `text-body-sm`。
2. 一个卡片里最多三档：标题（20）+ 正文/说明（15/14）+ 装饰（13）。不要四世同堂。
3. 页面里禁止 `text-xs` / `text-sm`（lint 会拦），层级一律用语义 token。
4. 卡内标题必须**是一句结论**（"你最近卡在「缺项目经验」"），不是栏目名（"AI 发现"）。栏目名可以降级成 13px 的 eyebrow。

---

## 四、几何

- 圆角：卡片 `rounded-xl`（18）/ 控件 `rounded-md`（12）/ 卡内块 `rounded-lg`（10）/ chip `rounded-full`。
- 卡片内边距：`Panel` 默认 `p-6`；卡内浅底块 `p-4`。
- 卡片阴影：`shadow-card`（已调暖）。
- 页面容器：`max-w-[1040px]`，页面纵向节奏 `gap-6`，分节之间 `gap-8`。

---

## 五、每个页面要做的四件事（checklist）

1. **一个主角**：这一屏最重要的那块，用深色块或 20px 结论句立起来；其余全部退后。
2. **标题改结论**：把"栏目名式"标题改成"用户能得到什么"的一句话（数据允许的情况下；不要编造数字）。
3. **说明文字抬到 14**：`text-caption` → `text-body-sm`，尤其是卡片里的解释、空态描述、提示语。
4. **赭金只花一次**：每屏挑一个地方用赭金（进度 / 关键数字 / 唯一主按钮 / 可点文字），其余保持墨色。

---

## 六、禁止

- 不改业务逻辑、接口字段、路由、文案语义（只允许把栏目名改成同义的结论句）。
- 不新增依赖，不引入图表库。
- 不手写 `@keyframes` / `animation:`（动效语汇在 `index.css`）。
- 不用 `transition-all`。
- 不在页面里写死颜色（`#xxx`、`rgb()`、Tailwind 默认色板）。
- 不改 `src/components/**` 与 `src/index.css`（共享层已统一改完）；确实需要，写进报告由主进程处理。

---

## 七、已完成（不要重复改）

- `frontend/src/index.css`：色板、字号阶、圆角、阴影、动效节拍
- 共享组件：`Panel` / `PageHeader` / `StatGroup` / `Button` / `SignalBar` / `ActivityStrip` / `ProfileRadar`（新增 `tone="accent"`）
- `pages/home/HomePage.tsx`（作为样式样板，改之前先看一眼）
