"""全量扫描 worker 认领与租约：跨 Agent 实例只允许一个 worker 推进同一任务。"""

from alembic import op
import sqlalchemy as sa

revision = "p2_scan_worker_lease"
down_revision = "p2_scan_active_slot"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "patrol_scan_jobs",
        sa.Column("worker_id", sa.String(64), nullable=True),
    )
    op.add_column(
        "patrol_scan_jobs",
        sa.Column("worker_token", sa.String(64), nullable=True),
    )
    op.add_column(
        "patrol_scan_jobs",
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_column("patrol_scan_jobs", "lease_expires_at")
    op.drop_column("patrol_scan_jobs", "worker_token")
    op.drop_column("patrol_scan_jobs", "worker_id")
