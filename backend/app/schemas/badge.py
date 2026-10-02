"""badge 相关 schema（11.12 奖章）。

``GET /badge``（``ApiResponse[BadgeOverviewResponse]``）返回的是**奖章总览**：
全部奖章 + 每枚的进度 + 是否已获得。字段名与顺序属于前后端冻结契约，
见 ``backend/README.md`` §5.2 与 ``badge_service.BADGE_RULES``。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class BadgeResponse(BaseModel):
    """奖章定义（骨架扩展，路由层未开放）。"""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    condition: Optional[Dict[str, Any]] = None
    created_at: datetime


class BadgeProgress(BaseModel):
    """单枚奖章的进度（``current`` 已达成的封顶为 ``target``）。"""

    current: int = Field(description="当前进度值")
    target: int = Field(description="达成所需值")


class BadgeItemResponse(BaseModel):
    """一枚奖章：定义 + 本人是否拿到 + 进度。"""

    key: str = Field(description="稳定机器标识，前端据此选奖章美术（取不到用默认美术）")
    name: str
    description: str = Field(description="一句话说明这枚奖章是什么")
    hint: str = Field(description="未获得时说怎么拿到；已获得时说一句庆祝/意义")
    obtained: bool
    obtained_at: Optional[datetime] = Field(default=None, description="未获得时为 null")
    progress: BadgeProgress


class BadgeOverviewResponse(BaseModel):
    """``GET /badge`` 出参。

    ``items`` 顺序**固定**为门槛从低到高（``badge_service.BADGE_RULES`` 的
    ``order``），这样前端奖章槽位不会因为获得顺序而跳动。
    """

    total: int = Field(description="奖章总数")
    obtained_count: int = Field(description="本人已获得数量")
    items: List[BadgeItemResponse] = Field(description="全部奖章，顺序固定：门槛从低到高")
