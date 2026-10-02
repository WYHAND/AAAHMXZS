"""「用户日历日」时间口径的**唯一来源**（时区换算集中在这里）。

为什么必须区分「UTC 时间戳」与「用户日历日」（实测 bug，2026-09-26 在本机抓到）：

- 库里所有时间戳都是 **naive UTC**（``app.models.user.utcnow()``）；
- 但「今天有没有答过每日一问」「连续打卡几天」问的是**用户所在时区的日历日**
  （用户心里的"今天"），不是 UTC 日历日；
- 修复前的 ``daily_question_service`` 直接拿 ``datetime.now().date()``（服务器本地
  日期，UTC+8）拼出 [00:00, 24:00) 去和 naive UTC 的 ``answered_at`` 比较 ——
  两个口径混用。后果：本地 00:00–08:00（= UTC 前一天 16:00–24:00）答的题落在
  窗口外，页面显示"今天还没答"（``answered=false``），而记录其实已经落库。
  实测 wyh2 在本地 2026-09-26 00:04:45 答题（UTC 2026-09-25 16:04:45），
  同一时刻查询回报 ``answered=false``。

所以约定：**先在"本地日历日"上定出窗口，再把窗口边界换算回 naive UTC 交给 SQL**。
边界必须换回 UTC，是因为列里存的是 UTC：拿本地时间的边界去比 UTC 的时间戳，
在 UTC+8 下等于整体错位 8 小时（本地某日 00:00 == UTC 前一天 16:00），
窗口会整体前移 8 小时，把当天 00:00–08:00 的记录漏掉。

注意：**不要**为了省事往库里写 aware datetime（SQLite 会存成带 ``+00:00`` 的
字符串，与既有数据比较会错位，见 backend/README.md §4.13.4）。换算只发生在
"生成比较边界"这一刻，落库仍然一律 ``utcnow()``。
"""

from __future__ import annotations

import os
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, Tuple

from app.models.user import utcnow
from app.utils.logger import get_logger

logger = get_logger(__name__)

# 覆盖时区偏移用的环境变量名（服务器本身跑在 UTC、或产品换时区时改它）
TZ_OFFSET_ENV = "APP_TZ_OFFSET_HOURS"

# 默认偏移：**+8 小时**（东八区 / 北京时间）。
# 产品面向国内学生，绝大多数用户在东八区；中国全年不实行夏令时，
# 固定偏移就够。真要支持跨夏令时的地区，再换成 zoneinfo 方案。
DEFAULT_TZ_OFFSET_HOURS = 8.0


def _read_offset_hours() -> float:
    """从环境变量读偏移小时数；缺失或非法时回落默认值（并记一条日志）。"""
    raw = os.getenv(TZ_OFFSET_ENV)
    if raw is None or not raw.strip():
        return DEFAULT_TZ_OFFSET_HOURS
    try:
        return float(raw)
    except ValueError:
        logger.warning(
            "%s=%r 不是合法数字，回落默认 %s 小时", TZ_OFFSET_ENV, raw, DEFAULT_TZ_OFFSET_HOURS
        )
        return DEFAULT_TZ_OFFSET_HOURS


# 用户时区相对 UTC 的固定偏移，导入时求值一次。
# （模块级常量便于测试/脚本用 ``monkeypatch`` 改；函数在**调用时**读这个全局名。）
APP_TZ_OFFSET: timedelta = timedelta(hours=_read_offset_hours())


def _as_naive_utc(dt: datetime) -> datetime:
    """容错归一：万一传进来 aware datetime，先换成 naive UTC（库里只存 naive UTC）。"""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def local_date_of(dt: datetime) -> date:
    """把 naive UTC 时间戳换算成**用户所在时区的日历日期**。"""
    return (_as_naive_utc(dt) + APP_TZ_OFFSET).date()


def current_local_date(now: Optional[datetime] = None) -> date:
    """用户本地的"今天"（``now`` 缺省取 ``utcnow()``，可传 UTC 时刻便于验证）。"""
    return local_date_of(now if now is not None else utcnow())


def local_day_range_utc(now: Optional[datetime] = None) -> Tuple[datetime, datetime]:
    """某个**本地日历日**在 naive UTC 下的 ``[start, end)`` 边界。

    ``now`` 缺省取 ``utcnow()``；该时刻所属的本地日历日决定窗口。返回的两个值
    可以直接和库里的 naive UTC 列（如 ``DailyAnswer.answered_at``）做 ``>=`` / ``<``
    比较。半开区间 ``[start, end)``：本地 00:00 属于当天，次日 00:00 属于次日。
    """
    day = current_local_date(now)
    start_local = datetime.combine(day, time.min)  # 本地当天 00:00（naive）
    start_utc = start_local - APP_TZ_OFFSET  # 换回 UTC（naive）才能和 answered_at 比
    return start_utc, start_utc + timedelta(days=1)
