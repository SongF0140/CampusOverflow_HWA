"""获批执行的最小确定性续接。"""
from alembic import op
import sqlalchemy as sa

revision = "gl04_job_resume"
down_revision = "gl01_approval_v2"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("governance_execution_jobs", sa.Column("continuation", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("governance_execution_jobs", "continuation")
