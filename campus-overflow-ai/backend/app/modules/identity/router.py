# identity 路由层：入参出参校验、权限依赖注入、调 service、返回统一响应
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import get_current_user, require_roles
from app.core.response import ok
from app.db.session import get_db
from app.modules.identity import service
from app.modules.identity.models import User
from app.modules.identity.schemas import (
    AdminUserBanRequest,
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
    UserUpdateRequest,
)

auth_router = APIRouter(prefix="/api/auth", tags=["认证"])
users_router = APIRouter(prefix="/api/users", tags=["用户"])


@auth_router.post("/register")
def register(req: UserRegisterRequest, db: Session = Depends(get_db)) -> dict:
    """用户注册：默认学生角色。"""
    user = service.register(db, req)
    return ok(user.model_dump(), "注册成功")


@auth_router.post("/login")
def login(req: UserLoginRequest, db: Session = Depends(get_db)) -> dict:
    """用户登录：支持用户名或邮箱，返回 JWT token。"""
    result = service.login(db, req.account, req.password)
    return ok(result.model_dump(), "登录成功")


@users_router.get("/me")
def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """获取当前登录用户完整信息（含邮箱）。"""
    return ok(UserResponse.model_validate(current_user).model_dump())


@users_router.patch("/me")
def update_me(
    req: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """更新当前用户个人资料。"""
    user = service.update_profile(db, current_user.id, req)
    return ok(user.model_dump(), "资料更新成功")


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
    _admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：分页查看用户列表（完整信息）。"""
    users, total = service.list_users(db, page, page_size)
    data = {
        "items": [UserResponse.model_validate(u).model_dump() for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return ok(data)


@users_router.post("/{user_id}/ban")
def ban_user(
    user_id: int,
    req: AdminUserBanRequest,
    _admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：封禁用户（记录封禁原因）。"""
    user = service.ban_user(db, user_id, req)
    return ok(user.model_dump(), "用户已封禁")


@users_router.post("/{user_id}/unban")
def unban_user(
    user_id: int,
    _admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：解禁用户。"""
    user = service.unban_user(db, user_id)
    return ok(user.model_dump(), "用户已解禁")
