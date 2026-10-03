"""学生简历模板：**"简历需要填什么"的唯一来源**（纯静态配置，不查库、不调 AI）。

## 为什么单独一份
这一轮的产品逻辑是：**模板问什么，用户就填什么，AI 只润色用户填下的内容**。
所以"有哪些字段"必须是**服务端可枚举的一份清单**，而不是散落在 Prompt 或前端里：

- ``GET /api/v1/resume/template`` 直接把它吐给前端（不查库）；
- 前端照着 ``fields[].question`` 一条一条问，字段名/必填标记都以它为准；
- ``resume_polish`` Prompt 拿它当"字面清单"（只许改写这些字段，不许新增字段）；
- ``resume_service`` 的完整度、空字段回退、结构校验全部按它遍历。

改字段 = 改这一个文件（外加 ``resume_polish.txt`` 里的 JSON 示例保持同步）。

## 结构约定（与前端契约一致，别改）
- ``repeatable: true`` 的 section（``education`` / ``projects`` / ``campus``）：
  ``fields[].key`` 是**单条经历内部**的字段名（多条时整体是一个数组）；
- ``repeatable: false`` 的 section（``basic`` / ``target`` / ``skills`` / ``self_evaluation``）：
  ``fields[].key`` 相对 **section 本身**，落库时是 ``parsed_data[section]`` 的一个键；
- ``skills`` 特殊：一个可多值字段 ``items``，落库成 ``parsed_data["skills"]`` 的**字符串数组**
  （不是 ``{"items": [...]}``）；
- ``self_evaluation`` 特殊：字段 ``text``，落库成 ``parsed_data["self_evaluation"]`` 的**字符串**。

⚠️ ``key`` 里带点的只有 ``star.*``（``projects`` / ``campus`` 单条经历内部的嵌套对象）。
解析/写回请用 :func:`set_nested` / :func:`get_nested`，不要手写 split(".") 拼字典。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

# 分组 key —— 与 ``parsed_data`` 的顶层键、以及前端表单分组一一对应
SECTION_BASIC = "basic"
SECTION_TARGET = "target"
SECTION_EDUCATION = "education"
SECTION_SKILLS = "skills"
SECTION_PROJECTS = "projects"
SECTION_CAMPUS = "campus"
SECTION_SELF_EVALUATION = "self_evaluation"

# 落库时 ``parsed_data`` 的顶层键顺序（也是"字面清单"的展示顺序）
SECTION_KEYS: tuple = (
    SECTION_BASIC,
    SECTION_TARGET,
    SECTION_EDUCATION,
    SECTION_SKILLS,
    SECTION_PROJECTS,
    SECTION_CAMPUS,
    SECTION_SELF_EVALUATION,
)

# 这两节的落库形态是"值本身"，不是"字段字典"（见模块 docstring）
SCALAR_SECTIONS: tuple = (SECTION_SKILLS, SECTION_SELF_EVALUATION)

# 经历类 section 里嵌套的 STAR 子对象键
STAR_KEY = "star"


def _field(
    key: str,
    label: str,
    question: str,
    example: str,
    required: bool = False,
    multiple: bool = False,
    lines: bool = False,
) -> Dict[str, Any]:
    """一个字段的配置。

    - ``multiple=True``：可多值（存成字符串数组）；
    - ``lines=True``：可多值、且**一项一行**地编辑（用多行输入框，换行分隔）。
      技能用这个：润色会把每个关键词展开成一句能力表述（"Java" ->
      "熟悉 Java 基础语法、面向对象编程…"），一句话里本来就带顿号逗号，
      再用顿号分隔输入框会把一句话切成好几项。
    """
    return {
        "key": key,
        "label": label,
        "question": question,
        "example": example,
        "required": required,
        "multiple": multiple,
        "lines": lines,
    }


# ---------------------------------------------------------------------------
# 经历类 section 共用的字段（``projects`` / ``campus`` 完全同构）
# ---------------------------------------------------------------------------
def _experience_fields() -> List[Dict[str, Any]]:
    """项目/校园经历的单条字段（S/T/A/R 四问，每问都能单独留空）。"""
    return [
        _field("name", "名称", "这段经历叫什么？（项目名 / 活动名）", "校园二手交易小程序"),
        _field("role", "你的角色", "你在这段经历里是什么角色？", "前端开发"),
        _field("period", "起止时间", "这段时间大概是什么时候？（没记住可以不填）", "2024.09 - 2024.12"),
        _field(
            "star.situation",
            "情境",
            "当时是什么背景、要解决什么问题？",
            "老师布置了课程作业，要做一个小程序；同学们卖二手书很麻烦",
        ),
        _field("star.task", "任务", "你要做成什么？", "做出能发布和搜索二手书的页面"),
        _field("star.action", "行动", "你具体做了什么？", "我负责前端页面，用 Vue 写的"),
        _field("star.result", "结果", "最后达成什么？有数字就写上。", "最后上线了，有一百多个同学用过"),
    ]


# ---------------------------------------------------------------------------
# 模板本体（``GET /resume/template`` 原样返回 ``sections``）
# ---------------------------------------------------------------------------
RESUME_TEMPLATE: Dict[str, Any] = {
    "sections": [
        {
            "key": SECTION_BASIC,
            "label": "基本信息",
            "repeatable": False,
            "fields": [
                _field("name", "姓名", "你叫什么名字？", "张三", required=True),
                _field("grade", "年级", "你现在大几？（选填）", "大三"),
                _field("major", "专业", "你学什么专业？", "软件工程", required=True),
                _field("school", "学校", "你在哪所学校？", "XX 大学", required=True),
                _field(
                    "contact",
                    "联系方式（电话或邮箱）",
                    "怎么联系你？（电话或邮箱，写一个就行）",
                    "138xxxx1234 或 zhangsan@example.com",
                    required=True,
                ),
            ],
        },
        {
            "key": SECTION_TARGET,
            "label": "求职意向",
            "repeatable": False,
            "fields": [
                _field(
                    "direction",
                    "想投的方向/岗位",
                    "你想投哪个方向或岗位？",
                    "前端开发实习生",
                    required=True,
                ),
                _field("city", "城市", "你倾向去哪个城市？（选填）", "杭州"),
            ],
        },
        {
            "key": SECTION_EDUCATION,
            "label": "教育背景",
            "repeatable": True,
            "fields": [
                _field("school", "学校", "这段教育经历是哪所学校？", "XX 大学"),
                _field("major", "专业", "是什么专业？", "软件工程"),
                _field("period", "起止时间", "什么时候到什么时候？", "2022.09 - 2026.06"),
                _field(
                    "highlights",
                    "亮点",
                    "有什么值得一提的？（课程、成绩、奖项，一条一句）",
                    "专业排名前 20%",
                    multiple=True,
                ),
            ],
        },
        {
            "key": SECTION_SKILLS,
            "label": "技能",
            "repeatable": False,
            "fields": [
                _field(
                    "items",
                    "技能",
                    "你会用什么工具或技术？（一个一行，写关键词就行）",
                    "Java\nVue\nExcel",
                    multiple=True,
                    lines=True,
                ),
            ],
        },
        {
            "key": SECTION_PROJECTS,
            "label": "项目经历",
            "repeatable": True,
            "fields": _experience_fields(),
        },
        {
            "key": SECTION_CAMPUS,
            "label": "校园与实践经历",
            "repeatable": True,
            "fields": _experience_fields(),
        },
        {
            "key": SECTION_SELF_EVALUATION,
            "label": "自我评价",
            "repeatable": False,
            "fields": [
                _field(
                    "text",
                    "自我评价",
                    "用几句话说说你自己的特点。",
                    "做事比较较真，答应的事会做完；不太会主动争取，正在改。",
                ),
            ],
        },
    ]
}


def template_sections() -> List[Dict[str, Any]]:
    """模板的 sections（**每次返回深拷贝的浅层结构**，调用方改不坏常量）。"""
    return [
        {
            "key": section["key"],
            "label": section["label"],
            "repeatable": section["repeatable"],
            "fields": [dict(field) for field in section["fields"]],
        }
        for section in RESUME_TEMPLATE["sections"]
    ]


def section_map() -> Dict[str, Dict[str, Any]]:
    """``{section_key: 配置}``，供 service 遍历用。"""
    return {section["key"]: section for section in RESUME_TEMPLATE["sections"]}


# ---------------------------------------------------------------------------
# 空骨架 / 取值 / 写值
# ---------------------------------------------------------------------------
def empty_parsed_data() -> Dict[str, Any]:
    """``parsed_data`` 的空骨架（**永远有全部键**，前端不用做 undefined 判断）。

    与契约里的 JSON 结构逐字一致：

    - ``repeatable`` section -> 空数组（不是空对象）；
    - ``skills`` -> 空数组；``self_evaluation`` -> 空字符串；
    - 可多值字段 -> 空数组；其余字段 -> 空字符串。
    """
    data: Dict[str, Any] = {}
    for key in SECTION_KEYS:
        if key == SECTION_SKILLS:
            data[key] = []
        elif key == SECTION_SELF_EVALUATION:
            data[key] = ""
        elif key in (SECTION_EDUCATION, SECTION_PROJECTS, SECTION_CAMPUS):
            data[key] = []
        else:
            section = section_map()[key]
            data[key] = {field["key"]: "" for field in section["fields"]}
    return data


def empty_item(section_key: str) -> Dict[str, Any]:
    """经历类 section 的一条空记录（``star`` 也要有全部四个键）。"""
    section = section_map().get(section_key) or {}
    item: Dict[str, Any] = {}
    star: Dict[str, Any] = {}
    for field in section.get("fields", []):
        key = field["key"]
        if key.startswith(f"{STAR_KEY}."):
            star[key.split(".", 1)[1]] = ""
        elif field.get("multiple"):
            item[key] = []
        else:
            item[key] = ""
    if star:
        item[STAR_KEY] = star
    return item


def get_nested(container: Any, dotted_key: str, default: Any = None) -> Any:
    """按 ``"star.situation"`` 这样的点分键取值（对象不存在时返回 ``default``）。"""
    current = container
    for part in str(dotted_key).split("."):
        if not isinstance(current, dict) or part not in current:
            return default
        current = current[part]
    return current


def set_nested(container: Dict[str, Any], dotted_key: str, value: Any) -> None:
    """按点分键写值（中间层缺失时自动建字典）。"""
    parts = str(dotted_key).split(".")
    current = container
    for part in parts[:-1]:
        nxt = current.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            current[part] = nxt
        current = nxt
    current[parts[-1]] = value


def iter_leaf_slots(section_key: str, container: Any) -> List[Any]:
    """把某 section 下的值摊平成 ``(路径, 值, 字段配置)`` 之外的叶子值列表（调试/统计用）。"""
    section = section_map().get(section_key) or {}
    values: List[Any] = []
    for field in section.get("fields", []):
        values.append(get_nested(container, field["key"]))
    return values


__all__ = [
    "RESUME_TEMPLATE",
    "SECTION_KEYS",
    "SECTION_BASIC",
    "SECTION_TARGET",
    "SECTION_EDUCATION",
    "SECTION_SKILLS",
    "SECTION_PROJECTS",
    "SECTION_CAMPUS",
    "SECTION_SELF_EVALUATION",
    "SCALAR_SECTIONS",
    "STAR_KEY",
    "template_sections",
    "section_map",
    "empty_parsed_data",
    "empty_item",
    "get_nested",
    "set_nested",
    "iter_leaf_slots",
]
