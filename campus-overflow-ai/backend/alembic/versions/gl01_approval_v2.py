"""版本化治理批准与待执行任务；不迁移旧工单为新任务。"""

import sqlalchemy as sa
from alembic import op

revision = "gl01_approval_v2"
down_revision = "ax_role_commands"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "governance_approval_requests",
        sa.Column("request_id", sa.String(36), primary_key=True),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("moderation_cases.id"), nullable=False),
        sa.Column("contract_version", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("requester_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("source_kind", sa.String(20), nullable=False),
        sa.Column("source_key_hash", sa.String(64), nullable=True),
        sa.Column("frozen_call", sa.JSON(), nullable=False),
        sa.Column("args_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("review_note", sa.String(500), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column(
            "agent_run_id", sa.String(64), sa.ForeignKey("agent_runs.agent_run_id"), nullable=False
        ),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("case_id", name="uq_governance_approval_requests_case_id"),
    )
    op.create_index(
        "ix_governance_approval_requests_status", "governance_approval_requests", ["status"]
    )
    op.create_table(
        "governance_execution_jobs",
        sa.Column("execution_id", sa.String(36), primary_key=True),
        sa.Column(
            "request_id",
            sa.String(36),
            sa.ForeignKey("governance_approval_requests.request_id"),
            nullable=False,
        ),
        sa.Column("state", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("lease_hash", sa.String(64), nullable=True),
        sa.Column("lease_epoch", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("request_id", name="uq_governance_execution_jobs_request_id"),
    )
    op.create_index("ix_governance_execution_jobs_state", "governance_execution_jobs", ["state"])


def downgrade() -> None:
    op.drop_table("governance_execution_jobs")
    op.drop_table("governance_approval_requests")
