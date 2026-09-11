# 用户路由：当前用户信息、资料编辑、管理员用户治理
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user, get_db, require_roles
from app.modules.users.models import User
from app.modules.users.schemas import AdminUserBanRequest, UserResponse, UserUpdateRequest
from app.modules.users.service import UserService
from app.shared.response import ok

router = APIRouter(prefix="/api/users", tags=["用户"])


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)) -> dict:
    """获取当前登录用户信息。"""
    return ok(UserResponse.model_validate(current_user).model_dump())


@router.patch("/me")
def update_me(
    req: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """更新当前用户个人资料。"""
    service = UserService(db)
    user = service.update_profile(current_user.id, req)
    return ok(user.model_dump(), "资料更新成功")


@router.get("/{user_id}")
def get_user(user_id: int, db: Session = Depends(get_db)) -> dict:
    """按 ID 查看用户公开信息。"""
    service = UserService(db)
    user = service.get_by_id(user_id)
    return ok(UserResponse.model_validate(user).model_dump())


# ---------- 管理员接口 ----------

@router.get("")
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：分页查看用户列表。"""
    service = UserService(db)
    users, total = service.list_users(page, page_size)
    data = {
        "items": [UserResponse.model_validate(u).model_dump() for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return ok(data)


@router.post("/{user_id}/ban")
def ban_user(
    user_id: int,
    req: AdminUserBanRequest,
    _admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：封禁用户。"""
    service = UserService(db)
    user = service.ban_user(user_id, req)
    return ok(user.model_dump(), "用户已封禁")


@router.post("/{user_id}/unban")
def unban_user(
    user_id: int,
    _admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """管理员：解禁用户。"""
    service = UserService(db)
    user = service.unban_user(user_id)
    return ok(user.model_dump(), "用户已解禁")
