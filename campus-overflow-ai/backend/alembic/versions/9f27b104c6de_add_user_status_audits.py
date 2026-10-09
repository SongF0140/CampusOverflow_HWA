"""新增封禁与解禁持久审计历史。

Revision ID: 9f27b104c6de
Revises: 5d17479735ac
"""
import sqlalchemy as sa
from alembic import op

revision = "9f27b104c6de"
down_revision = "5d17479735ac"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_status_audits",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("target_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("previous_status", sa.String(20), nullable=False),
        sa.Column("new_status", sa.String(20), nullable=False),
        sa.Column("previous_reason", sa.String(200), nullable=True),
        sa.Column("new_reason", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("action IN ('ban', 'unban')", name="ck_user_status_audit_action"),
    )
    op.create_index(
        "ix_user_status_audits_target_time", "user_status_audits",
        ["target_user_id", "created_at", "id"],
    )
    op.create_index(
        "ix_user_status_audits_actor_time", "user_status_audits",
        ["actor_id", "created_at", "id"],
    )


def downgrade() -> None:
    # 降级会删除审计历史；本次验证不自动执行降级。
    op.drop_table("user_status_audits")
