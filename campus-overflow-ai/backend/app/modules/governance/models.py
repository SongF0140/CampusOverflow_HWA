# 治理模型：审核工单（ModerationCase）与申诉（Appeal）——本期仅建表，二期启用
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ModerationCase(Base):
    """审核工单：由 Agent 或管理员创建，记录目标内容快照与处置状态。

    约束（宪法 C-06）：Agent 无法直接隐藏/删除/封号，只能创建工单，
    全部处置动作由管理员在本表留痕。
    """

    __tablename__ = "moderation_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 目标内容：question / answer / comment / user
    target_type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # 风险分级：low（仅打标）/ mid / high（建工单）
    risk_level: Mapped[str] = mapped_column(String(20), nullable=False, default="low")
    # 创建来源：agent / admin
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="admin")
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    # 目标内容快照（JSON 文本），保证处置时内容可追溯（E-10）
    snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 状态：pending（待处理）/ resolved（已处置）
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    # 处置动作：ignore / edit / hide / delete / warn / ban_temp / ban_perm
    resolution: Mapped[str | None] = mapped_column(String(20), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 追踪字段（二期 Agent 接入后启用）
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    agent_run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )


class Appeal(Base):
    """申诉：被封禁/被处置用户对工单结果发起复核（US-16）。"""

    __tablename__ = "appeals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("moderation_cases.id"), nullable=False, index=True
    )
    # 申诉人（即被处置用户）
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    # 状态：pending / accepted（撤销处置）/ rejected（维持处置）
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    resolution_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
