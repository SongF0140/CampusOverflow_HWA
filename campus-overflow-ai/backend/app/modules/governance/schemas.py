"""governance 模块 Schema：本期仅占位出参，二期随业务逻辑补全。"""
from datetime import datetime

from pydantic import BaseModel


class ModerationCaseOut(BaseModel):
    """审核工单出参（501 占位阶段仅展示结构）。"""
    id: int
    target_type: str
    target_id: int
    risk_level: str
    source: str
    reason: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AppealOut(BaseModel):
    """申诉出参（501 占位阶段仅展示结构）。"""
    id: int
    case_id: int
    user_id: int
    reason: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
