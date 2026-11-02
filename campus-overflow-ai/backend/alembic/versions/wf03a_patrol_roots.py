"""系统巡检根任务范围及去重，不提供执行授权。"""
import sqlalchemy as sa
from alembic import op

revision = "wf03a_patrol_roots"
down_revision = "gl04_job_resume"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "patrol_workflow_tasks",
        sa.Column("task_id", sa.String(36), primary_key=True),
        sa.Column("source_key", sa.String(100), nullable=False, unique=True),
        sa.Column("source_kind", sa.String(20), nullable=False),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("initial_version", sa.String(64), nullable=False),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("agent_run_id", sa.String(64), sa.ForeignKey("agent_runs.agent_run_id"),
                  nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("patrol_workflow_tasks")
