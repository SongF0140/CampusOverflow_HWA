# 用户模型：账号、角色、声誉与封禁状态
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    """平台用户：学生 / 教师 / 管理员共用一张表，用 role 区分。

    助教不是独立角色（spec v3）：研究生身份 + 助教认证通过 = 助教能力位，
    身份与认证字段随 T-02a 迁移落库。
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(
        String(100), unique=True, nullable=False, index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # 角色：student / teacher / admin
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="student")
    # 账号状态：active / banned
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    # 封禁原因（仅 status=banned 时有值，解禁时清空）
    ban_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reputation_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bio: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 身份类型：undergraduate / postgraduate（T-02a，Q-07：研究生不是独立角色）
    identity_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="undergraduate"
    )
    # 助教认证状态：none / pending / approved / rejected（能力位仅看 approved）
    assistant_cert_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="none"
    )
    assistant_cert_applied_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    # 审核留痕（教师端接口文档 §3：操作者/时间/结果，结果即 cert_status）
    assistant_cert_reviewed_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    assistant_cert_reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class UserStatusAudit(Base):
    """封禁与解禁的追加式历史，业务层不提供更新或删除入口。"""

    __tablename__ = "user_status_audits"
    __table_args__ = (
        CheckConstraint("action IN ('ban', 'unban')", name="ck_user_status_audit_action"),
        Index("ix_user_status_audits_target_time", "target_user_id", "created_at", "id"),
        Index("ix_user_status_audits_actor_time", "actor_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    target_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    previous_status: Mapped[str] = mapped_column(String(20), nullable=False)
    new_status: Mapped[str] = mapped_column(String(20), nullable=False)
    previous_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    new_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # MySQL DATETIME 无时区且精度为秒，应用侧截到秒，避免服务端舍入成未来时间。
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False,
        default=lambda: datetime.now(UTC).replace(tzinfo=None, microsecond=0),
    )
