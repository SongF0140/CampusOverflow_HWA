# identity 路由层：入参出参校验、权限依赖注入、调 service、返回统一响应
# 分层基线 D-2：本层不 import models、不触碰 ORM 对象。
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import get_current_user, require_roles
from app.core.response import ok
from app.db.session import get_db
from app.modules.identity import service
from app.modules.identity.schemas import (
    AdminUserBanRequest,
    AssistantCertReviewRequest,
    UserLoginRequest,
    UserRegisterRequest,
    UserUpdateRequest,
)

auth_router = APIRouter(prefix="/api/auth", tags=["认证"])
users_router = APIRouter(prefix="/api/users", tags=["用户"])


@auth_router.post("/register")
def register(req: UserRegisterRequest, db: Session = Depends(get_db)) -> dict:
    """用户注册：默认学生角色。"""
    user = service.register(db, req.username, req.email, req.password)
    return ok(user.model_dump(), "注册成功")


@auth_router.post("/login")
def login(req: UserLoginRequest, db: Session = Depends(get_db)) -> dict:
    """用户登录：支持用户名或邮箱，返回 JWT token。"""
    result = service.login(db, req.account, req.password)
    return ok(result.model_dump(), "登录成功")


@users_router.get("/me")
def get_me(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """获取当前登录用户完整信息（含邮箱）。"""
    user = service.get_me(db, current_user.id)
    return ok(user.model_dump())


@users_router.patch("/me")
def update_me(
    req: UserUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """更新当前用户个人资料。"""
    user = service.update_profile(
        db, current_user.id, req.bio, req.avatar_url, username=req.username,
    )
    return ok(user.model_dump(), "资料更新成功")


# ---------- 助教认证（T-02a，US-20 / Q-07 / E-12）----------
# 注意：列表路由必须注册在 GET /{user_id} 之前，否则被路径参数吞掉返回 422。

@users_router.post("/me/assistant-certification/apply")
def apply_assistant_certification(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """学生申请助教认证：声明研究生身份，进入待审核。"""
    user = service.apply_assistant_certification(db, current_user.id)
    return ok(user.model_dump(), "申请已提交，等待教师审核")


@users_router.get("/assistant-certifications")
def list_assistant_certifications(
    status: str = Query("pending", pattern="^(pending|approved|rejected)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _teacher=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """教师：按认证状态查看助教认证申请列表。"""
    items, total = service.list_assistant_certifications(db, status, page, page_size)
    data = {
        "items": [i.model_dump() for i in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return ok(data)


@users_router.post("/{user_id}/assistant-certification/review")
def review_assistant_certification(
    user_id: int,
    req: AssistantCertReviewRequest,
    teacher=Depends(require_roles("teacher")),
    db: Session = Depends(get_db),
) -> dict:
    """教师：审核助教认证，approve 即时置位助教能力位。"""
    user = service.review_assistant_certification(
        db, teacher.id, user_id, req.action, req.comment
    )
    return ok(user.model_dump(), "审核完成")


@users_router.get("/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)) -> dict:
    """按 ID 查看用户公开信息（不含邮箱，无需登录）。"""
    user = service.get_public(db, user_id)
    return ok(user.model_dump())


# ---------- 管理员接口 ----------

@users_router.get("")
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _admin=Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：分页查看用户列表（完整信息）。"""
    users, total = service.list_users(db, page, page_size)
    data = {
        "items": [u.model_dump() for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return ok(data)


@users_router.post("/{user_id}/ban")
def ban_user(
    user_id: int,
    req: AdminUserBanRequest,
    _admin=Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：封禁用户（记录封禁原因）。"""
    user = service.ban_user(db, user_id, req.reason)
    return ok(user.model_dump(), "用户已封禁")


@users_router.post("/{user_id}/unban")
def unban_user(
    user_id: int,
    _admin=Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：解禁用户。"""
    user = service.unban_user(db, user_id)
    return ok(user.model_dump(), "用户已解禁")
