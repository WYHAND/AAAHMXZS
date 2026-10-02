"""Report 路由（10.2 Report：GET /report；本轮新增 POST /report/save）。

语义（详见 README §4.15）：

- ``GET /report`` —— **实时计算，不落库**；改一个分数（打卡/测评）后立刻反映；
- ``POST /report/save`` —— 把当前数据 + 用户补充说明存成里程碑快照，
  该快照成为下次 ``score_delta`` 的基线；
- 两个接口返回 ``data`` 的形状完全一致。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.api_response import ApiResponse
from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.report import GrowthReportResponse, ReportSaveRequest
from app.services import report_service
from app.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/report", tags=["Report 成长报告"])


@router.get("", response_model=ApiResponse[GrowthReportResponse], summary="成长报告（实时）")
async def get_report(
    refresh: bool = Query(
        default=False,
        deprecated=True,
        description="已废弃且被忽略（GET 现在永远实时计算）；保存快照请用 POST /report/save",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[GrowthReportResponse]:
    """11.10：实时聚合画像分数、任务数、亮点与建议。

    - **每次调用都重新计算**，不写库，所以"改一个分数 → 立刻看到"；
    - ``score_delta`` 对比的是「最近一次**保存**的报告」；
      ``saved=false`` / ``last_saved_at=null`` 表示**还没有基线**（此时 delta 全为 0）；
    - ``suggestions`` 每条都带 ``pain_point``，可直接作为 ``POST /task/generate`` 的入参。
    """
    return ApiResponse.ok(report_service.get_growth_report(db, current_user, refresh))


@router.post("/save", response_model=ApiResponse[GrowthReportResponse], summary="保存报告快照")
async def save_report(
    payload: ReportSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ApiResponse[GrowthReportResponse]:
    """把**当前实时数据** + 用户的补充说明存成一份成长报告快照。

    - 保存后 ``last_saved_at`` 为新时间、``user_note`` 为刚提交的内容；
      紧跟其后的 ``score_delta`` 全为 0（基线就是刚保存的这份）；
    - 入参只有 ``user_note``（≤500 字，超长 -> 1001）。
      ⚠️ **没有任何分数字段**：分数由行为算出，用户不可编辑（README §4.15.3 的产品决策）。
    """
    return ApiResponse.ok(report_service.save_growth_report(db, current_user, payload.user_note))
