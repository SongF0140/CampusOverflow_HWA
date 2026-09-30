# identity 业务层：用例编排、事务边界与授权决策
# 分层基线 D-1/D-2/D-3：规则在 domain.py，ORM 留在 repository，本层不碰 HTTP 协议。
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.modules.identity import domain, repository
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
        raise domain.AccountExistsError()
    return repository.create_user(
        db,
        username=req.username,
        email=req.email,
        password_hash=hash_password(req.password),
    )


def login(db: Session, account: str, password: str) -> LoginResponse:
    """登录：支持用户名或邮箱，校验密码后签发 JWT；封禁账号拒绝登录。"""
    user = repository.find_auth_by_account(db, account)
    if not user or not verify_password(password, user.password_hash):
        raise domain.WrongCredentialsError()
    domain.ensure_not_banned(user.status)
    token = create_access_token(user.id, user.role)
    return LoginResponse(access_token=token, user=UserResponse.model_validate(user))


def get_by_id(db: Session, user_id: int) -> UserResponse:
    """按 ID 查询用户，不存在抛 UserNotFoundError。"""
    user = repository.get_by_id(db, user_id)
    if not user:
        raise domain.UserNotFoundError()
    return user


def get_me(db: Session, user_id: int) -> UserResponse:
    """获取当前登录用户完整信息（含邮箱）。"""
    return get_by_id(db, user_id)


def get_public(db: Session, user_id: int) -> UserPublicResponse:
    """获取用户公开信息（不含邮箱）。"""
    return UserPublicResponse.model_validate(get_by_id(db, user_id))


def update_profile(db: Session, user_id: int, req: UserUpdateRequest) -> UserResponse:
    """更新个人资料：只能改自己的 bio 和 avatar_url。"""
    get_by_id(db, user_id)  # 不存在则 404
    return repository.update_profile(db, user_id, req.bio, req.avatar_url)


def ban_user(db: Session, user_id: int, req: AdminUserBanRequest) -> UserResponse:
    """管理员封禁用户：记录封禁原因，被封禁用户不能登录与写互动。"""
    user = get_by_id(db, user_id)
    domain.ensure_can_ban(user.role)
    return repository.set_banned(db, user_id, req.reason)


def unban_user(db: Session, user_id: int) -> UserResponse:
    """管理员解禁用户：清空封禁原因。"""
    get_by_id(db, user_id)  # 不存在则 404
    return repository.set_active(db, user_id)


def list_users(db: Session, page: int = 1, page_size: int = 20) -> tuple[list[UserResponse], int]:
    """管理员分页查看用户列表（返回完整信息）。"""
    return repository.list_users(db, page, page_size)
