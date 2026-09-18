"""events 相关 schema：行为埋点上报（设计说明书 5.4 需求，手册 10.2 未列，按用户要求补实现）。

采集的是「无感采集」的原始信号：跳题、放弃任务、忽略建议、每日一问、对话轮次等。

两种请求形状都要接受（前端可能单条也可能批量）：

单条::

    {"event": "test_skip", "payload": {"question_id": "..."}, "client_ts": "2026-09-18T10:00:00Z"}

批量::

    {"events": [{"event": "test_skip", "payload": {}, "client_ts": "..."}]}

**union 解析怎么做的**：没有用 ``Union[EventItem, EventBatchRequest]``，而是用
``model_validator(mode="before")`` 在**入参进入模型之前**把两种形状归一化成统一的
``events: list[EventItem]``。原因：

1. ``Union`` 在 pydantic v2 里是"smart mode"逐成员尝试，两个成员字段高度重叠时
   报错信息会变成难以定位的 union 错误，前端拿到的是没有指向性的 422；
2. 单条与批量本质上只是"列表长度为 1"的差别，归一化后 service 层只有一条代码路径；
3. 校验保持宽松（``payload`` 不 strict、事件名不白名单），埋点失败不能影响业务。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

# 单批上限（超出截断并记 warning，直接丢弃会造成静默数据丢失更难排查）
MAX_EVENTS_PER_BATCH = 50

# 事件名长度上限（不做白名单：前端随时会加新事件，未知事件名照收）
MAX_EVENT_NAME_LENGTH = 100


class EventItem(BaseModel):
    """单条事件（归一化后的统一形状）。"""

    model_config = ConfigDict(extra="ignore")

    event: str = Field(min_length=1, max_length=MAX_EVENT_NAME_LENGTH, description="事件名，如 test_skip")
    payload: Dict[str, Any] = Field(
        default_factory=dict,
        description="任意 JSON 负载；故意宽松（不做 strict、不做白名单），埋点不能影响业务",
    )
    client_ts: Optional[datetime] = Field(
        default=None, description="客户端时间（ISO8601，可带 Z 后缀）；缺失时由服务端补 now"
    )


class EventSubmitRequest(BaseModel):
    """``POST /api/v1/events`` 入参，单条与批量两种形状都接受。"""

    model_config = ConfigDict(extra="ignore")

    # --- 单条形状 ---
    event: Optional[str] = Field(default=None, max_length=MAX_EVENT_NAME_LENGTH)
    payload: Dict[str, Any] = Field(default_factory=dict)
    client_ts: Optional[datetime] = None

    # --- 批量形状 ---
    events: Optional[List[EventItem]] = Field(default=None)

    @model_validator(mode="before")
    @classmethod
    def _normalize_shape(cls, data: Any) -> Any:
        """union 归一化：把「单条形状」搬进 ``events`` 列表，让下游只有一条路径。

        注意：搬完之后要把顶层的 ``event`` / ``payload`` / ``client_ts`` **删掉**，
        否则 ``self.event`` 与 ``self.events[0]`` 会同时存在，
        ``normalized()`` 就会把同一条事件记两遍。
        """
        if not isinstance(data, dict):
            return data
        # 已经是批量形状，或两种都没给 -> 原样交给字段校验器处理
        if data.get("events") is not None or not data.get("event"):
            return data

        single: Dict[str, Any] = {"event": data.get("event")}
        if data.get("payload") is not None:
            single["payload"] = data.get("payload")
        if data.get("client_ts") is not None:
            single["client_ts"] = data.get("client_ts")

        merged = {k: v for k, v in data.items() if k not in {"event", "payload", "client_ts"}}
        merged["events"] = [single]
        return merged

    @model_validator(mode="after")
    def _require_at_least_one(self) -> "EventSubmitRequest":
        if not self.events:
            raise ValueError("必须提供 event（单条）或 events（批量）")
        return self

    def normalized(self) -> List[EventItem]:
        """返回归一化后的事件列表。

        正常情况下 ``_normalize_shape`` 已经把单条搬进 ``events``；
        这里保留单条分支只是为了防御「代码里直接 new 出这个模型」的写法（不会重复记录）。
        """
        items: List[EventItem] = list(self.events or [])
        if not items and self.event:
            items.append(
                EventItem(event=self.event, payload=self.payload or {}, client_ts=self.client_ts)
            )
        return items


class EventStats(BaseModel):
    """上报结果的轻量回执（前端一般忽略）。"""

    accepted: int = Field(default=0, description="实际记录的事件数")
    truncated: int = Field(default=0, description="因超过单批上限被截断的事件数")
    persisted: bool = Field(
        default=False,
        description="是否已持久化。骨架阶段恒为 false（只写结构化日志，见 README）",
    )
