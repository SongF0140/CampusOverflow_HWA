# governance 对外路由（T-15-A 审批中心与申诉，US-13/14/16）：
# 管理端治理接口（/api/governance/*，管理员）+ 学生申诉提交（/api/appeals，登录用户）。
# 处置动作复用 T-16 扩展的双环状态机与真实执行（hide/delete/ban/skip）；
# 分层基线 D-2/D-9：本层只收参调 service_admin，不 import models、不触碰 ORM。
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import (
    UserPrincipal,
    get_current_user_allow_banned,
    require_roles,
)
from app.core.response import ok
from app.db.session import get_db
from app.modules.governance import service_admin
from app.modules.governance.schemas import (
    AppealCreateRequest,
    AppealResolveRequest,
    CaseResolveRequest,
)

router = APIRouter(prefix="/api/governance", tags=["治理（审批中心）"])
# 学生申诉提交路径：与前端 AppealFormView 既有契约一致（/api/appeals，蛇形字段）
appeals_router = APIRouter(prefix="/api/appeals", tags=["申诉"])


@router.get("/moderation/cases")
def list_moderation_cases(
    admin: UserPrincipal = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(
        None, description="pending/agent_proposed/manager_directed/executed/rejected"
    ),
    source: str | None = Query(None, description="agent/admin"),
) -> dict:
    """管理员：审核工单队列（状态/来源筛选 + 分页）。"""
    items, total = service_admin.list_moderation_cases(db, page, page_size, status, source)
    return ok({
        "items": [item.model_dump() for item in items],
        "total": total, "page": page, "page_size": page_size,
    })


@router.post("/moderation/cases/{case_id}/resolve")
def resolve_moderation_case(
    case_id: int,
    req: CaseResolveRequest,
    admin: UserPrincipal = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：处置审核工单（hide/delete/ban/skip；真实处置与留痕同事务）。"""
    case = service_admin.resolve_moderation_case(
        db, admin.id, case_id, req.decision, req.manager_feedback
    )
    return ok(case.model_dump(), "工单处置完成")


@router.get("/appeals")
def list_appeals(
    admin: UserPrincipal = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None, description="pending/accepted/rejected"),
) -> dict:
    """管理员：申诉列表。"""
    items, total = service_admin.list_appeals(db, page, page_size, status)
    return ok({
        "items": [item.model_dump() for item in items],
        "total": total, "page": page, "page_size": page_size,
    })


@router.post("/appeals/{appeal_id}/resolve")
def resolve_appeal(
    appeal_id: int,
    req: AppealResolveRequest,
    admin: UserPrincipal = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：复核申诉（accepted 撤销处置 / rejected 维持；回退与留痕同事务）。"""
    appeal = service_admin.resolve_appeal(
        db, admin.id, appeal_id, req.resolution, req.resolution_note
    )
    return ok(appeal.model_dump(), "申诉复核完成")


@appeals_router.post("")
def submit_appeal(
    req: AppealCreateRequest,
    # US-16：被封禁用户保留申诉救济权，身份解析放行 banned 状态（其余校验不变）
    current_user: UserPrincipal = Depends(get_current_user_allow_banned),
    db: Session = Depends(get_db),
) -> dict:
    """学生提交申诉：自动关联本人最近被执行的处置工单（US-16）。"""
    appeal = service_admin.submit_appeal(db, current_user.id, req.reason)
    return ok(appeal.model_dump(), "申诉已提交，结果将在通知中告知")
