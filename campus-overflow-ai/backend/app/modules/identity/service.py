# identity 业务层：用例编排、业务规则与事务边界（事务只在这一层）
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.modules.identity import repository
from app.modules.identity.models import User
from app.modules.identity.schemas import (
    AdminUserBanRequest,
    LoginResponse,
    UserPublicResponse,
    UserRegisterRequest,
    UserResponse,
    UserUpdateRequest,
)


def register(db: Session, req: UserRegisterRequest) -> UserResponse:
    """用户注册：校验用户名/邮箱唯一，哈希密码后入库，默认学生角色。"""
    if repository.username_or_email_exists(db, req.username, req.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="用户名或邮箱已被注册",
        )
    user = User(
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
        role="student",
        status="active",
    )
    user = repository.save(db, user)
    return UserResponse.model_validate(user)


def login(db: Session, account: str, password: str) -> LoginResponse:
    """登录：支持用户名或邮箱，校验密码后签发 JWT；封禁账号拒绝登录。"""
    user = repository.find_by_account(db, account)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="账号或密码错误",
        )
    if user.status == "banned":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="账号已被封禁，请联系管理员",
        )
    token = create_access_token(user.id, user.role)
    return LoginResponse(access_token=token, user=UserResponse.model_validate(user))


def get_by_id(db: Session, user_id: int) -> User:
    """按 ID 查询用户，不存在返回 404。"""
    user = repository.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
    return user


def get_public(db: Session, user_id: int) -> UserPublicResponse:
    """获取用户公开信息（不含邮箱）。"""
    return UserPublicResponse.model_validate(get_by_id(db, user_id))


def update_profile(db: Session, user_id: int, req: UserUpdateRequest) -> UserResponse:
    """更新个人资料：只能改自己的 bio 和 avatar_url。"""
    user = get_by_id(db, user_id)
    if req.bio is not None:
        user.bio = req.bio
    if req.avatar_url is not None:
        user.avatar_url = req.avatar_url
    user = repository.save(db, user)
    return UserResponse.model_validate(user)


def ban_user(db: Session, user_id: int, req: AdminUserBanRequest) -> UserResponse:
    """管理员封禁用户：记录封禁原因，被封禁用户不能登录与写互动。"""
    user = get_by_id(db, user_id)
    if user.role == "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="不能封禁管理员账号",
        )
    user.status = "banned"
    user.ban_reason = req.reason
    user = repository.save(db, user)
    return UserResponse.model_validate(user)


def unban_user(db: Session, user_id: int) -> UserResponse:
    """管理员解禁用户：清空封禁原因。"""
    user = get_by_id(db, user_id)
    user.status = "active"
    user.ban_reason = None
    user = repository.save(db, user)
    return UserResponse.model_validate(user)


def list_users(db: Session, page: int = 1, page_size: int = 20) -> tuple[list[User], int]:
    """管理员分页查看用户列表（返回完整信息）。"""
    return repository.list_users(db, page, page_size)
