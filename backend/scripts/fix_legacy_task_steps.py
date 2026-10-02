"""一次性数据清理脚本：把「老任务步骤」按新规则**最小改写**成合规步骤（跑完可留档，不必删）。

## 为什么需要它
``backend/app/ai/prompts/task_generate.txt`` 的规则 3 / 规则 4 已经改成：
**打卡区只能点选（选择型选项）+ 最多 30 字文本；禁止截图/上传/拍照/录屏/附件，禁止写小作文。**
提示词挡住了**新生成**的任务，但库里**老任务的老步骤**还是旧的写法（要求上传、录屏、写 500 字…）。
用户拍板：按新规则**重写**老步骤，而不是删掉重生成 —— 因为**用户的打卡记录必须保留**。

## 改写策略：最小改动（不是整段替换）
本项目的产品红线是「``action_score`` 只靠**真实行动**涨（声称 ≠ 证据）」，所以：

1. **真实动作必须原样保留**：画草图、敲代码、去 B 站看视频、自己讲一遍、写一句话……
   这些是"用户真的要去做的事"，一个字都不动。
2. 只处理**违规的那部分**：
   - 提交/上传要求（"写完发给我看"）-> 删掉提交动作，改成"自己留着就行，不用发给我们"；
   - 录屏/录视频（"打开录屏"、"录 3 分钟演示视频"）-> 去掉"录"，保留"自己完整讲一遍"；
   - 写小作文（"写一段 100 字左右的总结"、"写下 10 个…"、"写 3 句话…"）->
     **降到 ≤30 字的文本要求**（一句话填空 / 2-3 个短空 / 每个 ≤10 字），
     原来的结构、条目、用户自己的兴趣内容全部保留。
3. **点选只能当补充，不能替代行动**：本脚本只在原来就是"给个结论"的地方把它变成点选
   （例如"给出一句结论：继续试 / 换一个方向" -> "点选 1 个结论：A 继续试；B 换一个方向"）；
   绝不会把"画草图 / 敲代码"换成"勾选自评完成度"。
4. 改写完跑三条自校验（不静默通过，不合格的进"需人工决定"）：
   - 改写后的文本不再命中任何违规规则；
   - **title↔action 语义一致**：title 里的动作词（画/写/做/讲/看/运行…）在改写后的 action 里
     必须仍有对应动作（"画出草图或写清功能清单" -> action 保留"画出界面草图" 才算过），
     且 title 不能继续提供 action 里已经被删掉的选项/产物（那条标题会被一并收短）；
   - **最小改动证据**：改写后的 action 与原文必须共享 ≥8 字的连续片段，否则判"疑似整体替换"。
5. **结论性步骤（本来就在边界内）不动**：``写下今天的一个收获 / 三句话以内即可`` 这类
   自己已经把边界收在 ≤3 句话的，算合规，不碰（避免无意义 churn）。

## 安全边界（读 models 得出的结论）
- 步骤是**独立表** ``task_steps``，一行一步：``id`` / ``task_id`` / ``step_order`` /
  ``title`` / ``action`` / ``resource`` / ``completed`` / ``feedback`` / ``completed_at``。
- **打卡记录就是这一行本身**（``completed`` + ``feedback`` + ``completed_at``）：
  全库没有第二张"打卡表"，也没有任何表按 step_id 之外的字段（标题 / index）引用步骤。
- 因此本脚本只 UPDATE ``title`` / ``action`` / ``resource`` 三列，**绝不**碰
  ``id`` / ``task_id`` / ``step_order`` / ``completed`` / ``feedback`` / ``completed_at``，
  也**绝不**碰 ``tasks.status``：
  - 前端打卡走 ``POST /task/{task_id}/steps/{step_id}/complete``（按 step_id 定位），
  - 进度按 ``step_order`` 排序 + ``completed`` 计数（``task_service._progress``），
  - ``action_score`` 只数 ``completed == True`` 的步骤（``profile_service``）。
  所以「只改描述文字」对已有打卡与分数是零影响。

## 默认是 dry-run
默认**一个字节都不写库**，只打印"将要做的改动 + 命中依据 + 每一处最小改写"；
必须显式 ``--apply`` 才 commit。已经合规的步骤不动。

## 用法
::

    cd backend
    $env:PYTHONIOENCODING="utf-8"

    # 1) dry-run（默认）：全部用户
    .\\venv\\Scripts\\python.exe scripts\\fix_legacy_task_steps.py

    # 2) 只看某个用户（--user 收 id(UUID) 或 username；注意 users 表没有 email 列）
    .\\venv\\Scripts\\python.exe scripts\\fix_legacy_task_steps.py --user wyh

    # 3) 真正落库（用户拍板后再跑）
    .\\venv\\Scripts\\python.exe scripts\\fix_legacy_task_steps.py --apply

    # 4) 连"已有打卡记录"的违规步骤一起改（默认这类只列成「需人工决定」）
    .\\venv\\Scripts\\python.exe scripts\\fix_legacy_task_steps.py --apply --include-checked-in
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID

# 本脚本在 backend/scripts/ 下，比 backend/_acceptance_opening.py 深一层：
# 直接跑时 sys.path[0] 是 scripts/，`from app...` 会 ImportError。
# 先把 backend/ 塞进 sys.path —— 这是唯一的目的（必须在 import app.* 之前）。
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy import func  # noqa: E402
from sqlalchemy import update as sa_update  # noqa: E402
from sqlmodel import Session, select  # noqa: E402  <= 必须用 sqlmodel 的 select：返回模型实例

from app.db.session import SessionLocal, describe_database  # noqa: E402
from app.models.task import Task, TaskStep  # noqa: E402
from app.models.user import User  # noqa: E402
from app.utils.logger import configure_logging, get_logger  # noqa: E402

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# 一、违规检测规则
# ---------------------------------------------------------------------------
# 检测跑在**单个字段**上（title / action / resource 分别跑），这样报告里能直接说清
# "哪个字段的哪句话违反了哪条规则"。中文匹配刻意**宽松**（宁可多报，不要漏）。
SEVERITY_VIOLATION = "violation"
SEVERITY_SUSPECT = "suspect"

# 规则 4 的禁止词：要求用户交付文件类的东西（打卡区不支持上传）
_P_UPLOAD = re.compile(
    r"截图|截屏|上传|拍照|照相|附件|扫描件|提交文件|传上来|发给我|发我|交给我|交给|交付"
)
# 规则 4 的禁止词：要求录音/录像/录屏
_P_RECORD = re.compile(
    r"录屏|录像|录一段|录个|录一次|录下来|录制|录音|录\s*[0-9一二三四五六七八九十]+\s*分钟|拍一段"
)
# 规则 3 的禁止项：写小作文 / 长文本 / 明确字数要求
_P_ESSAY = re.compile(
    r"写一段|写一篇|写一段话|写小作文|长文本|"
    # 写/列 + N 条|句|个（"写一句话" / "写下今天的一件事" 是提示词允许的短文本写法，
    # 用负向先行断言排除：一件/一些/一点/一种/一份 都不是"要写 N 条"）
    r"(?:写|列)(?:下|出|一下)?[^，。；]{0,6}?"
    r"(?:\d+|[二三四五六七八九十两]{1,3}|一(?!\s*(?:句|条|个|次|遍|件|些|点|种|份)))\s*(?:条|句|个|项|件)|"
    # 写 + N 字 / 写满 N 个 / 不少于 N 字 / "100 字左右"（"不超过 20 字" 由 cap 豁免处理）
    r"写\s*\d+\s*(?:字|个词)|写满\s*\d+|"
    r"(?<!不超过\s)\d{2,}\s*字(?:左右|以上|的)?|不少于\s*\d+\s*字|"
    # N 句话（"一句话" 允许，"三句话" 是提示词里的反例；"三句话以内" 由小自限豁免处理）
    r"(?:[二三四五六七八九十两]|[2-9])\s*句话|"
    # 写/记录 + 收获|感受|总结…（长文本要求的常见说法）
    # 注意不要把 "目标" / "计划" 放进关键词：库里合规写法 "写一句话目标"
    # （提示词 ✓ 例："填空（每空一句话内）"）会被误判成小作文。
    r"(?:写|记下|记录|列出|补充|说明)[^，。；]{0,6}"
    r"(?:收获|感受|总结|体会|心得|反思|想法|看法|观点|理由|原因|分析|细节|心情)|"
    # 明确的"写点什么"要求
    r"写\s*[:：]|详细描述|详细说明|详细讲|展开说明|展开讲|谈谈你的|说说你的|分析一下|总结一下|用自己的话写"
)
# 只报告、不改写：提到视频/图片但**没发现提交动作**（"看一个入门视频"是合规的，
# 提示词禁的是"要求提交/录制"）。这类单独列成"参考提示"，不计入命中。
_P_MEDIA = re.compile(r"视频|图片|照片")


@dataclass(frozen=True)
class DetectRule:
    """一条检测规则。

    - ``negation_safe``：命中点前面紧挨着"不用/无需/不必…"时不算违规
      （库里已有合规写法：``自己把结果存在本地留作纪念（不用交给我们）``）。
    - ``cap_exempt``：命中点附近若给了"不超过 N 字（N<=30）"这类短文本上限，就不算长文本违规
      （例：``填空（每个词不超过 10 个字）`` 是合规的）。
    """

    rule_id: str
    label: str
    pattern: re.Pattern[str]
    severity: str = SEVERITY_VIOLATION
    negation_safe: bool = True
    cap_exempt: bool = False


DETECT_RULES: Tuple[DetectRule, ...] = (
    DetectRule(
        rule_id="R1-提交文件",
        label="规则4：要求截图/上传/拍照/附件/交付文件（打卡区不支持上传）",
        pattern=_P_UPLOAD,
    ),
    DetectRule(
        rule_id="R2-录屏录音",
        label="规则4：要求录屏/录音/录制/录一段（打卡区不支持音视频）",
        pattern=_P_RECORD,
    ),
    DetectRule(
        rule_id="R3-写小作文",
        label="规则3：写小作文/长文本/明确字数要求（应改成点选或 ≤30 字填空）",
        pattern=_P_ESSAY,
        cap_exempt=True,
    ),
    DetectRule(
        rule_id="S1-提到视频图片",
        label="参考：提到 视频/图片/照片，但没发现提交动作（仅提示，不改）",
        pattern=_P_MEDIA,
        severity=SEVERITY_SUSPECT,
        negation_safe=False,
    ),
)

# "不用/无需/不必…" 这类否定，只认紧挨在命中点前面的（窗口 6 字）：
# 放宽窗口会把 "不知道怎么写一段总结" 里的 "不" 也当成否定，导致漏报。
_NEGATION_TAIL = re.compile(r"(?:不用|不需要|无需|无须|不必|不要|别|勿|免|避免)\s*$")

# 短文本上限，三种写法都认：
#   ① "不超过 20 字"   ② "20 字以内"   ③ 小自限 "三句话以内" / "3 条以内"
_CAP_PATTERN = re.compile(
    r"(?:不超过|最多|不多于|上限)\s*(\d+)"
    r"|(\d+)\s*(?:个字|字|个词|词)?\s*(?:以内|以下)"
    r"|([一二三四五六七八九十两]|\d+)\s*(?:句|条|个)\s*(?:话)?\s*(?:以内|以下|之内)"
)
MAX_TEXT_CAP = 30   # 提示词规则 4：打卡区最多写 30 字补充
MIN_KEEP_LCS = 8    # 最小改动底线：改写后的 action 与原文至少要共享这么长的连续片段


def _is_negated(text: str, start: int, window: int = 6) -> bool:
    """命中点前 window 个字里是否以否定词结尾（"（不用交给…" 里的 "交给" 不算违规）。"""
    return bool(_NEGATION_TAIL.search(text[max(0, start - window):start]))


def _has_short_cap(text: str, start: int, end: int) -> bool:
    """命中点附近是否给了明确的短上限（给了就不算"长文本违规"）。

    例：``写下 3 个你听到的关键词（每个词不超过 10 个字）`` -> 合规。
         ``三句话以内即可`` -> 合规（用户自己把边界收得很小）。
         ``写 3 句话总结（每句不超过 100 字）`` -> 仍然违规（上限是 100）。
    """
    window = text[max(0, start - 8):end + 20]
    for match in _CAP_PATTERN.finditer(window):
        if match.group(3) is not None:
            return True  # 小自限枚举："三句话以内" / "3 条以内"
        raw = match.group(1) or match.group(2)
        if raw is not None and int(raw) <= MAX_TEXT_CAP:
            return True
    return False


@dataclass(frozen=True)
class Hit:
    """一次命中：规则 + 字段 + 命中的词 + 上下文（报告里打印，用来解释"凭什么判定违规"）。"""

    rule_id: str
    label: str
    severity: str
    field_name: str
    matched: str
    context: str


def _snippet(text: str, start: int, end: int, pad: int = 12) -> str:
    head = "…" if start > pad else ""
    tail = "…" if end + pad < len(text) else ""
    return f"{head}{text[max(0, start - pad):end + pad]}{tail}"


def detect_field(field_name: str, text: Optional[str]) -> List[Hit]:
    """按规则表扫一个字段，返回全部命中（同一规则同一字段去重，报告更干净）。"""
    if not text:
        return []
    hits: List[Hit] = []
    seen: set[Tuple[str, str]] = set()
    for rule in DETECT_RULES:
        for match in rule.pattern.finditer(text):
            if rule.negation_safe and _is_negated(text, match.start()):
                continue
            if rule.cap_exempt and _has_short_cap(text, match.start(), match.end()):
                continue
            key = (rule.rule_id, match.group(0))
            if key in seen:
                continue
            seen.add(key)
            hits.append(
                Hit(
                    rule_id=rule.rule_id,
                    label=rule.label,
                    severity=rule.severity,
                    field_name=field_name,
                    matched=match.group(0),
                    context=_snippet(text, match.start(), match.end()),
                )
            )
    return hits


def _detect_step(title: str, action: Optional[str], resource: Optional[str]) -> List[Hit]:
    """扫一个步骤（三个字段），并按**步骤级**上限再筛一道。

    步骤级规则：**action 已经给了明确短上限时，标题里只属于"写/列出 N 个"的 R3 命中不算违规**。
    理由：用户真正要填的是打卡区（action 决定要不要写字、写多少字），标题只是标签。
    例：标题"列出你感兴趣的 3 个方向" + action"每个方向写一句话说明为什么（合计不超过 30 字）"
    -> 这就是合规的一步，不必为了标题去 churn。
    """
    step_cap = _has_short_cap(action or "", 0, len(action or ""))
    raw = (
        detect_field("title", title)
        + detect_field("action", action)
        + detect_field("resource", resource)
    )
    hits: List[Hit] = []
    seen: set[Tuple[str, str, str]] = set()
    for hit in raw:
        if hit.field_name == "title" and hit.rule_id == "R3-写小作文" and step_cap:
            continue
        key = (hit.rule_id, hit.field_name, hit.matched)
        if key in seen:
            continue
        seen.add(key)
        hits.append(hit)
    return hits


def _has_violation(field_name: str, text: Optional[str]) -> bool:
    """只看**违规级**命中（suspect 只是"提到了视频/图片"，不代表这段文字要改）。"""
    return any(h.severity == SEVERITY_VIOLATION for h in detect_field(field_name, text))


# ---------------------------------------------------------------------------
# 二、最小改写：只动违规片段，别的字一个不动
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class RepairRule:
    """一条改写规则：把命中的**片段**换成合规写法（``replacement`` 支持 ``\\g<name>`` 反向引用）。

    ``guard_negation``：否定语境里的命中不改（"不用交给我们" 一个字都不动）。
    """

    note: str
    pattern: re.Pattern[str]
    replacement: str
    guard_negation: bool = True


@dataclass(frozen=True)
class Edit:
    """一处最小改写：规则说明 + 被替换的原文片段 + 新片段（报告里逐条打印）。"""

    note: str
    old: str
    new: str


# --- action 的改写规则（顺序即优先级；只替换命中片段，其余原文保留）---------------
ACTION_REPAIRS: Tuple[RepairRule, ...] = (
    # ---- 规则4：提交/上传类 -> 只删"交给别人"的要求，动作本体保留 ----
    RepairRule(
        note="删除提交要求（改成自己留着）",
        pattern=re.compile(r"(?:写完|做完)?\s*发给我看。?|发给我看|发给我|交给我|上传到打卡区|上传"),
        replacement="（自己留着就行，不用发给我们）",
    ),
    RepairRule(
        note="删除提交物要求（改成自己保存）",
        pattern=re.compile(r"截图上传|截屏|截图|拍照|照相|附件|扫描件|提交文件|传上来|交付"),
        replacement="自己保存留作纪念",
    ),
    # ---- 规则4：录屏/录音类 -> 保留"自己讲一遍"这个真实动作，去掉录 ----
    RepairRule(
        note="去掉录屏（改成自己完整讲一遍）",
        pattern=re.compile(r"打开录屏[，,]?"),
        replacement="自己完整讲一遍（不用录），",
    ),
    RepairRule(
        note="去掉录制音视频要求（改成自己讲一遍）",
        pattern=re.compile(
            r"录\s*(?:\d+|[一二三四五六七八九十]+)\s*分钟(?:的)?(?:演示)?视频"
            r"|录像|录一段|录个|录一次|录下来|录制|录音"
        ),
        replacement="自己完整讲一遍（不用录）",
    ),
    RepairRule(
        note="去掉「视频发给朋友看」（改成自己讲清楚）",
        pattern=re.compile(r"视频能发给朋友看懂|能发给朋友看懂"),
        replacement="自己不看稿也能讲清楚",
    ),
    # ---- 规则3：小作文类 -> 降到 ≤30 字文本，结构与条目保留 ----
    RepairRule(
        note="写 100 字总结 -> 一句话填空（≤20 字）",
        pattern=re.compile(r"写一段\s*\d+\s*字(?:左右)?的?[^。]*。"),
        replacement="填空（不超过 20 字）：我最想先试的方向是____。",
    ),
    RepairRule(
        note="「写：做了什么/困难/怎么解决」-> 3 个短空（结构保留）",
        pattern=re.compile(r"写\s*[:：]\s*我做了什么[^。]*。"),
        replacement="填空（3 个空，每空不超过 10 字）：做了什么____；最难的是____；怎么解决的____。",
    ),
    RepairRule(
        note="删掉并列的「写功能清单」（保留画草图）",
        pattern=re.compile(r"[，,]\s*或列出\s*(?:\d+|[一二三四五六七八九十两]{1,3})\s*个[^。；，]*"),
        replacement="",
    ),
    RepairRule(
        note="写 3 个以上的清单 -> 2-3 个 + 每项 ≤10 字",
        pattern=re.compile(r"写(?:下|出)\s*(?:\d{2,}|[4-9])\s*个"),
        replacement="写下 2-3 个（每个不超过 10 字）",
    ),
    RepairRule(
        note="「写满 N 个算完成」-> 「写完就算完成」",
        pattern=re.compile(r"写满\s*(?:\d+|[一二三四五六七八九十两]{1,3})\s*个\s*算完成"),
        replacement="写完就算完成",
    ),
    RepairRule(
        note="「写 N 个方向 + 每个方向写一句」-> 2-3 个短空",
        pattern=re.compile(
            r"写(?:下|出)\s*(?:\d+|[一二三四五六七八九十两]{1,3})\s*个(?P<noun>[^，。；]{0,12})，每个方向写一句[^。]*。"
        ),
        replacement="写下 2-3 个\\g<noun>（每个不超过 10 字）。",
    ),
    RepairRule(
        note="「N 个方向都写出来 + 每个一句」-> 合计 ≤30 字",
        pattern=re.compile(r"完成标准：[^。]*好奇点[^。]*。"),
        replacement="完成标准：合计不超过 30 字就算完成。",
    ),
    RepairRule(
        note="「每方向写一句话说明为什么」-> 补一个合计上限",
        pattern=re.compile(r"每(?:个)?方向写一句话说明为什么"),
        replacement="每个方向写一句话说明为什么（合计不超过 30 字）",
    ),
    RepairRule(
        note="「用自己的话写出…」-> 补一个 ≤20 字上限",
        pattern=re.compile(r"用自己的话写(?:出)?(?P<rest>[^。]*)"),
        replacement="用自己的话说清\\g<rest>（不超过 20 字）",
    ),
    RepairRule(
        note="「写满 3 条 + 一句结论」-> 改成点选结论",
        pattern=re.compile(
            r"写满\s*(?:\d+|[一二三四五六七八九十两]+)\s*条，?\s*并给出一句结论：\s*继续试\s*/\s*换一个方向。?"
        ),
        replacement="点选 1 个结论：A 继续试；B 换一个方向。",
    ),
    RepairRule(
        note="「回答三个问题」-> 默答（不用写下来）",
        pattern=re.compile(r"回答三个问题"),
        replacement="自己默答三个问题（不用写下来）",
    ),
)

# --- title 的改写规则：只改标题**自己**就违规、或与改写后 action 对不上的标题 ----
TITLE_REPAIRS: Tuple[RepairRule, ...] = (
    RepairRule(
        note="「录 N 分钟演示视频」-> 自己讲一遍（不用录）",
        pattern=re.compile(r"录\s*(?:\d+|[一二三四五六七八九十]+)\s*分钟(?:的)?(?:演示)?视频"),
        replacement="自己完整讲一遍（不用录）",
    ),
    RepairRule(
        note="「画出草图或写清功能清单」-> 只留保下来的动作（画图）",
        # 这条不是"字数违规"，而是**title 提供了一个 action 里已经不存在的选项**：
        # 规则3 把并列的"列出 3 个必须有的功能"删掉后，标题还写着"或写清功能清单"。
        pattern=re.compile(r"画(?:出)?草图或写清?功能清单"),
        replacement="画出界面草图",
    ),
    RepairRule(
        note="「写一段 N 字兴趣总结」-> 用一句话写下最想先试的方向",
        # 与 action 的产物对齐：改写后的 action 只要求填"我最想先试的方向是____"，
        # 标题再写"兴趣总结"就比 action 承诺得更多（这是上一版留下的轻微不一致）。
        pattern=re.compile(r"写一段\s*\d+\s*字(?:左右)?的?(?:兴趣)?总结"),
        replacement="用一句话写下最想先试的方向",
    ),
    RepairRule(
        note="「写 N 句话总结」-> 写总结（N 个短空）",
        pattern=re.compile(r"写\s*(\d+)\s*句话(?P<what>项目)?总结"),
        replacement="写\\g<what>总结（\\g<1> 个短空）",
    ),
    RepairRule(
        note="「写下 N 条真实感受并判断」-> 回答 3 个问题后点选判断",
        pattern=re.compile(r"写(?:下|出)\s*\d+\s*条真实感受并判断"),
        replacement="回答 3 个问题后点选判断",
    ),
    RepairRule(
        note="「列出 N 个你听过的技术方向」-> 写下最想先了解的 2-3 个",
        pattern=re.compile(r"列出\s*(?:\d+|[一二三四五六七八九十两]+)\s*个你听过的"),
        replacement="写下你最想先了解的 2-3 个",
    ),
    RepairRule(
        note="「列出 N 个好奇的技术方向」-> 写下最好奇的 2-3 个",
        pattern=re.compile(r"列出\s*(?:\d+|[一二三四五六七八九十两]+)\s*个好奇的"),
        replacement="写下最好奇的 2-3 个",
    ),
)

# 兜底：改完 action 仍命中 R3（且全文没有任何上限）时，在 action 末尾补一个明确上限。
# 这是"最小改动"的最后一道保险：宁可加一句上限，也不去重写用户的动作。
GENERIC_CAP_TAIL = "（挑重点写，打卡文字控制在 30 字以内）"

# title↔action 一致性：title 里的动作词，改写后的 action 必须还有对应动作
#（至少一组对得上即可；"画出草图或写清功能清单" 只保住"画草图"也算过，
#  但那条标题仍然提供了 action 里不存在的"写功能清单"选项 -> 由上面 TITLE_REPAIRS 一并收短）
VERB_GROUPS: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    ("画", ("画", "草图", "界面图", "图")),
    ("写", ("写", "填", "记", "列")),
    ("做", ("做", "完成", "实现", "敲", "跑", "运行", "练")),
    ("讲", ("讲", "说", "复述", "演示", "介绍")),
    ("看", ("看", "读", "搜")),
    ("运行", ("运行", "跑", "执行", "编译")),
    ("聊", ("聊", "问", "联系")),
    ("选", ("选", "勾选", "点选", "挑")),
    ("列", ("列", "写", "填")),
    ("录", ("录", "讲", "说")),
)

_OPTION_LETTER = re.compile(r"(?<![A-Za-z])([A-D])(?=[\s、.．:：])")
_POINTABLE = re.compile(r"勾选|点选|选择")


def _option_letters(text: str) -> List[str]:
    return sorted({m.group(1) for m in _OPTION_LETTER.finditer(text)})


def _apply_repair(text: str, rule: RepairRule) -> Tuple[str, List[Edit]]:
    """按一条规则做**片段级**替换，返回 (新文本, 改动清单)。否定语境里的命中跳过。"""
    pieces: List[str] = []
    edits: List[Edit] = []
    last = 0
    for match in rule.pattern.finditer(text):
        if rule.guard_negation and _is_negated(text, match.start()):
            continue
        new_piece = match.expand(rule.replacement)
        pieces.append(text[last:match.start()])
        pieces.append(new_piece)
        last = match.end()
        edits.append(Edit(note=rule.note, old=match.group(0), new=new_piece))
    if not edits:
        return text, []
    pieces.append(text[last:])
    return "".join(pieces), edits


def _tidy(text: str) -> str:
    """删片段后可能留下 "，。" "。。" 这类残渣，清一下（不动有意义的标点）。"""
    text = re.sub(r"[，,]\s*。", "。", text)
    text = re.sub(r"。{2,}", "。", text)
    text = re.sub(r"[，,]{2,}", "，", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _lcs_len(a: str, b: str) -> int:
    """最长公共子串长度（"最小改动"证据：整段替换会让这个值趋近于 0）。"""
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    best = 0
    for i in range(1, len(a) + 1):
        cur = [0] * (len(b) + 1)
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                cur[j] = prev[j - 1] + 1
                best = max(best, cur[j])
        prev = cur
    return best


@dataclass
class RepairResult:
    new_title: str
    new_action: str
    new_resource: str
    edits: List[Edit]
    problems: List[str]


def _title_action_problems(title: str, action: str) -> List[str]:
    """title 里的动作词，改写后的 action 必须仍有对应动作（至少一组对得上）。"""
    triggered = [name for name, _ in VERB_GROUPS if name in title]
    if not triggered:
        return []
    group_tokens = dict(VERB_GROUPS)
    matched = [
        name
        for name in triggered
        if name in action or any(token in action for token in group_tokens[name])
    ]
    if matched:
        return []
    return [
        f"标题要求「{'/'.join(triggered)}」，改写后的 action 里没有任何对应动作描述"
        f"（疑似把真实动作删掉了）"
    ]


def _validate_repair(
    old_action: str, new_title: str, new_action: str, new_resource: str
) -> List[str]:
    """改写自校验（不静默通过）：仍违规 / title-action 不一致 / 改动过大 / 动作为空。"""
    problems: List[str] = []
    bad = [
        h
        for h in _detect_step(new_title, new_action, new_resource)
        if h.severity == SEVERITY_VIOLATION
    ]
    if bad:
        problems.append("改写后仍命中规则：" + "、".join(sorted({h.rule_id for h in bad})))
    problems += _title_action_problems(new_title, new_action)

    letters = _option_letters(new_action)
    if letters:
        if letters != list("ABCD"[: len(letters)]) or not 2 <= len(letters) <= 4:
            problems.append(f"可点选选项不是 2-4 个连续项（实际 {letters}）")
        if not _POINTABLE.search(new_action):
            problems.append("有选项但没有'点选/勾选'字样")

    if not new_action.strip():
        problems.append("改写后 action 为空")
    elif old_action.strip():
        keep = _lcs_len(old_action, new_action)
        if keep < MIN_KEEP_LCS:
            problems.append(
                f"改写把原动作删得太多（与原文最长共同片段只有 {keep} 字 < {MIN_KEEP_LCS}），疑似整体替换"
            )
    return problems


def repair_step(title: str, action: Optional[str], resource: Optional[str]) -> RepairResult:
    """最小改写一个步骤：只替换违规片段，其余文字原样保留。"""
    old_action = action or ""
    old_resource = resource or ""
    edits: List[Edit] = []

    new_action = old_action
    for rule in ACTION_REPAIRS:
        new_action, applied = _apply_repair(new_action, rule)
        edits += applied

    new_title = title
    for rule in TITLE_REPAIRS:
        new_title, applied = _apply_repair(new_title, rule)
        edits += applied

    # 规则 4：资源里出现提交/录制类要求 -> 直接清成 "无"（留违规词会破坏幂等）
    new_resource = "无" if _has_violation("resource", old_resource) else old_resource

    # 兜底：改完还有 R3 违规、且全文没有任何短上限 -> 在 action 末尾补一个上限
    remaining = [
        h
        for h in _detect_step(new_title, new_action, new_resource)
        if h.severity == SEVERITY_VIOLATION
    ]
    if any(h.rule_id == "R3-写小作文" for h in remaining) and not _has_short_cap(
        new_action, 0, len(new_action)
    ):
        new_action = f"{new_action.rstrip()}{GENERIC_CAP_TAIL}"
        edits.append(Edit(note="补一个 30 字上限（不改动作本体）", old="", new=GENERIC_CAP_TAIL))

    new_action = _tidy(new_action)
    new_title = _tidy(new_title)
    problems = _validate_repair(old_action, new_title, new_action, new_resource)
    if not edits:
        problems.append("没有任何片段被改写（规则没匹配上，需要人工看）")
    return RepairResult(
        new_title=new_title,
        new_action=new_action,
        new_resource=new_resource,
        edits=edits,
        problems=problems,
    )


# ---------------------------------------------------------------------------
# 三、计划（dry-run 的数据结构）
# ---------------------------------------------------------------------------
@dataclass
class StepView:
    """一个步骤 + 它所属任务/用户（只读视图，便于报告里定位）。"""

    step: TaskStep
    task_title: str
    task_status: str
    username: str
    user_id: UUID

    @property
    def has_checkin(self) -> bool:
        """是否已经有打卡痕迹（打卡记录就是这一行的 completed/feedback/completed_at）。"""
        return bool(self.step.completed or self.step.feedback or self.step.completed_at)

    @property
    def location(self) -> str:
        return (
            f"user={self.username} task=「{self.task_title}」[{self.task_status}] "
            f"step#{self.step.step_order} id={self.step.id}"
        )


@dataclass
class PlannedChange:
    view: StepView
    hits: List[Hit]
    old_title: str
    old_action: str
    old_resource: str
    new_title: str
    new_action: str
    new_resource: str
    edits: List[Edit]
    problems: List[str] = field(default_factory=list)

    @property
    def changed_fields(self) -> Dict[str, str]:
        values: Dict[str, str] = {}
        if self.new_title != self.old_title:
            values["title"] = self.new_title
        if self.new_action != self.old_action:
            values["action"] = self.new_action
        if (self.new_resource or "") != (self.old_resource or ""):
            values["resource"] = self.new_resource
        return values


# ---------------------------------------------------------------------------
# 四、读库（只读）+ 扫出计划
# ---------------------------------------------------------------------------
def _load_users(db: Session, selector: Optional[str]) -> List[User]:
    """按 ``--user`` 取用户：收 UUID 或 username。

    ⚠️ ``users`` 表**没有 email 列**（登录标识是 ``username``，见 ``app/models/user.py``），
    所以这里把 email 当 username 处理（有用户直接拿邮箱注册就是 username）。

    UUID 两种写法都认：带连字符的（接口/本脚本打印的那种）和 SQLite 里裸存的 32 位十六进制
    （直接翻库复制出来的那种）。
    """
    if not selector:
        return list(db.exec(select(User).order_by(User.username)).all())  # type: ignore[union-attr]
    user_id: Optional[UUID] = None
    try:
        user_id = UUID(selector)
    except ValueError:
        raw = selector.strip().replace("-", "")
        if len(raw) == 32:
            try:
                user_id = UUID(hex=raw)
            except ValueError:
                user_id = None
    if user_id is not None:
        user = db.get(User, user_id)
        return [user] if user is not None else []
    statement = select(User).where(func.lower(User.username) == selector.lower())
    return list(db.exec(statement).all())


def _load_steps(db: Session, user_ids: Sequence[UUID]) -> Tuple[List[Task], List[StepView]]:
    """一次查出任务与步骤（50 行量级，单次查询 + 内存分组，避免 N+1）。"""
    if not user_ids:
        return [], []
    tasks = list(
        db.exec(
            select(Task)
            .where(Task.user_id.in_(user_ids))  # type: ignore[union-attr]
            .order_by(Task.created_at, Task.id)  # type: ignore[union-attr]
        ).all()
    )
    users = {
        u.id: u
        for u in db.exec(select(User).where(User.id.in_(user_ids))).all()  # type: ignore[union-attr]
    }
    task_by_id = {t.id: t for t in tasks}
    steps: List[StepView] = []
    if tasks:
        rows = db.exec(
            select(TaskStep)
            .where(TaskStep.task_id.in_(list(task_by_id)))  # type: ignore[union-attr]
            .order_by(TaskStep.task_id, TaskStep.step_order)  # type: ignore[union-attr]
        ).all()
        for step in rows:
            task = task_by_id[step.task_id]
            user = users.get(task.user_id)
            steps.append(
                StepView(
                    step=step,
                    task_title=task.title,
                    task_status=task.status,
                    username=user.username if user else str(task.user_id),
                    user_id=task.user_id,
                )
            )
    return tasks, steps


def _scan_step(view: StepView) -> Tuple[List[Hit], List[Hit]]:
    """扫一个步骤，返回 ``(violation 命中, suspect 命中)``。"""
    hits = _detect_step(view.step.title, view.step.action, view.step.resource)
    violations = [h for h in hits if h.severity == SEVERITY_VIOLATION]
    suspects = [h for h in hits if h.severity == SEVERITY_SUSPECT]
    return violations, suspects


def build_plan(
    steps: Sequence[StepView], include_checked_in: bool
) -> Tuple[List[PlannedChange], List[PlannedChange], List[StepView], Counter, Counter]:
    """扫出 ``(可自动最小改写, 需人工决定, 参考提示, 规则计数, 会被落库的改写动作计数)``。"""
    plan: List[PlannedChange] = []
    conflicts: List[PlannedChange] = []
    suspects: List[StepView] = []
    rule_counter: Counter = Counter()
    edit_counter: Counter = Counter()

    for view in steps:
        hits, suspect_hits = _scan_step(view)
        if not hits:
            # 已经合规：不动（这就是幂等的来源）
            if suspect_hits:
                suspects.append(view)
            continue
        for rule_id in sorted({h.rule_id for h in hits}):
            rule_counter[rule_id] += 1

        result = repair_step(view.step.title, view.step.action, view.step.resource)
        change = PlannedChange(
            view=view,
            hits=hits,
            old_title=view.step.title,
            old_action=view.step.action or "",
            old_resource=view.step.resource or "",
            new_title=result.new_title,
            new_action=result.new_action,
            new_resource=result.new_resource or "",
            edits=result.edits,
            problems=result.problems,
        )
        # 已有打卡 + 违规 -> 默认不拍板：打卡文字是按**老要求**写的，改写后新旧语义可能对不上。
        # 数据上其实是安全的（只改描述文字），所以这里只列出来，由用户决定要不要 --include-checked-in。
        if view.has_checkin and not include_checked_in:
            conflicts.append(change)
        elif change.problems:
            conflicts.append(change)
        else:
            plan.append(change)
            for edit in change.edits:
                edit_counter[edit.note] += 1
    return plan, conflicts, suspects, rule_counter, edit_counter


# ---------------------------------------------------------------------------
# 五、打印报告
# ---------------------------------------------------------------------------
def _print_hits(change: PlannedChange) -> None:
    for hit in change.hits:
        print(f"       命中依据 [{hit.rule_id}] {hit.label}")
        print(f"         {hit.field_name}:「{hit.matched}」 上下文：{hit.context}", flush=True)


def _print_change(index: int, change: PlannedChange) -> None:
    view = change.view
    print(f"  {index}) {view.location}")
    _print_hits(change)
    print(f"       最小改写（{len(change.edits)} 处；未列出的文字一律原样保留）：")
    for edit in change.edits:
        if edit.old:
            print(f"         · {edit.note}：「{edit.old}」-> 「{edit.new}」")
        else:
            print(f"         · {edit.note}：末尾追加「{edit.new}」")
    if change.old_title != change.new_title:
        print(f"       title   ：{change.old_title!r}")
        print(f"              -> {change.new_title!r}")
    if change.old_action != change.new_action:
        print(f"       action  ：{change.old_action!r}")
        print(f"              -> {change.new_action!r}")
    if (change.old_resource or "") != (change.new_resource or ""):
        print(f"       resource：{change.old_resource!r} -> {change.new_resource!r}")
    print(flush=True)


def _print_report(
    users: Sequence[User],
    tasks: Sequence[Task],
    steps: Sequence[StepView],
    plan: Sequence[PlannedChange],
    conflicts: Sequence[PlannedChange],
    suspects: Sequence[StepView],
    rule_counter: Counter,
    edit_counter: Counter,
    apply: bool,
    selector: Optional[str],
) -> None:
    mode = "APPLY（会写库）" if apply else "DRY-RUN（不写库）"
    soft_deleted = [u for u in users if u.deleted_at is not None]
    scope = f"单个用户（--user {selector}）" if selector else "全部用户"
    if soft_deleted:
        scope += f"，其中已软删除 {len(soft_deleted)} 个"
    print("=" * 78)
    print(f"老任务步骤清理 [{mode}]")
    print("=" * 78)
    print(f"数据库：{describe_database()}")
    print(f"范围  ：{scope}（{len(users)} 个用户）")
    print(f"扫描  ：{len(users)} 个用户 / {len(tasks)} 个任务 / {len(steps)} 个步骤", flush=True)

    print("\n" + "-" * 78)
    print(f"【一】命中：可自动最小改写（{len(plan)} 项）")
    print("-" * 78)
    if not plan:
        print("  （无）")
    for index, change in enumerate(plan, start=1):
        _print_change(index, change)

    print("\n" + "-" * 78)
    print(f"【二】需人工决定（{len(conflicts)} 项，默认**不改**）")
    print("-" * 78)
    if not conflicts:
        print("  （无）")
    for index, change in enumerate(conflicts, start=1):
        _print_change(index, change)
        if change.view.has_checkin:
            print("       为什么单列：这一步**已经有打卡记录**（completed/feedback/completed_at）——")
            print("         打卡文字是按**老要求**写的，改写步骤文字后新旧语义可能对不上，")
            print("         所以「这条历史打卡还算不算数」要你来定。")
            print("         数据上是安全的：脚本只改 title/action/resource，")
            print("         id / step_order / completed / feedback / completed_at / 任务状态都不动。")
            print(f"         打卡内容：{change.view.step.feedback!r}（{change.view.step.completed_at}）")
            print("         要一起改就加 --include-checked-in。")
        if change.problems:
            for problem in change.problems:
                print(f"       自校验未通过：{problem}")

    print("\n" + "-" * 78)
    print(f"【三】参考提示：提到 视频/图片/照片 但没有提交动作（{len(suspects)} 项，不改）")
    print("-" * 78)
    if not suspects:
        print("  （无）")
    for index, view in enumerate(suspects, start=1):
        hits = (
            detect_field("title", view.step.title)
            + detect_field("action", view.step.action)
            + detect_field("resource", view.step.resource)
        )
        words = "、".join(sorted({h.matched for h in hits if h.severity == SEVERITY_SUSPECT}))
        print(f"  {index}) {view.location}  命中词：{words}")
        print(f"       现在写的是：{view.step.action!r}")
        print("       判定：只提到 视频/图片/照片，没发现「提交/上传/录制」动作 -> 不改"
              "（这是宽松匹配的参考提示，要改请人工编辑）", flush=True)

    print("\n" + "-" * 78)
    print("【四】摘要")
    print("-" * 78)
    hit_steps = len(plan) + len(conflicts)
    print(f"  扫描：{len(tasks)} 个任务 / {len(steps)} 个步骤")
    print(
        f"  命中违规步骤：{hit_steps} 项"
        f"（其中可自动最小改写 {len(plan)} 项、需人工决定 {len(conflicts)} 项）"
    )
    print(f"  参考提示（视频/图片，不改）：{len(suspects)} 项")
    print("  按规则分类计数（同一规则命中同一步骤只算一次）：")
    if rule_counter:
        for rule_id, count in sorted(rule_counter.items()):
            label = next((r.label for r in DETECT_RULES if r.rule_id == rule_id), "")
            print(f"    {rule_id:<12} {count:>3} 项  {label}")
    else:
        print("    （无命中）")
    if edit_counter:
        print("  按改写动作计数（同一处改写算一次，仅统计会被 --apply 落库的那些）：")
        for note, count in sorted(edit_counter.items()):
            print(f"    {note:<40} {count:>3} 处")
    if not apply:
        print("\n  → DRY-RUN：**没有写入任何字节**。确认无误后加 --apply 落库。", flush=True)


# ---------------------------------------------------------------------------
# 六、落库（只有 --apply 才走到这里）
# ---------------------------------------------------------------------------
def apply_changes(db: Session, plan: Sequence[PlannedChange]) -> Tuple[int, Counter]:
    """只 UPDATE title/action/resource 三列。

    用显式 ``update()`` + ``values(只含这三个键)`` 而不是 ORM 属性赋值：
    从代码层面保证"绝不可能顺手改到 completed/feedback/step_order"。
    """
    rows = 0
    field_counter: Counter = Counter()
    for change in plan:
        values = change.changed_fields
        if not values:
            continue
        result = db.execute(
            sa_update(TaskStep).where(TaskStep.id == change.view.step.id).values(**values)
        )
        rows += result.rowcount or 0
        for name in values:
            field_counter[name] += 1
    db.commit()
    return rows, field_counter


def _rescan(
    db: Session, user_ids: Sequence[UUID], include_checked_in: bool
) -> Tuple[int, int, int]:
    """改完再扫一遍（幂等证据）：返回 ``(可自动改写, 需人工决定, 参考提示)``。"""
    _, steps = _load_steps(db, user_ids)
    plan, conflicts, suspects, _, _ = build_plan(steps, include_checked_in)
    return len(plan), len(conflicts), len(suspects)


# ---------------------------------------------------------------------------
# 七、CLI
# ---------------------------------------------------------------------------
def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python scripts/fix_legacy_task_steps.py",
        description="按新规则（打卡区只能点选 + ≤30 字）**最小改写**老任务步骤；默认 dry-run，不改库",
    )
    parser.add_argument("--apply", action="store_true", help="真正写库并 commit（默认只打印计划）")
    parser.add_argument(
        "--user",
        default=None,
        help="只处理某个用户，收 id(UUID，带连字符或裸 32 位十六进制) 或 username"
        "（users 表没有 email 列，邮箱按 username 匹配）",
    )
    parser.add_argument(
        "--include-checked-in",
        dest="include_checked_in",
        action="store_true",
        help="连「已有打卡记录」的违规步骤一起改写（默认这类只列成需人工决定，不动）",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    configure_logging()  # 复用项目的日志配置：顺手把 stdout 切成 UTF-8（Windows 控制台中文）
    args = _parse_args(argv)

    with SessionLocal() as db:
        users = _load_users(db, args.user)
        if not users:
            print(
                f"[错误] 找不到用户：{args.user!r}"
                "（--user 收 UUID 或 username；users 表没有 email 列，邮箱请按 username 传）"
            )
            return 2
        user_ids = [u.id for u in users]
        tasks, steps = _load_steps(db, user_ids)
        if not steps:
            print(f"没有任务步骤可扫（{len(users)} 个用户 / {len(tasks)} 个任务）")
            return 0

        plan, conflicts, suspects, rule_counter, edit_counter = build_plan(
            steps, args.include_checked_in
        )
        _print_report(
            users,
            tasks,
            steps,
            plan,
            conflicts,
            suspects,
            rule_counter,
            edit_counter,
            apply=args.apply,
            selector=args.user,
        )
        if not args.apply:
            return 0

        if not plan:
            print("\n--apply：没有可自动改写的步骤，未写库。")
            return 0

        print("\n" + "-" * 78)
        print("【五】落库")
        print("-" * 78)
        rows, field_counter = apply_changes(db, plan)
        fields = " / ".join(f"{name} {count} 个" for name, count in sorted(field_counter.items()))
        print(f"  已 UPDATE {rows} 行（{fields}）；已 commit。")
        print("  未改动：id / task_id / step_order / completed / feedback / completed_at / tasks.status")
        logger.info("fix_legacy_task_steps: UPDATE %s 行（%s）", rows, fields)

        again_plan, again_conflicts, again_suspects = _rescan(db, user_ids, args.include_checked_in)
        print(
            f"  复扫（幂等证据）：可自动改写 {again_plan} 项 / 需人工决定 {again_conflicts} 项 / "
            f"参考提示 {again_suspects} 项"
        )
        if again_plan:
            print("  ⚠️ 复扫仍有可自动改写项，请把上面输出发出来排查（正常情况下应为 0）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
