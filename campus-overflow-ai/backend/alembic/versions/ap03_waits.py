"""审批持久等待检查点。"""
from alembic import op
import sqlalchemy as sa

revision = "ap03_waits"
down_revision = "tw02_assistant_cert"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "approval_waits",
        sa.Column("request_id", sa.String(36), primary_key=True),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("moderation_cases.id"), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(20), nullable=False, server_default="waiting"),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_approval_waits_user_id", "approval_waits", ["user_id"])


def downgrade() -> None:
    op.drop_table("approval_waits")
