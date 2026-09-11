# 用户与权限模型：User 承载账号、角色、声誉和封禁状态
from datetime import datetime

from sqlalchemy import String, Integer, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    """平台用户：学生 / 助教 / 教师 / 管理员共用一张表，用 role 区分。"""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # 角色：student / ta / teacher / admin
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="student")
    # 账号状态：active / banned
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    reputation_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bio: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
