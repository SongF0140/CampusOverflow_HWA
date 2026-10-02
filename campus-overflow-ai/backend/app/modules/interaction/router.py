# interaction 路由层：投票、声誉与榜单接口（学生端接口文档 §6；公开声誉 §2）
# 分层基线 D-9：当前用户一律 UserPrincipal，本层不 import models。
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import get_current_user
from app.core.response import ok
from app.db.session import get_db
from app.modules.interaction import service
from app.modules.interaction.schemas import VoteCreateRequest

votes_router = APIRouter(prefix="/api/votes", tags=["投票"])
reputation_router = APIRouter(prefix="/api/reputation", tags=["声誉"])
# 公开声誉路径属 /api/users/** 命名空间，但挂 interaction（避免 identity→interaction 反向依赖）
public_reputation_router = APIRouter(tags=["声誉"])


@votes_router.post("")
def create_vote(
    req: VoteCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """投票（US-07/E-04）：toggle 语义（重复同方向=取消）；封禁用户已被依赖统一拦截（E-07）。"""
    result = service.vote(
        db, current_user.id, req.target_type, req.target_id, req.value
    )
    return ok(result.model_dump(), "投票成功")


@reputation_router.get("/me")
def my_reputation(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """我的积分与流水（US-08/E-11：流水仅本人可见，未登录 401）。"""
    result = service.my_reputation(db, current_user.id, page, page_size)
    return ok(result.model_dump())


@reputation_router.get("/rank")
def rank(
    period: str = Query("all", pattern="^(week|month|all)$"),
    course_id: int | None = Query(None),
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """积分榜单（US-08）：week/month/all × 课程维度；内存聚合实现（Q-04，无 Redis）。"""
    result = service.rank(db, period, course_id)
    return ok(result.model_dump())


@public_reputation_router.get("/api/users/{user_id}/reputation")
def public_reputation(
    user_id: int,
    _current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """用户公开声誉（US-08）：总分与发帖/回答数，不含流水（E-11）。"""
    result = service.public_reputation(db, user_id)
    return ok(result.model_dump())
