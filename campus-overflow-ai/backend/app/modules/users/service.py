# 用户服务：注册、登录、资料、封禁等业务规则与事务
from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.modules.users.models import User
from app.modules.users.schemas import (
    AdminUserBanRequest,
    LoginResponse,
    UserPublicResponse,
    UserRegisterRequest,
    UserResponse,
    UserUpdateRequest,
)


class UserService:
    """用户业务逻辑层：权限校验、密码处理、事务一致性都在这里。"""

    def __init__(self, db: Session):
        self.db = db

    def register(self, req: UserRegisterRequest) -> UserResponse:
        """用户注册：校验用户名/邮箱唯一，哈希密码后入库。"""
        existing = self.db.query(User).filter(
            or_(User.username == req.username, User.email == req.email)
        ).first()
        if existing:
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
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return UserResponse.model_validate(user)

    def login(self, account: str, password: str) -> LoginResponse:
        """登录：支持用户名或邮箱，校验密码后签发 JWT。"""
        user = self.db.query(User).filter(
            or_(User.username == account, User.email == account)
        ).first()
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

    def get_by_id(self, user_id: int) -> User:
        """按 ID 查询用户，不存在返回 404。"""
        user = self.db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
        return user

    def get_public(self, user_id: int) -> UserPublicResponse:
        """获取用户公开信息（不含邮箱）。"""
        user = self.get_by_id(user_id)
        return UserPublicResponse.model_validate(user)

    def get_full(self, user_id: int) -> UserResponse:
        """获取用户完整信息（含邮箱，仅本人/管理员）。"""
        user = self.get_by_id(user_id)
        return UserResponse.model_validate(user)

    def update_profile(self, user_id: int, req: UserUpdateRequest) -> UserResponse:
        """更新个人资料：只能改自己的 bio 和 avatar_url。"""
        user = self.get_by_id(user_id)
        if req.bio is not None:
            user.bio = req.bio
        if req.avatar_url is not None:
            user.avatar_url = req.avatar_url
        self.db.commit()
        self.db.refresh(user)
        return UserResponse.model_validate(user)

    def ban_user(self, user_id: int, req: AdminUserBanRequest) -> UserResponse:
        """管理员封禁用户：记录封禁原因，被封禁用户不能发帖、回答、评论、投票。"""
        user = self.get_by_id(user_id)
        if user.role == "admin":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="不能封禁管理员账号",
            )
        user.status = "banned"
        user.ban_reason = req.reason
        self.db.commit()
        self.db.refresh(user)
        return UserResponse.model_validate(user)

    def unban_user(self, user_id: int) -> UserResponse:
        """管理员解禁用户：清空封禁原因。"""
        user = self.get_by_id(user_id)
        user.status = "active"
        user.ban_reason = None
        self.db.commit()
        self.db.refresh(user)
        return UserResponse.model_validate(user)

    def list_users(self, page: int = 1, page_size: int = 20) -> tuple[list[User], int]:
        """管理员分页查看用户列表（返回完整信息）。"""
        offset = (page - 1) * page_size
        query = self.db.query(User)
        total = query.count()
        users = query.order_by(User.id.asc()).offset(offset).limit(page_size).all()
        return users, total
