"""全量扫描活动任务唯一槽位：用数据库唯一索引保证同刻仅一个活动任务。"""

from alembic import op
import sqlalchemy as sa

revision = "p2_scan_active_slot"
down_revision = "p2_patrol_scan_jobs"
branch_labels = None
depends_on = None

SLOT_INDEX = "uq_patrol_scan_jobs_active_slot"


def upgrade():
    op.add_column(
        "patrol_scan_jobs",
        sa.Column("active_slot", sa.String(20), nullable=True),
    )
    # 已有活动任务占用槽位；若历史数据中已存在多个活动任务，唯一索引会拒绝迁移，
    # 需要先人工确认并收敛到一个任务，不能静默改写业务状态。
    op.execute(
        "UPDATE patrol_scan_jobs SET active_slot = 'patrol_scan' "
        "WHERE status IN ('queued', 'running')"
    )
    op.create_index(SLOT_INDEX, "patrol_scan_jobs", ["active_slot"], unique=True)


def downgrade():
    op.drop_index(SLOT_INDEX, table_name="patrol_scan_jobs")
    op.drop_column("patrol_scan_jobs", "active_slot")
