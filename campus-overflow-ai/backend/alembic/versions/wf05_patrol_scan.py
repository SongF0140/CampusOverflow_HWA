"""持久保存业务发现页及确认游标，不保存Workflow执行状态。"""

from alembic import op
import sqlalchemy as sa

revision = "wf05_patrol_scan"
down_revision = "wf04_case_updated_default"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "patrol_workflow_scans",
        sa.Column("scan_id", sa.String(32), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
    )


def downgrade():
    op.drop_table("patrol_workflow_scans")
