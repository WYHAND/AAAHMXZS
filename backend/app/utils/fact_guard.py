"""「润色不许新增事实」的机械校验（简历润色专用，见 ``resume_service.polish_resume``）。

## 为什么要有这个模块
简历润色的红线是**只改写、不新增**，而 Prompt 里的"不许编造"是**软约束** ——
模型在"让它看起来更专业"的压力下最常干的一件事就是**补数字**：

    学生原文：「最后上线了，有一百多个同学用过」
    模型输出：「上线后累计 150+ 用户使用」

这句话读起来毫无破绽，但 150 这个数**学生从来没说过**，是模型替他编的。
简历上造假数字的后果由学生承担（面试一问就穿），所以必须在服务端**机械拦下**。

## 判据：数字子集
数字是"最容易编、也最容易机械核对"的一类事实，所以只认这一条硬规则：

    **润色结果里出现的每一个数字，都必须能在用户原文里找到；多出来的就是编的。**

实现上取"字符级子集"而不是"整串数字子集"，因为模型会把用户写的数字**改写形态**
（``2024.03`` -> ``2024 年 3 月``、``3 人`` -> ``3 位同学``），整串比对会把这类
合法改写误判成编造；而字符级子集抓的是"这个数字字符到底有没有出处"，
既能拦住 ``一百多`` -> ``150+``（原文一个阿拉伯数字都没有），也不会误伤上面那种改写。

两类数字分开比、都要过（宁可漏判，也不误伤）：
1. **阿拉伯数字**：``re.findall(r"\\d", text)`` 的字符多重集，要求是原文的子集；
2. **中文数词**：``一二三四五六七八九十百千万零两`` 这些字，要求原文里出现过同一个字
   —— 拦住"原文没有数字，模型写成『三个月』『十位同学』"这条绕过路径。

⚠️ 这是**廉价的第一道闸**，不是完备的事实校验：模型完全可能不加数字地编事实
（"做过作业" -> "上线了产品"）。第二道闸是"空字段不许被填"，第三道是人的眼睛。
本项目刻意不在服务端做语义级事实校验（成本远超收益），见 ``docs/`` 里的产品约定。

## 与 ``reference_match`` 的关系
``app/utils/reference_match.py`` 管的是"这段文本有没有提到某个标签/主题"（去重用），
语义与这里完全不同，**不要**把它改造成通用工具 —— 本模块独立实现，互不影响。
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Sequence, Tuple

# 阿拉伯数字（逐字符取，见模块 docstring 的说明）
_ARABIC_DIGIT_RE = re.compile(r"\d")

# 中文数词用到的字（不含「零」的异体与「廿/卅」等生僻写法：宁可少拦，不误伤）
_CN_NUMERAL_CHARS = "一二三四五六七八九十百千万零两"


def extract_digits(text: str) -> str:
    """取出文本里的全部阿拉伯数字字符（保序，可用于打印对照）。"""
    return "".join(_ARABIC_DIGIT_RE.findall(text or ""))


def extract_cn_numerals(text: str) -> str:
    """取出文本里的全部中文数词字符（保序）。"""
    return "".join(ch for ch in (text or "") if ch in _CN_NUMERAL_CHARS)


def _is_subset(part: str, whole: str) -> bool:
    """``part`` 的字符多重集是否被 ``whole`` 覆盖（逐字符计数比对，不看顺序）。"""
    if not part:
        return True
    remaining = list(whole)
    for ch in part:
        if ch in remaining:
            remaining.remove(ch)
        else:
            return False
    return True


def digits_are_supported(polished: str, reference: str) -> bool:
    """润色文本里的数字是否**全部**能在原文里找到出处。

    - ``True``：没编数字（包含""润色结果为空"这种平凡情况）；
    - ``False``：出现了原文里没有的阿拉伯数字**或**中文数词。
    """
    if not polished:
        return True
    return _is_subset(extract_digits(polished), extract_digits(reference)) and _is_subset(
        extract_cn_numerals(polished), extract_cn_numerals(reference)
    )


def _iter_leaf_texts(value) -> List[str]:
    """把一个字段值里的所有文本叶子摊平（用于"整字段一起比"的兜底判定）。"""
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        out: List[str] = []
        for item in value.values():
            out.extend(_iter_leaf_texts(item))
        return out
    if isinstance(value, (list, tuple, set)):
        out = []
        for item in value:
            out.extend(_iter_leaf_texts(item))
        return out
    return [str(value)]


def unsupported_numbers(polished: str, reference: str) -> Tuple[str, str]:
    """诊断用：返回 ``(原文里没有的阿拉伯数字, 原文里没有的中文数词)``。

    只用于 ``logger.warning`` 留痕 —— 让日志里能直接看到"多出来的是哪个数"，
    而不是只有一句"有个字段被回退了"。
    """
    ref_digits = list(extract_digits(reference))
    extra_digits: List[str] = []
    for ch in extract_digits(polished):
        if ch in ref_digits:
            ref_digits.remove(ch)
        else:
            extra_digits.append(ch)

    ref_cn = list(extract_cn_numerals(reference))
    extra_cn: List[str] = []
    for ch in extract_cn_numerals(polished):
        if ch in ref_cn:
            ref_cn.remove(ch)
        else:
            extra_cn.append(ch)

    return "".join(extra_digits), "".join(extra_cn)


def describe_unsupported(polished: str, reference: str) -> str:
    """一行日志用的说明（``多出数字=…/多出中文数词=…``，都没有则返回空串）。"""
    extra_digits, extra_cn = unsupported_numbers(polished, reference)
    bits: List[str] = []
    if extra_digits:
        bits.append(f"多出阿拉伯数字={extra_digits!r}")
    if extra_cn:
        bits.append(f"多出中文数词={extra_cn!r}")
    if not bits:
        return ""
    return "；".join(bits)


# ---------------------------------------------------------------------------
# 「空字段不许被填」：字段级判定
# ---------------------------------------------------------------------------
def is_blank(value) -> bool:
    """字段是否视为"用户没填"（空串 / 只有空白 / 空列表 / 对象里全是空）。

    对象（如 ``star``）里只要有一个非空叶子就算"填了" —— 用户写了"情境"，
    模型就允许一并改写"情境"，但没有义务把 task/action/result 补出来
    （补出来的那几段由**逐字段**的空值判定拦下）。
    """
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, dict):
        return all(is_blank(item) for item in value.values())
    if isinstance(value, (list, tuple, set)):
        return all(is_blank(item) for item in value)
    return False


def filled_to_blank_flags(before, after) -> Dict[str, bool]:
    """逐叶子比较 ``before``/``after``，返回 ``{叶子路径: 是否"空 -> 非空"}``。

    ``before`` 是用户原文（判空基准），``after`` 是润色结果。
    只有"用户没填、模型填上了"这一种情况算 True —— 用户本来就填了的字段，
    模型改写（甚至写得更长）不在此列。
    """
    flags: Dict[str, bool] = {}

    def walk(old, new, path: str) -> None:
        if isinstance(new, dict):
            old_dict = old if isinstance(old, dict) else {}
            for key, value in new.items():
                walk(old_dict.get(key), value, f"{path}.{key}" if path else str(key))
            return
        if isinstance(new, (list, tuple)):
            old_list = old if isinstance(old, (list, tuple)) else []
            for index, value in enumerate(new):
                old_item = old_list[index] if index < len(old_list) else None
                walk(old_item, value, f"{path}[{index}]")
            return
        if is_blank(old) and not is_blank(new):
            flags[path] = True

    walk(before, after, "")
    return flags


__all__ = [
    "extract_digits",
    "extract_cn_numerals",
    "digits_are_supported",
    "unsupported_numbers",
    "describe_unsupported",
    "is_blank",
    "filled_to_blank_flags",
]
