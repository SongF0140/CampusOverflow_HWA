# 用户模块 Pydantic Schema：请求入参与响应出参
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


# ---------- 请求 Schema ----------

class UserRegisterRequest(BaseModel):
    """注册请求：用户名、邮箱、密码。"""
    username: str = Field(..., min_length=3, max_length=50, description="用户名，3-50字符")
    email: EmailStr = Field(..., max_length=100, description="邮箱")
    password: str = Field(..., min_length=6, max_length=100, description="密码，至少6位")


class UserLoginRequest(BaseModel):
    """登录请求：支持用户名或邮箱登录。"""
    account: str = Field(..., description="用户名或邮箱")
    password: str = Field(..., description="密码")


class UserUpdateRequest(BaseModel):
    """更新个人资料：可选字段。"""
    bio: str | None = Field(None, max_length=500, description="个人简介")
    avatar_url: str | None = Field(None, max_length=255, description="头像URL")


class AdminUserBanRequest(BaseModel):
    """管理员封禁用户请求。"""
    reason: str = Field(..., max_length=200, description="封禁原因")


# ---------- 响应 Schema ----------

class UserPublicResponse(BaseModel):
    """用户公开信息：任何人可查看，不含邮箱等隐私字段。"""
    id: int
    username: str
    role: str
    status: str
    reputation_score: int
    bio: str | None = None
    avatar_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserResponse(BaseModel):
    """用户完整信息：本人或管理员可见，包含邮箱。"""
    id: int
    username: str
    email: str
    role: str
    status: str
    ban_reason: str | None = None
    reputation_score: int
    bio: str | None = None
    avatar_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    """登录成功响应：token + 用户完整信息。"""
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
