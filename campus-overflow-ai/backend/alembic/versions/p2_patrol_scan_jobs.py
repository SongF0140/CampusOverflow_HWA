"""管理员全量扫描任务表（P2）：只存范围、游标、计数与取消标记，不存内容。"""

from alembic import op
import sqlalchemy as sa

revision = "p2_patrol_scan_jobs"
down_revision = "n02_patrol_evidence"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "patrol_scan_jobs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("target_types", sa.JSON(), nullable=False),
        sa.Column("cursor_type", sa.String(20), nullable=True),
        sa.Column("cursor_id", sa.Integer(), nullable=True),
        sa.Column("scanned", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("escalated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("error_summary", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_patrol_scan_jobs_status", "patrol_scan_jobs", ["status"])


def downgrade():
    op.drop_index("ix_patrol_scan_jobs_status", table_name="patrol_scan_jobs")
    op.drop_table("patrol_scan_jobs")
