"""简历业务逻辑（"模板 -> 用户填 -> AI 只润色"，手册 11.8）。

- 入口：``GET /api/v1/resume/template``（模板）、``POST /api/v1/resume/polish``（润色）、
  ``GET|PUT /api/v1/resume/mine``（唯一一份简历的读写）；
- **"简历需要填什么"的唯一来源**是 :mod:`app.services.resume_template`：
  模板问什么，用户就填什么，AI **只改写用户已经写下的内容**；
- 素材是用户此刻填的表单内容。老的「上传 PDF -> 解析 -> ATS 评分 -> 报告 -> 文件下载」
  整条链路已**整体移除**（2026-11，见 README §4.10），"从对话生成"那条路更早已清掉；
- 画像回流钩子：``polish_resume`` / ``save_my_resume`` 都会调用
  ``profile_service.update_resume_score``（画像「简历完整度」靠它回流）；
- 红线落地成两条**服务端机械校验**（见 :func:`_merge_polished`）：
  ① 润色结果里的数字必须是用户原文数字的子集（:mod:`app.utils.fact_guard`）；
  ② 用户没填的字段不许被填。命中任一条就**把那个字段回退成用户原文**（不整份丢弃），
  并 ``logger.warning`` 留痕；
- 唯一一份：润色/保存时已有简历就更新那一条，不做多份管理（PUT /mine 也是同一份）。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.ai import deepseek_client
from app.ai.fallbacks import STRUCTURED_TEMPERATURE
from app.ai.schemas import ResumePolishResult, empty_resume_polish
from app.models.resume import Resume
from app.models.user import User, utcnow
from app.schemas.resume import ResumeResponse
from app.services import profile_service, resume_template
from app.utils import fact_guard
from app.utils.logger import get_logger, sanitize
from app.utils.text import truncate

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# 「模板 -> 用户填 -> AI 只润色」这条路（GET /resume/template、POST /resume/polish、
# GET|PUT /resume/mine）
# ---------------------------------------------------------------------------
#
# 设计要点（改之前先读一遍）：
# 1. **模板是唯一来源**：字段清单/问法/必填标记全在 ``resume_template``，
#    这里只做"按模板遍历"，不硬编码任何字段名；
# 2. **AI 只润色**：素材就是用户此刻填的表单内容，没有任何别的输入；
# 3. **两道机械闸**在 :func:`_merge_polished` 里（数字子集 + 空字段不许被填），
#    命中就**字段级**回退成用户原文并 warning，绝不整份丢弃；
# 4. **永远有一份可用简历**：AI 失败/坏 JSON 一律退回用户原文（7.6），不 500。

RESUME_POLISH_PROMPT = "resume_polish"

# 单个文本字段的入库长度上限（防 AI 或用户塞超长文本把 JSON 列撑爆）
MAX_FIELD_CHARS = 2000

# 数组类字段（亮点/技能）最多保留多少条
MAX_LIST_ITEMS = 20

# 经历类 section 最多保留多少条
MAX_EXPERIENCE_ITEMS = 20

# 信封 message 里最多列几项"你没填"
MAX_EMPTY_LABELS_IN_MESSAGE = 5

# 干净单行值的原始长度上限（超过就只写入日志，不写库）
MAX_ECHO_IN_DB = 500
MAX_ECHO_IN_LOG = 200

# 完整度权重（各 section 合计 100；见 :func:`calculate_completeness` 的说明）
COMPLETENESS_WEIGHTS: Dict[str, float] = {
    resume_template.SECTION_BASIC: 25.0,
    resume_template.SECTION_TARGET: 10.0,
    resume_template.SECTION_EDUCATION: 20.0,
    resume_template.SECTION_SKILLS: 10.0,
    resume_template.SECTION_PROJECTS: 20.0,
    resume_template.SECTION_CAMPUS: 10.0,
    resume_template.SECTION_SELF_EVALUATION: 5.0,
}


def get_resume_template() -> Dict[str, Any]:
    """GET /resume/template：返回学生简历模板（**纯静态配置，不查库、不调 AI**）。

    鉴权仍由路由层的 ``Depends(get_current_user)`` 负责（契约要求"需登录"）。
    """
    return {"sections": resume_template.template_sections()}


# ---------- 完整度 ----------

def calculate_completeness(parsed_data: Optional[Dict[str, Any]]) -> float:
    """按模板加权算完整度 0-100（写进 ``resumes.completeness`` -> 画像 ``resume_score``）。

    算法（**披露给验收**，改动要同步这里的 docstring）：

    每个 section 一个权重（合计 100，见 ``COMPLETENESS_WEIGHTS``），
    section 得分 = ``权重 × 该节已填字段数 / 该节字段数``：

    - 普通字段（文本）**非空**即算已填；可多值字段（``highlights``/``items``）
      非空数组即算已填；
    - **可重复 section**（``education``/``projects``/``campus``）按**多条取平均**：
      例如 ``projects`` 有 3 条，节内得分 = 3 条各自"已填字段比例"的均值 ——
      这样"填了很多条但每条都很空"不会虚高；
    - 可重复 section **一条都没有**时为 0 分（不参与平均）。

    为什么不用 AI 打分：这是"用户填了多少"的**机械统计**，必须是确定的、可复现的、
    且与 AI 是否可用无关（AI 挂了用户也应该看到进度条前进）。
    """
    data = parsed_data or {}
    total = 0.0
    for key, weight in COMPLETENESS_WEIGHTS.items():
        total += weight * _section_fill_ratio(key, data.get(key))
    return round(min(100.0, max(0.0, total)), 1)


def _section_fill_ratio(section_key: str, value: Any) -> float:
    """单个 section 的"填了多少"比例（0-1）。"""
    fields = resume_template.section_map().get(section_key, {}).get("fields", [])
    if not fields:
        return 0.0
    if section_key in (resume_template.SECTION_EDUCATION,
                       resume_template.SECTION_PROJECTS,
                       resume_template.SECTION_CAMPUS):
        items = value if isinstance(value, list) else []
        if not items:
            return 0.0
        ratios = [_item_fill_ratio(fields, item) for item in items if isinstance(item, dict)]
        return sum(ratios) / len(ratios) if ratios else 0.0
    if section_key == resume_template.SECTION_SKILLS:
        return 1.0 if _has_content(value) else 0.0
    if section_key == resume_template.SECTION_SELF_EVALUATION:
        return 1.0 if _has_content(value) else 0.0
    return _item_fill_ratio(fields, value if isinstance(value, dict) else {})


def _item_fill_ratio(fields: Sequence[Dict[str, Any]], item: Dict[str, Any]) -> float:
    """一条记录里"已填字段数 / 字段总数"。"""
    if not fields:
        return 0.0
    filled = 0
    for field in fields:
        value = resume_template.get_nested(item, field["key"])
        if _has_content(value):
            filled += 1
    return filled / len(fields)


def _has_content(value: Any) -> bool:
    """用户是否"填了"这个字段（空串/空数组/全空对象都算没填）。"""
    return not fact_guard.is_blank(value)


# ---------- 空字段清单（信封 message 用） ----------

def _empty_field_labels(parsed_data: Optional[Dict[str, Any]],
                        limit: int = MAX_EMPTY_LABELS_IN_MESSAGE,
                        skip_untouched_sections: bool = False) -> Tuple[int, List[str]]:
    """列出"用户没填"的字段 -> ``(条数, 前 N 条中文说明)``。

    说明形如 ``教育背景的时间`` / ``项目的结果`` / ``求职意向的城市``（中文人话，
    直接进信封 message 给用户看）。

    - 可重复 section：这一节**所有条**的这个字段都空，才算"没填"
      （用户填了 2 条项目、其中 1 条没写结果，就提示"项目的结果"—— 提示的是
      "这个字段你还空着"，而不是替他补）；
    - **整条全空的条目直接丢掉**：它不代表用户写了什么（前端给每个可重复板块默认摆一条
      空条目当入口，见 ``writeEmptyEntry``）；
    - 必填字段只留字段名（"姓名"），选填字段带上节名（"教育背景的时间"）——
      避免"时间"这种词在多个 section 里重名而说不清是哪个。
    - ``skip_untouched_sections=True``（"已润色"那条 message 用）：**用户一次都没碰过的
      可重复板块整节都不提**。不开的话，所有不打算写校园经历的人都会被告知
      「还有 7 项你没填（校园与实践经历的名称、你的角色、起止时间…）」—— 那不是"没填"，
      是"没打算填"。**全空短路那条路径不要开**：那时用户什么都没填，就该把要填的都列出来。
    """
    data = parsed_data or {}
    labels: List[str] = []
    for section in resume_template.template_sections():
        key = section["key"]
        section_label = section["label"]
        value = data.get(key)
        repeatable = bool(section["repeatable"])
        items: List[Any] = []
        if repeatable:
            # 只留"真的有内容"的条目；全空条目一律不算用户写过的东西
            items = [
                item
                for item in (value if isinstance(value, list) else [])
                if isinstance(item, dict) and _has_content(item)
            ]
            if not items and skip_untouched_sections:
                # 整节一条真内容都没有 = 用户没碰过这一节
                continue
        for field in section["fields"]:
            field_label = field["label"]
            if key in resume_template.SCALAR_SECTIONS:
                missing = not _has_content(value)
            elif repeatable:
                missing = not items or all(
                    not _has_content(resume_template.get_nested(item, field["key"])) for item in items
                )
            else:
                missing = not _has_content(resume_template.get_nested(value or {}, field["key"]))
            if missing:
                # 只带字段名；字段名与节名相同时（技能/自我评价）不加"的xx"，
                # 避免出现"技能的技能""自我评价的自我评价"这种复读。
                if field.get("required") or field_label == section_label:
                    labels.append(field_label)
                else:
                    labels.append(f"{section_label}的{field_label}")
    return len(labels), labels[:limit]


# ---------- 润色 ----------

def _stub_polish_payload() -> Optional[Dict[str, Any]]:
    """测试桩：``RESUME_POLISH_STUB`` 指向一个 JSON 文件时，用它冒充模型返回。

    存在的唯一理由是**验证"反杜撰"这条护栏**：要证明"模型编了数字会被回退"，
    就必须能造出一个"故意编数字"的模型返回。真实模型不会稳定地违规，
    所以留一个只认环境变量的显式桩（默认关闭，生产路径完全不受影响）。

    ⚠️ 这不是业务功能，是**测试逃生口**：文件读不到/不是 JSON 就当作没有桩。
    """
    path = (os.environ.get("RESUME_POLISH_STUB") or "").strip()
    if not path:
        return None
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:  # noqa: BLE001 - 桩坏了就当没配
        logger.error("RESUME_POLISH_STUB 读取失败，按未配置处理 path=%s err=%s", path, sanitize(exc))
        return None
    if not isinstance(payload, dict):
        logger.error("RESUME_POLISH_STUB 内容不是 JSON 对象，按未配置处理 path=%s", path)
        return None
    logger.warning("⚠️ 使用润色测试桩（RESUME_POLISH_STUB=%s）：返回的是固定内容，不是模型输出", path)
    return payload


def _save_stub_polished(user_id, original: Dict[str, Any], merged: Dict[str, Any],
                        fallbacks: Sequence[str]) -> None:
    """桩模式专用：把"模型返回 / 回退后写库"的对照落到日志同级目录，便于贴证据。

    只在 ``RESUME_POLISH_STUB`` 生效时写（正常润色一个字都不落盘）。
    """
    path = (os.environ.get("RESUME_POLISH_STUB_REPORT") or "").strip()
    if not path:
        return
    try:
        Path(path).write_text(
            json.dumps(
                {"original": original, "ai_returned_merged": merged, "fallbacks": list(fallbacks)},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    except OSError as exc:  # noqa: BLE001 - 落盘失败不影响主流程
        logger.warning("写润色桩报告失败 path=%s err=%s", path, sanitize(exc))


async def polish_resume(
    db: Session,
    user: User,
    parsed_data: Dict[str, Any],
    target_job: Optional[str] = None,
) -> Tuple[ResumeResponse, str]:
    """POST /resume/polish：把用户当前填的内容交给 AI **只做润色**，写进唯一一份简历。

    返回值是 ``(简历, 信封 message)``；message 里说清"有没有字段因为没填被留空"。

    执行顺序（每一步的失败都不会变成 500）：

    1. 归一化用户输入（按模板补齐骨架、裁长度）；
    2. **全空短路**：一个字都没填就直接返回一份全空简历，不调 AI、不编内容；
    3. 调 ``resume_polish`` Prompt（失败 -> 退回用户原文）；
    4. :func:`_merge_polished` 逐字段合并（数字子集 + 空字段两道机械闸）；
    5. 落库（没有就新建，有就更新那一条）+ 回流画像 ``resume_score``。
    """
    original = _normalize_parsed_data(parsed_data)

    if not _has_any_content(original):
        # 空态：没什么可润色的。不调 AI（省一次调用，也彻底杜绝"AI 帮他想"）。
        logger.info("润色请求的内容全空，跳过 AI user_id=%s", user.id)
        resume = _save_resume(db, user, original, original, target_job)
        total_missing, labels = _empty_field_labels(original)
        shown = "、".join(labels)
        if total_missing > len(labels):
            shown = f"{shown}等 {total_missing} 项"
        message = f"你还没填任何内容，先给你留了一份空简历（要填的有：{shown}）"
        return ResumeResponse.model_validate(resume), message

    variables = {
        "target_job": (target_job or "").strip(),
        "parsed_data": json.dumps(original, ensure_ascii=False, indent=2),
    }

    # 注意：这个名字不能叫 fallbacks —— 下面 _merge_polished 会返回另一个 fallbacks
    # （护栏回退的字段清单）。两者混用会让这里的兜底说明被整个覆盖掉，
    # 于是"AI 挂了"在信封 message 里消失，用户看到 200 +「已润色」但内容没变。
    notes: List[str] = []
    polished = empty_resume_polish()
    stub_payload = _stub_polish_payload()
    if stub_payload is not None:
        try:
            polished = ResumePolishResult.model_validate(stub_payload)
        except Exception as exc:  # noqa: BLE001 - 桩数据坏了退回用户原文
            logger.error("润色桩数据结构不合法，退回用户原文 err=%s", sanitize(exc))
            polished = empty_resume_polish()
            notes.append("测试桩数据不合法")
    else:
        try:
            polished = await deepseek_client.chat_prompt_json(
                prompt_name=RESUME_POLISH_PROMPT,
                variables=variables,
                schema=ResumePolishResult,
                default=empty_resume_polish(),
                temperature=STRUCTURED_TEMPERATURE,
                max_tokens=4096,
            )
        except Exception as exc:  # noqa: BLE001 - 7.6 兜底：AI 挂了也要有简历
            logger.warning("简历润色失败，退回用户原文 user_id=%s err=%s", user.id, sanitize(exc))
            notes.append("AI 润色失败，已按你的原文保存")

    merged, fallbacks = _merge_polished(original, polished.model_dump(), user_id=user.id, target_job=target_job)

    if stub_payload is not None:
        _save_stub_polished(user.id, original, merged, fallbacks)

    resume = _save_resume(db, user, original, merged, target_job, fallbacks)

    total_missing, labels = _empty_field_labels(merged, skip_untouched_sections=True)
    message = _polish_message(total_missing, labels, fallbacks, notes)
    return ResumeResponse.model_validate(resume), message


def _polish_message(
    missing_count: int,
    labels: Sequence[str],
    fallbacks: Sequence[Tuple[str, str, Optional[str]]],
    notes: Sequence[str] = (),
) -> str:
    """拼信封 message：先说这次到底润没润成，再说"哪些没填被留空"，最后说回退/兜底。

    形如：``已润色；还有 16 项你没填，先空着（姓名、年级、求职意向的城市…）``

    ``notes`` 是"整件事没做成"的兜底说明（AI 挂了、桩数据坏了）。它出现时第一句必须改口成
    「这次没能润色…」—— 否则接口返回 200 +「已润色」，用户看到的却是和刚才一模一样的内容，
    只会以为按钮坏了。
    """
    notes = list(dict.fromkeys(notes))
    ai_failed = any("AI 润色失败" in note for note in notes)

    parts: List[str] = []
    parts.append("这次没能润色，下面还是你写的原文（一个字都没改）" if ai_failed else "已润色")
    if missing_count:
        shown = "、".join(labels)
        if missing_count > len(labels):
            shown = f"{shown}等 {missing_count} 项"
        parts.append(f"还有 {missing_count} 项你没填，先空着（{shown}）")
    else:
        # 不能说"模板里的字段你都填了"：整节没碰过的板块已经被 skip 掉了，
        # 而完整度那边它仍然是 0 分（不填校园经历封顶 90），两句话会自相矛盾。
        parts.append("你写到的字段都填全了")
    if fallbacks:
        reverted = "、".join(dict.fromkeys(label for label, _, _ in fallbacks))
        parts.append(f"有 {len(fallbacks)} 处润色越界（{reverted}），已按你写的原话保留")
    # 第一句已经说过 AI 失败，这里就不重复；其余兜底说明（如桩数据坏了）照原样带上
    parts.extend(note for note in notes if not (ai_failed and "AI 润色失败" in note))
    return "；".join(parts)


def _normalize_parsed_data(parsed_data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """把用户输入按模板归一化成"永远有全部键"的骨架（长度超限的裁掉）。

    刻意**不做事实性改动**：只补结构、只裁长度。用户写什么就是什么。
    """
    source = parsed_data if isinstance(parsed_data, dict) else {}
    data = resume_template.empty_parsed_data()

    for key in resume_template.SECTION_KEYS:
        raw = source.get(key)
        if key == resume_template.SECTION_SKILLS:
            data[key] = _normalize_scalar_list(raw)
        elif key == resume_template.SECTION_SELF_EVALUATION:
            data[key] = _normalize_text(raw)
        elif key in (resume_template.SECTION_EDUCATION,
                     resume_template.SECTION_PROJECTS,
                     resume_template.SECTION_CAMPUS):
            data[key] = _normalize_items(key, raw)
        else:
            section = resume_template.section_map()[key]
            for field in section["fields"]:
                value = resume_template.get_nested(raw if isinstance(raw, dict) else {}, field["key"])
                if field.get("multiple"):
                    resume_template.set_nested(data[key], field["key"], _normalize_scalar_list(value))
                else:
                    resume_template.set_nested(data[key], field["key"], _normalize_text(value))
    return data


def _normalize_items(section_key: str, raw: Any) -> List[Dict[str, Any]]:
    """归一化经历类 section 的多条记录（只保留"这一条里有内容"的那些）。"""
    if not isinstance(raw, list):
        return []
    items: List[Dict[str, Any]] = []
    for entry in raw[:MAX_EXPERIENCE_ITEMS]:
        if not isinstance(entry, dict):
            continue
        item = resume_template.empty_item(section_key)
        for field in resume_template.section_map()[section_key]["fields"]:
            value = resume_template.get_nested(entry, field["key"])
            if field.get("multiple"):
                resume_template.set_nested(item, field["key"], _normalize_scalar_list(value))
            else:
                resume_template.set_nested(item, field["key"], _normalize_text(value))
        if _has_content(item):
            items.append(item)
    return items


def _normalize_text(value: Any) -> str:
    """文本字段：``None``/非字符串 -> 空串，去首尾空白，超长截断。

    数字字段（AI 有时把 ``role`` 写成数字）转成字符串时**不去掉数字** ——
    用户自己的数字必须原样保留（它是后面"数字子集"校验的基准）。
    """
    if value is None or isinstance(value, (dict, list, tuple, set)):
        return ""
    if isinstance(value, bool):
        return ""
    return truncate(str(value), MAX_FIELD_CHARS, suffix="").strip()


def _normalize_scalar_list(value: Any) -> List[str]:
    """可多值字段（``skills`` / ``highlights``）：字符串数组，去空、去重、截断。"""
    if value is None:
        return []
    if isinstance(value, str):
        candidates: List[Any] = [part for part in value.replace("、", ",").replace("，", ",").split(",")]
    elif isinstance(value, (list, tuple, set)):
        candidates = list(value)
    else:
        candidates = [value]

    items: List[str] = []
    for candidate in candidates:
        text = _normalize_text(candidate)
        if text and text not in items:
            items.append(text)
        if len(items) >= MAX_LIST_ITEMS:
            break
    return items


def _coerce_skills(value: Any) -> List[str]:
    """把模型返回的 ``skills`` 归一回字符串数组（容忍 ``[{"name": "Vue"}]`` 这种写法）。"""
    if not isinstance(value, (list, tuple)):
        return _normalize_scalar_list(value)
    flat: List[Any] = []
    for item in value:
        if isinstance(item, dict):
            for key in ("name", "skill", "text", "label", "value"):
                if item.get(key):
                    flat.append(item[key])
                    break
        else:
            flat.append(item)
    return _normalize_scalar_list(flat)


def _has_any_content(parsed_data: Dict[str, Any]) -> bool:
    """这份表单里用户到底填了没有（有一个非空叶子就算填了）。"""
    return not fact_guard.is_blank(parsed_data)


# ---------- 两道机械闸：数字子集 + 空字段不许被填 ----------

def _short_section_label(section_key: str) -> str:
    """日志用的短节名（``projects`` -> ``项目经历``）。"""
    return resume_template.section_map().get(section_key, {}).get("label", section_key)


def _echo(value: Any) -> str:
    """把值压成日志用的短单行（换行会毁掉日志的可读性）。"""
    flat = " ".join(str(value or "").split())
    return flat[:MAX_ECHO_IN_LOG] + ("…" if len(flat) > MAX_ECHO_IN_LOG else "")


def _store_echo(value: Any) -> Optional[str]:
    """违规对照里"用户原文"的一侧：太长的就不写库（避免日志里的长文本再撑大 JSON 列）。"""
    flat = " ".join(str(value or "").split())
    if len(flat) > MAX_ECHO_IN_DB:
        return None
    return flat or None


def _normalize_lexical(text: Any) -> str:
    """词条归一化：去空白 + 小写（``" Vue "`` 与 ``"vue"`` 视为同一条）。"""
    return "".join(str(text or "").split()).lower()


# 技能条目里的"技术名"：以字母开头，允许数字与 ``+`` / ``#``（C++、C#、Vue3），
# 允许点号连接的写法（``Node.js`` / ``Vue.js`` / ``.NET`` 的 ``NET`` 部分）。
_SKILL_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+#]*(?:\.[A-Za-z0-9+#]+)*")

# 同一个技术名的常见写法（归一化后再比，避免"写法不一样"被误判成"换了技术"）
_SKILL_TOKEN_ALIASES = {
    "cpp": "c++",
    "csharp": "c#",
    "javascript": "js",
    "typescript": "ts",
    "python": "py",
    "nodejs": "node",
    "vuejs": "vue",
}


def _skill_tokens(text: Any) -> List[str]:
    """取一段技能文本里的"技术名"（归一化成小写、去空白）。"""
    return [_normalize_lexical(token) for token in _SKILL_TOKEN_RE.findall(str(text or ""))]


def _canonical_skill_token(token: str) -> str:
    """技术名归一化：去点号 / 版本号，别名收敛（``Node.js`` / ``NodeJS`` -> ``node``）。"""
    value = _normalize_lexical(token).replace(".", "")
    stripped = value.rstrip("0123456789")
    # 只在剩下的部分还是"一个词"时去掉版本号（java11 -> java、c++11 -> c++；h5 保留原样）
    if stripped != value and len(stripped) >= 2 and (stripped[-1].isalpha() or stripped[-1] in "+#"):
        value = stripped
    return _SKILL_TOKEN_ALIASES.get(value, value)


def _skill_token_covered(token: str, new_text: str) -> bool:
    """润色后的这一条里，是否还留着原来的这个技术名。

    三种认法（都只看字符串，不做技术名词判定）：
    1. 归一化后完全相同：``C++`` / ``cpp``、``Node.js`` / ``NodeJS``、``vue.js`` / ``Vue``；
    2. 互相包含（都至少 3 个字符才认）：``Vue`` / ``VueJS``、``Node`` / ``NodeJS``；
    3. 版本号不算换技术：``Java11`` -> ``Java``、``Vue3`` -> ``Vue``。

    ⚠️ 已知边界：``Java`` 会命中 ``JavaScript``（包含关系）。这条闸只负责"别把用户写的
    技术换掉/丢掉"，判断"这串英文是不是技术名"需要技术名词表，不做。
    """
    canon = _canonical_skill_token(token)
    if not canon:
        return False
    for raw in _skill_tokens(new_text):
        other = _canonical_skill_token(raw)
        if not other:
            continue
        if canon == other:
            return True
        if len(canon) >= 3 and len(other) >= 3 and (canon in other or other in canon):
            return True
    return False


def _shares_cjk_term(old_text: Any, new_text: Any, min_len: int = 2) -> bool:
    """两条纯中文表述是否至少共用一段 ``min_len`` 个连续汉字。

    技能条目里没有英文技术名时（"会做表格" / "擅长剪视频"），没法按技术名比对，
    就用"至少还有一个两字词是原来的"当底线：``"会做表格"`` -> ``"熟悉表格制作"``
    共享"表格"（通过）；``"会做表格"`` -> ``"熟悉沟通协作"`` 一个两字词都不共享
    （判违规，因为这已经不是同一项技能了）。
    """
    old_cjk = "".join(ch for ch in str(old_text or "") if "\u4e00" <= ch <= "\u9fff")
    new_cjk = "".join(ch for ch in str(new_text or "") if "\u4e00" <= ch <= "\u9fff")
    if not old_cjk or not new_cjk:
        return False
    if len(old_cjk) < min_len:
        return old_cjk in new_cjk
    return any(old_cjk[i:i + min_len] in new_cjk for i in range(len(old_cjk) - min_len + 1))


def _skill_item_kept(old_item: Any, new_item: Any) -> bool:
    """单条技能：原来的技术名/关键词必须还在（允许展开成能力表述）。"""
    new_text = str(new_item or "")
    if not _normalize_lexical(new_text):
        return False
    tokens = _skill_tokens(old_item)
    if tokens:
        return all(_skill_token_covered(token, new_text) for token in dict.fromkeys(tokens))
    return _shares_cjk_term(old_item, new_text)


def _skill_items_kept(old_list: Sequence[Any], new_list: Sequence[Any]) -> bool:
    """``skills`` 的机械闸：**条数与顺序都不许变，且每条必须仍然留着用户写的那几项技术**。

    为什么不是"整条逐字等价"：用户要的是把关键词**展开**成简历表述
    （``"Java"`` -> ``"熟悉 Java 基础语法、面向对象编程（封装、继承、多态）、集合框架…"``）。
    逐字等价会把正常润色判成违规、整段退回原文 —— 用户看到的就还是光秃秃一个"Java"。

    **为什么也不是"整条包含原文"**（这次修的 bug）：用户在前面已经润色好的那一句后面
    补了「会C++」，AI 把它改写成「熟悉 C++ 基础语法…」时，整条里已经没有「会c++」
    这串字了 —— 旧判法判违规、整段技能退回原文，用户看到的就是"补的那句没被润色、
    被直接忽略了"。现在改成**按技术名逐项验收**：只要 ``Java``、``C++`` 都还在，
    "会"被改写成"熟悉"、"C++"被展开成能力表述，都属于正常润色。

    这条仍然挡得住最危险的那几件事：
    - ``["Java"]`` -> ``["Python"]``：换掉了技术名（``java`` 不在新文本里）；
    - ``["Java", "Vue"]`` -> ``["熟悉 Java…"]``：少了条目（条数不等）；
    - ``["Java", "C++"]`` -> ``["熟悉 Java…"]``：丢了 C++（``c++`` 不在新文本里）。

    ⚠️ **已知边界（明确披露，别当成做到了）**：模型在条目里"**额外**"塞进用户没写过的技术名
    （``["Java"]`` -> ``["熟悉 Java 与 Python"]``）机械上拦不住 —— 判"这串英文是不是技术名"
    需要一份技术名词表，而"IO 流""面向对象"这类正当展开词与"Python"这类越界词在字符串层面
    无法区分。这一条由 Prompt 第二条规则 4 的"四不许"约束 + 人眼核对
    （原文留在 ``parsed_data["_original"]`` 里可逐字段对照）。
    """
    if len(old_list) != len(new_list):
        return False
    return all(_skill_item_kept(old_item, new_item) for old_item, new_item in zip(old_list, new_list))


def _field_guard_reason(original: Any, polished: Any, *, section_key: Optional[str] = None) -> str:
    """判断单个字段是否违反护栏，返回人话原因（合规返回空串）。

    规则**都要**检查（不是三选一）：

    1. 数组字段：不许增删条目、不许在条目里编数字；
       另外 ``skills`` 还要求"条目一一对应且留着原技术名"（允许展开成能力表述，
       见 :func:`_skill_items_kept`）；
    2. 数字子集：润色文本里的数字（阿拉伯数字 + 中文数词）必须都能在原文里找到；
    3. 空字段不许被填：原文为空而润色非空。

    ⚠️ 长文本字段（STAR 四个字段、``highlights`` 里的短句）**不**做逐词比对，
    只做"数字子集 + 空值"：润色的本质就是换词，逐词比会把正常润色全判违规
    （实测："专业课成绩还行" -> "专业课成绩良好" 会被误判）。
    所以长文本的护栏是"机械 + 人工"两层里的**第二层**：机械保证"数字没编、
    空字段没填、技能没换、条目没增删"，措辞里是否夹带了用户没说过的新事实
    （"做作业" -> "上线产品"）由 Prompt 第一条规则和人的眼睛兜 ——
    这是本方案**明确披露的已知边界**。
    """
    reasons: List[str] = []

    if isinstance(original, list) or isinstance(polished, list):
        old_list = original if isinstance(original, list) else []
        new_list = polished if isinstance(polished, list) else []
        old_text = "\n".join(str(item) for item in old_list)
        new_items = [str(item) for item in new_list]
        new_text = "\n".join(new_items)

        for index, item in enumerate(new_items):
            if index >= len(old_list) and not fact_guard.is_blank(item):
                reasons.append(f"模型多输出了第 {index + 1} 条（原文没有这一条）")
                break
        if (
            not reasons
            and section_key == resume_template.SECTION_SKILLS
            and not _skill_items_kept(old_list, new_list)
        ):
            reasons.append("技能条目与原文对不上（少了一项、换了技术名或增删了条目）")
        if not reasons and not fact_guard.digits_are_supported(new_text, old_text):
            detail = fact_guard.describe_unsupported(new_text, old_text)
            reasons.append(f"出现原文没有的数字（{detail}）")
        return "；".join(reasons)

    if not fact_guard.digits_are_supported(str(polished or ""), str(original or "")):
        detail = fact_guard.describe_unsupported(str(polished or ""), str(original or ""))
        reasons.append(f"出现原文没有的数字（{detail}）")

    if fact_guard.is_blank(original) and not fact_guard.is_blank(polished):
        reasons.append("原文没填，模型却填了内容")

    return "；".join(reasons)


def _merge_polished(
    original: Dict[str, Any],
    polished: Dict[str, Any],
    *,
    user_id,
    target_job: Optional[str],
) -> Tuple[Dict[str, Any], List[Tuple[str, str, Optional[str]]]]:
    """把 AI 润色结果合并进用户原文（**字段级**回退 + 全程留痕）。

    返回 ``(合并结果, 回退明细)``；回退明细是 ``[(字段中文名, 原因, 模型原文)]``，
    调用方负责 :func:`_log_fallbacks` 与落库（``parsed_data["_guard_fallbacks"]``）。

    规则（顺序即优先级）：

    1. 以用户原文的**结构**为准（条数、字段名），AI 只提供值；
    2. 多出来的条目（原文 1 条项目、AI 返回 2 条）**直接丢掉**并 warning；
    3. 每个字段过 :func:`_field_guard_reason`：
       命中数字子集/词条对不上/空字段被填 -> **回退成用户原文的那个字段**，留痕；
    4. 合规的字段用 AI 的润色结果。

    为什么是"字段级回退"而不是整份丢弃：编一个数字就把用户其它 20 个字段的润色
    全部作废，用户会更愿意关掉整个功能；字段级回退既保住了红线，
    又能让 message/日志精确说明"是哪个字段被退回了原话"。
    """
    merged = resume_template.empty_parsed_data()
    fallbacks: List[Tuple[str, str, Optional[str]]] = []

    for section in resume_template.template_sections():
        key = section["key"]
        original_value = original.get(key)
        polished_value = polished.get(key)
        label = section["label"]

        if key == resume_template.SECTION_SKILLS:
            polished_list = _coerce_skills(polished_value)
            merged[key], reverted = _merge_list_value(
                original_value if isinstance(original_value, list) else [],
                polished_list,
                path=f"{key}.items",
                label=f"{label}的{section['fields'][0]['label']}",
                section_key=key,
            )
            fallbacks.extend(reverted)
            continue

        if key == resume_template.SECTION_SELF_EVALUATION:
            field_label = section["fields"][0]["label"]
            merged[key], reverted = _merge_text_value(
                original_value, polished_value, path=key, label=f"{label}的{field_label}"
            )
            fallbacks.extend(reverted)
            continue

        if section["repeatable"]:
            old_items = original_value if isinstance(original_value, list) else []
            new_items = polished_value if isinstance(polished_value, list) else []
            if len(new_items) > len(old_items):
                logger.warning(
                    "简历润色护栏：section=%s 模型多输出了 %s 条，已丢弃（user_id=%s）",
                    key, len(new_items) - len(old_items), user_id,
                )
            merged[key] = [
                _merge_item(key, old_items[index] if index < len(old_items) else {},
                            new_items[index] if index < len(new_items) else {},
                            index=index, user_id=user_id, fallbacks=fallbacks)
                for index in range(len(old_items))
            ]
            continue

        item: Dict[str, Any] = {}
        for field in section["fields"]:
            field_key = field["key"]
            value, reverted = _merge_field_value(
                resume_template.get_nested(original_value or {}, field_key),
                resume_template.get_nested(polished_value or {}, field_key),
                path=field_key, label=f"{label}的{field['label']}", multiple=field.get("multiple", False),
                section_key=key,
            )
            resume_template.set_nested(item, field_key, value)
            fallbacks.extend(reverted)
        merged[key] = item

    _log_fallbacks(user_id, fallbacks, target_job=target_job)
    return merged, fallbacks


def _merge_item(
    section_key: str,
    old_item: Dict[str, Any],
    new_item: Dict[str, Any],
    *,
    index: int,
    user_id,
    fallbacks: List[Tuple[str, str, Optional[str]]],
) -> Dict[str, Any]:
    """合并经历类 section 的一条记录（逐字段过闸）。"""
    result: Dict[str, Any] = {}
    label = _short_section_label(section_key)
    for field in resume_template.section_map()[section_key]["fields"]:
        field_key = field["key"]
        value, reverted = _merge_field_value(
            resume_template.get_nested(old_item, field_key),
            resume_template.get_nested(new_item, field_key),
            path=f"{section_key}[{index}].{field_key}",
            label=f"{label}第 {index + 1} 条的{field['label']}",
            multiple=field.get("multiple", False),
            section_key=section_key,
        )
        resume_template.set_nested(result, field_key, value)
        fallbacks.extend(reverted)
    return result


def _merge_field_value(
    original: Any,
    polished: Any,
    *,
    path: str,
    label: str,
    multiple: bool,
    section_key: Optional[str] = None,
) -> Tuple[Any, List[Tuple[str, str, Optional[str]]]]:
    """单字段合并：``multiple`` 走数组规则，否则走文本规则。"""
    if multiple:
        return _merge_list_value(original, polished, path=path, label=label, section_key=section_key)
    return _merge_text_value(original, polished, path=path, label=label)


def _merge_text_value(
    original: Any, polished: Any, *, path: str, label: str
) -> Tuple[str, List[Tuple[str, str, Optional[str]]]]:
    """文本字段合并：要么用润色值，要么回退成用户原文。"""
    original_text = _normalize_text(original)
    polished_text = _normalize_text(polished)
    reason = _field_guard_reason(original_text, polished_text)
    if reason:
        logger.warning(
            "简历润色护栏：字段=%s 违规（%s），已回退成用户原文；模型原文=%s",
            path, reason, _echo(polished_text),
        )
        return original_text, [(label, reason, _store_echo(polished_text))]
    # 模型给了空值而原文非空：视为"这次没润色这个字段"，保留原文（不能因为模型漏写就丢内容）
    if not polished_text and original_text:
        return original_text, []
    return polished_text, []


def _merge_list_value(
    original: Any,
    polished: Any,
    *,
    path: str,
    label: str,
    section_key: Optional[str] = None,
) -> Tuple[List[str], List[Tuple[str, str, Optional[str]]]]:
    """可多值字段合并（``skills`` / ``highlights``）。

    数组是"整段"过闸（见 :func:`_field_guard_reason`），所以回退也整段回退 ——
    部分保留会让"哪几条是模型编的"变得不可解释。
    """
    original_list = original if isinstance(original, list) else []
    polished_list = polished if isinstance(polished, list) else []
    if not polished_list:
        return list(original_list), []

    reason = _field_guard_reason(original_list, polished_list, section_key=section_key)
    if reason:
        logger.warning(
            "简历润色护栏：字段=%s 违规（%s），已回退成用户原文；模型原文=%s",
            path, reason, _echo(" | ".join(str(item) for item in polished_list)),
        )
        return list(original_list), [(label, reason, _store_echo(" | ".join(str(i) for i in polished_list)))]
    return list(polished_list), []


def _log_fallbacks(user_id, fallbacks: Sequence[Tuple[str, str, Optional[str]]], *, target_job: Optional[str]) -> None:
    """把本轮所有字段级回退汇总成一条 warning（可读、可追溯）。"""
    if not fallbacks:
        return
    logger.warning(
        "简历润色护栏：本轮共 %s 个字段被回退成用户原文 user_id=%s target_job=%s",
        len(fallbacks), user_id, target_job or "(未填)",
    )
    for label, reason, echo in fallbacks:
        logger.warning("  回退明细：%s <- %s（模型写的：%s）", label, reason, echo or "(略)")


def _save_resume(
    db: Session,
    user: User,
    original: Dict[str, Any],
    data: Dict[str, Any],
    target_job: Optional[str],
    fallbacks: Sequence[Tuple[str, str, Optional[str]]] = (),
) -> Resume:
    """把结果写进**唯一一份**简历（没有就新建，有就更新那一条）。

    ``parsed_data`` 里额外记三个下划线开头的**元信息**键（前端按模板取字段时不会碰到它们）：

    - ``_template_version``：写的模板版本，将来改字段时前端/排查能分辨老数据；
    - ``_original``：用户提交的原文 —— 润色是"改写"，原件必须留在库里可追溯
      （用户以后要核对"AI 是不是偷偷加了东西"，只能靠它）；
    - ``_guard_fallbacks``：最近一次被护栏回退的字段与原因（最多 10 条），
      让"哪句话被退回了原话"在库里也查得到（日志会轮转，库里这个不会）。

    ``completeness`` 用**用户实填**（``original``）计算，不用润色结果 ——
    它是"你填了多少"的度量，不该受 AI 措辞长短影响。
    """
    completeness = calculate_completeness(original)
    resolved_target = (target_job or "").strip() or str(
        resume_template.get_nested(data.get(resume_template.SECTION_TARGET), "direction") or ""
    ).strip() or None

    payload = dict(data)
    payload["_original"] = original
    payload["_template_version"] = "student_v1"
    if fallbacks:
        payload["_guard_fallbacks"] = [
            {"field": label, "reason": reason, "model_wrote": echo}
            for label, reason, echo in list(fallbacks)[:10]
        ]

    def _apply(target: Resume) -> None:
        target.parsed_data = payload
        target.completeness = completeness
        if resolved_target:
            target.target_job = resolved_target
        target.updated_at = utcnow()

    resume = find_my_resume(db, user.id)
    if resume is None:
        resume = Resume(user_id=user.id, title="我的简历")
        _apply(resume)
        db.add(resume)
        try:
            db.commit()
        except IntegrityError:
            # 并发润色/保存同时走到"没有简历"分支：唯一约束只允许一个插入成功。
            # 回滚后改用另一个请求刚创建的那一条，把本次内容覆盖上去。
            db.rollback()
            resume = find_my_resume(db, user.id)
            if resume is None:
                raise
            _apply(resume)
            db.add(resume)
            db.commit()
    else:
        _apply(resume)
        db.add(resume)
        db.commit()

    db.refresh(resume)
    profile_service.update_resume_score(db, user.id, completeness)
    return resume


def find_my_resume(db: Session, user_id) -> Optional[Resume]:
    """取该用户唯一一份简历（最近的 ``updated_at``；没有返回 ``None``）。

    **不打入** ``updated_at`` 排序之外的口径：唯一性靠 ``_save_resume`` /
    ``save_my_resume`` 只写这一条来保证（不做数据库约束，见"不加表不加列"的约定）。
    """
    statement = (
        select(Resume)
        .where(Resume.user_id == user_id)
        .order_by(Resume.updated_at.desc())  # type: ignore[union-attr]
        .limit(1)
    )
    return db.exec(statement).first()


# ---------- GET / PUT /resume/mine ----------

def get_my_resume(db: Session, user: User) -> Optional[ResumeResponse]:
    """GET /resume/mine：没有简历返回 ``None``（**契约要求不要 404**）。"""
    resume = find_my_resume(db, user.id)
    if resume is None:
        return None
    return ResumeResponse.model_validate(resume)


def save_my_resume(
    db: Session,
    user: User,
    parsed_data: Dict[str, Any],
    title: Optional[str] = None,
    target_job: Optional[str] = None,
) -> ResumeResponse:
    """PUT /resume/mine：用户手动编辑后保存（同一份简历；同样回流 ``resume_score``）。

    ⚠️ 与 ``POST /resume/polish`` 的差别只有一处：**不调 AI**。
    完整度、画像回流、唯一性三者完全一致 —— 用户手改了一份很全的简历，
    分数必须跟上（否则"改了但分不动"会被当成 bug）。
    """
    original = _normalize_parsed_data(parsed_data)
    resume = _save_resume(db, user, original, original, target_job)
    if title and title.strip():
        resume.title = title.strip()[:200]
        db.add(resume)
        db.commit()
        db.refresh(resume)
    return ResumeResponse.model_validate(resume)
