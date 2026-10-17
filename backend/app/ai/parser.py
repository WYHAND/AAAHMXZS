"""AI 输出解析与校验（《开发手册》7.3 结构化输出、7.6 兜底）。

职责：
1. 读取 ``app/ai/prompts/*.txt`` 模板；
2. 从模型回复里稳健地抠出 JSON（容忍 ```json 代码块、前后解释文字、尾随逗号）；
3. 用 Pydantic 校验，失败时按 7.6 重试 1 次、再失败给默认值。

重试逻辑放在 ``deepseek_client.chat_json``，这里只负责“解析”这一层。
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Type, TypeVar

from pydantic import BaseModel, ValidationError

from app.utils.logger import get_logger, sanitize

logger = get_logger(__name__)

TModel = TypeVar("TModel", bound=BaseModel)

PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"

# ---------- Prompt 清单：手册 7.4 的表格项 + 骨架补充项（后者见 README「待确认」） ----------
# ⚠️ 7.4 里的 ``resume_parse`` / ``resume_optimize`` 两项已随老 ATS 链路移除（2026-11，
#    见 README §4.10）；现行简历链路只用 ``resume_polish``。
PROMPT_FILES: Dict[str, str] = {
    # 7.4 表格中明确列出的其余项
    "chat_system": "chat_system.txt",
    "profile_extract": "profile_extract.txt",
    "resume_polish": "resume_polish.txt",
    "interview_question": "interview_question.txt",
    "interview_followup": "interview_followup.txt",
    "interview_review": "interview_review.txt",
    "task_generate": "task_generate.txt",
    "daily_question": "daily_question.txt",
    # 9.24：「我的画像」顶部那句人物速写（按可见标签生成，落库缓存）
    "profile_summary": "profile_summary.txt",
    # 手册 7.4 未列出、但 11.4 / 11.11 需要，骨架补充
    "chat_conclusion": "chat_conclusion.txt",
    "test_free_text": "profile_extract.txt",  # 11.2 文字补充复用画像抽取模板
    "chat_opening": "chat_opening.txt",  # 新会话 AI 先开口（11.4 扩展）
}

_CODE_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
_TRAILING_COMMA_RE = re.compile(r",\s*([}\]])")


class PromptNotFoundError(FileNotFoundError):
    """Prompt 模板缺失。"""


def prompt_path(name: str) -> Path:
    """把 ``chat_system`` 映射成 ``app/ai/prompts/chat_system.txt``。"""
    filename = PROMPT_FILES.get(name, name if name.endswith(".txt") else f"{name}.txt")
    return PROMPTS_DIR / filename


@lru_cache(maxsize=32)
def load_prompt(name: str) -> str:
    """读取模板原文（带缓存）。模板缺失时抛 ``PromptNotFoundError``。"""
    path = prompt_path(name)
    if not path.exists():
        logger.error("Prompt 模板缺失: %s", path)
        raise PromptNotFoundError(f"Prompt 模板不存在: {path.name}")
    return path.read_text(encoding="utf-8")


def clear_prompt_cache() -> None:
    """Prompt 改版后（17.5 版本化）清缓存，便于热加载。"""
    load_prompt.cache_clear()


def extract_json(content: str) -> Any:
    """从任意文本里抠出第一个合法 JSON 对象/数组。

    依次尝试：
    1. 直接 ``json.loads``；
    2. 取 ```json ... ``` 代码块内容；
    3. 从第一个 ``{``/``[`` 到最后一个 ``}``/``]`` 的区间；
    4. 去掉尾随逗号后再试。
    全部失败抛 ``ValueError``。
    """
    if content is None:
        raise ValueError("模型返回为空")

    text = content.strip()

    candidates: List[str] = [text]

    fence = _CODE_FENCE_RE.search(text)
    if fence:
        candidates.append(fence.group(1).strip())

    start_obj, start_arr = text.find("{"), text.find("[")
    starts = [i for i in (start_obj, start_arr) if i >= 0]
    if starts:
        start = min(starts)
        end_obj, end_arr = text.rfind("}"), text.rfind("]")
        end = max(end_obj, end_arr)
        if end > start:
            candidates.append(text[start:end + 1])

    for candidate in candidates:
        if not candidate:
            continue
        for attempt in (candidate, _TRAILING_COMMA_RE.sub(r"\1", candidate)):
            try:
                return json.loads(attempt)
            except json.JSONDecodeError:
                continue

    logger.warning("JSON 解析失败，原文前 300 字: %s", sanitize(text[:300]))
    raise ValueError("无法从模型输出中解析出 JSON")


def validate_model(payload: Any, schema: Type[TModel]) -> TModel:
    """Pydantic 校验（7.3）。"""
    return schema.model_validate(payload)


def parse_to_model(content: str, schema: Type[TModel]) -> TModel:
    """先抠 JSON 再校验，一步到位。"""
    return validate_model(extract_json(content), schema)


def safe_parse(content: str, schema: Type[TModel], default: TModel) -> TModel:
    """7.6 兜底版：解析/校验失败返回默认值，绝不抛错。"""
    try:
        return parse_to_model(content, schema)
    except (ValueError, ValidationError) as exc:
        logger.warning("结构化解析失败，使用默认值 schema=%s err=%s", schema.__name__, sanitize(exc))
        return default


def clamp_weight(value: Any, default: float = 0.5) -> float:
    """把模型给的权重收敛到 [0,1]（7.3 校验之外的数值兜底）。"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, number))


def normalize_tags(raw_tags: Optional[List[Any]]) -> List[Dict[str, Any]]:
    """把画像标签规范化成 ``{dimension,label,weight,evidence}``。

    - 未知维度归入“其他”
    - 权重越界收敛
    - 去重（同维度同标签保留权重更高的一条）
    """
    from app.ai.schemas import ALLOWED_DIMENSIONS  # 局部导入避免循环

    normalized: Dict[tuple, Dict[str, Any]] = {}
    for item in raw_tags or []:
        if isinstance(item, BaseModel):
            item = item.model_dump()
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if not label:
            continue
        dimension = str(item.get("dimension") or "其他").strip() or "其他"
        if dimension not in ALLOWED_DIMENSIONS:
            dimension = "其他"
        weight = clamp_weight(item.get("weight"))
        record = {
            "dimension": dimension,
            "label": label[:100],
            "weight": weight,
            "evidence": str(item.get("evidence") or "")[:500],
        }
        key = (dimension, label)
        if key not in normalized or normalized[key]["weight"] < weight:
            normalized[key] = record
    return list(normalized.values())
