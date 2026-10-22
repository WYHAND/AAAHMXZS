"""「这段文本有没有用到某个标签/主题」—— 开场白去重与任务主题剔除**共用**的机械判据。

## 为什么要有这个模块（而不是各自写一份）
项目里有两个地方需要回答同一个问题：**"某个候选（画像标签 / 任务标题）是不是已经
在别处出现过"**：

1. ``chat_service._opening_context``：把"已经聊过"的标签/任务从开场白候选里剔掉，
   让模型**就算想顺着问也没有素材**（``_drop_already_asked``）。
2. ``task_service._plan_theme_material``：把"已经出现在【进行中】任务标题里"的标签
   从任务生成的主题素材里剔掉，让模型**就算想锚在同一个主题上也无从锚起**。

两处的判据必须**完全同一套** —— 一边放宽/收紧而另一边没跟上，就会出现
"开场白认为没聊过、任务生成认为用过了"这种自相矛盾。所以只留这一份实现。

## 为什么必须机械剔除，而不是在 Prompt 里写一句"请注意多样性"
任务生成这条线上一轮已经试过软提示（Prompt 里写明"换一个完全不同的主题或产物形态"），
**实测无效**：模型的输入里「健身」是权重最高的画像标签（0.90，排在标签列表第一行），
而"不能与【进行中】同题"这条硬规则说的是**标题**，于是它给出的答案完全"合规" ——
在健身主题内不停换角度（笔记 → 看板 → 饮食记录 → 动作计数），列表里全是健身。
软提示只是在同一批素材上再请求一次，压不过"权重最高 + 反复出现"这个输入信号。
机械剔除把这件事从**模型的自由裁量**变成**服务端的输入约束**，并且是**可留痕、可验证**的：
日志里能直接看到"这一次剔掉了哪个标签、依据是哪条已有标题"（见 task_service 的
``logger.info("任务主题剔除…")``）。

## 判定信号（宁可多剔、不可漏剔）
``looks_referenced`` 的三条信号命中任一即算"提到了"（详见该函数 docstring）。
多剔的代价只是"这一次少一个候选主题/开场退化成聊日常"，漏剔的代价是
**用户连续两次看到同一件事**（开场白重复提问 / 任务主题全都一样）—— 那正是要修的 bug。

本来这两个函数长在 ``chat_service`` 里（私有名 ``_looks_referenced`` /
``_drop_already_asked``）；本模块只是把它们**原样搬过来**，chat_service 侧用
私有别名 import 回去，行为一个字都没变。
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import List, Optional, Sequence, Tuple


def looks_referenced(term: str, text: str) -> bool:
    """判断 ``text`` 是不是"提到了"某个任务标题 / 标签。

    用于服务端剔除，**宁可多剔、不可漏剔** —— 漏剔的后果就是用户连续两次被问同一件事，
    那正是这次要修的 bug；多剔的后果只是这次开场退化成聊日常（Prompt 允许）。

    两条信号，命中任一即算提到：
    1. **最长公共子串 ≥ 3**：关键词被原样写出（标题『…通讯录小项目』-> 开场白里的"通讯录"）；
    2. **短词的单字覆盖率 ≥ 0.5**：模型改写了措辞
       （标签『剪辑』-> 开场白的"剪视频"，只共用"剪"一个字）。
       只对短词（去重后 ≤6 字）用这条，避免长标题跟随便一句话撞出高覆盖率。
    3. **短词里的英文词根出现**：标签『C语言』-> 开场白只写"用C做个…"（把"语言"省了）。
       实测就是这个漏网之鱼：『C语言』没被判成已问过，于是连着三个会话都在聊 C。

    ⚠️ 任务主题剔除（``task_service``）复用同一函数时，``term`` 是**画像标签**（多为 2-4 字），
    ``text`` 是**已有任务标题**：短标签的"单字覆盖率"这条会偏宽松（例如标签『健身』
    只要标题里出现"健"或"身"就算），这是刻意的 —— 与开场白同一套"宁可多剔"的口径。
    """
    if not term or not text:
        return False
    # 去掉空白再比：模型经常写成"用 C 做个通讯录"，而标题是"用C语言…"
    left = re.sub(r"\s+", "", term)
    right = re.sub(r"\s+", "", text)
    if not left or not right:
        return False
    if left in right:
        return True
    longest = SequenceMatcher(None, left, right).find_longest_match(0, len(left), 0, len(right)).size
    if longest >= 3:
        return True
    unique = set(left)
    if len(unique) > 6:
        return False  # 长标题不走下面两条宽松信号，避免误剔
    if len(unique & set(right)) / len(unique) >= 0.5:
        return True
    tokens = re.findall(r"[A-Za-z]+", left)
    lowered = right.lower()
    return bool(tokens) and all(token.lower() in lowered for token in tokens)


def first_referenced_by(term: str, texts: Sequence[str]) -> Optional[str]:
    """``texts`` 里**第一条**"用到了" ``term`` 的文本（没有则 ``None``）。

    存在的唯一理由是**留痕**：剔除一个主题时必须能说清"依据的是哪条已有标题"
    （``task_service`` 的剔除日志用它；开场白侧只用布尔判定，不需要它）。
    """
    for text in texts:
        if looks_referenced(term, text):
            return text
    return None


def drop_referenced(candidates: Sequence[str], used: Sequence[str]) -> Tuple[List[str], List[str]]:
    """把**已经被用到过**的候选剔出去，返回 ``(保留, 剔除)``（两个列表都保序）。

    ``used`` 的语义由调用方决定，两处各有来源（都要**全给**，只给最近一条会漏剔）：
    - 开场白：**最近 N 条开场白** + **用户最近说过的话**。只剔最近一条的话，
      第 3 个会话仍可能重新捡起第 1 个会话问过的那件事 —— 而验收要求"连续 4 个新会话
      不能有两条落在同一件事上"，所以范围要覆盖我们喂给模型的全部 ``recent_openings``；
      用户原话也要并进来：开场白路径里模型最容易被这些原话带跑
      （用户说"健身、刷视频、看短句" -> 新会话开场白就问健身）。
    - 任务生成：**当前用户「进行中」的任务标题**（同题红线 + 主题红线）。
      已完成/已放弃的任务**不在**这里 —— 它们是"可承接"的素材（可以先确认到哪一步、再往细节里追），
      拿它们剔标签会让用户再也做不了想进阶的主题。

    判定直接复用 :func:`looks_referenced`（宁可多剔、不可漏剔）。
    """
    kept: List[str] = []
    dropped: List[str] = []
    for candidate in candidates:
        if any(looks_referenced(candidate, text) for text in used):
            dropped.append(candidate)
        else:
            kept.append(candidate)
    return kept, dropped
