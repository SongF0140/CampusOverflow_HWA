# governance 路由占位：治理逻辑随 Agent 一起于第二阶段实现，本期一律返回 501
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_roles
from app.db.session import get_db
from app.modules.identity.models import User

router = APIRouter(prefix="/api/governance", tags=["治理（二期）"])


def _not_implemented() -> None:
    """统一 501 占位响应。"""
    raise HTTPException(status_code=501, detail="治理逻辑随第二阶段 Agent 服务一起实现")


@router.get("/moderation/cases")
def list_moderation_cases(
    _admin: User = Depends(require_roles("admin")),
    _db: Session = Depends(get_db),
) -> dict:
    """管理员：审核工单队列（二期实现）。"""
    _not_implemented()


@router.post("/moderation/cases/{case_id}/resolve")
def resolve_moderation_case(
    case_id: int,
    _admin: User = Depends(require_roles("admin")),
    _db: Session = Depends(get_db),
) -> dict:
    """管理员：处置审核工单（二期实现，七种处置动作留痕）。"""
    _not_implemented()


@router.get("/appeals")
def list_appeals(
    _admin: User = Depends(require_roles("admin")),
    _db: Session = Depends(get_db),
) -> dict:
    """管理员：申诉列表（二期实现）。"""
    _not_implemented()


@router.post("/appeals/{appeal_id}/resolve")
def resolve_appeal(
    appeal_id: int,
    _admin: User = Depends(require_roles("admin")),
    _db: Session = Depends(get_db),
) -> dict:
    """管理员：申诉复核（维持 / 撤销，二期实现）。"""
    _not_implemented()
