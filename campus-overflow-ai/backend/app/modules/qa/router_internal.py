# qa 内部接口：仅 Agent 服务可读的问答索引与快照候选复核（C-05 白名单，无正文与作者）。
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import CurrentUser
from app.core.response import ok
from app.core.service_auth import ServiceAuth
from app.db.session import get_db
from app.modules.qa import service
from app.modules.qa.schemas import QaCandidatesRequest

router = APIRouter(prefix="/internal/agent/qa-index", tags=["Agent 内部接口"])
# 候选复核必须同时携带服务 token 与用户 Bearer，可见性按当前登录用户裁决
user_router = APIRouter(prefix="/internal/agent/user/qa-index", tags=["Agent 内部接口"])
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/snapshot")
def export_snapshot(
    db: DbSession,
    _trace_id: ServiceAuth,
    cursor: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> dict:
    """按 id 游标导出可见问题；不含正文、作者与内容快照。"""
    items, next_cursor = service.list_index_snapshot(db, cursor, limit)
    return ok({
        "items": [item.model_dump(mode="json") for item in items],
        "next_cursor": next_cursor,
    })


@user_router.post("/candidates")
def review_candidates(
    req: QaCandidatesRequest,
    db: DbSession,
    _trace_id: ServiceAuth,
    _current_user: CurrentUser,
) -> dict:
    """复核夜间快照给出的候选 id：快照不作授权依据，最终可见性由后端返回。

    只返回未软删、未隐藏的问题；带 course_id 时限定该课程。
    """
    items = service.list_index_candidates(db, req.ids, req.course_id)
    return ok({
        "items": [item.model_dump(mode="json") for item in items],
        "total": len(items),
    })
