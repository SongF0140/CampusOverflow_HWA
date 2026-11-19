"""系统来源审批与根任务运行关联，不伪造管理员。"""
import sqlalchemy as sa
from alembic import op

revision = "wf03b_system_approvals"
down_revision = "wf03a_patrol_roots"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("governance_approval_requests") as batch:
        batch.alter_column("requester_id", existing_type=sa.Integer(), nullable=True)
    with op.batch_alter_table("patrol_workflow_tasks") as batch:
        batch.add_column(sa.Column("status", sa.String(20), nullable=False, server_default="active"))
        batch.add_column(sa.Column("workflow_run_id", sa.String(100), nullable=True))
        batch.add_column(sa.Column("stop_reason", sa.String(100), nullable=True))
        batch.create_unique_constraint("uq_patrol_workflow_run", ["workflow_run_id"])


def downgrade():
    connection = op.get_bind()
    if connection.execute(sa.text("SELECT COUNT(*) FROM governance_approval_requests WHERE requester_id IS NULL")).scalar():
        raise RuntimeError("系统申请仍存在，拒绝有损降级")
    with op.batch_alter_table("patrol_workflow_tasks") as batch:
        batch.drop_constraint("uq_patrol_workflow_run", type_="unique")
        batch.drop_column("stop_reason")
        batch.drop_column("workflow_run_id")
        batch.drop_column("status")
    with op.batch_alter_table("governance_approval_requests") as batch:
        batch.alter_column("requester_id", existing_type=sa.Integer(), nullable=False)
