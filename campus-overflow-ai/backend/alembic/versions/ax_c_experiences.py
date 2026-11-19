"""回答流程经验建议与教师发布。

Revision ID: ax_c_experiences
Revises: ax_t_learning
"""

import sqlalchemy as sa
from alembic import op

revision = "ax_c_experiences"
down_revision = "ax_t_learning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_experiences",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("proposal_id", sa.String(36), nullable=False, unique=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("proposed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("summary", sa.String(1000), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("agent_run_id", sa.String(64), nullable=False),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_agent_experiences_course_id", "agent_experiences", ["course_id"])
    op.create_index("ix_agent_experiences_status", "agent_experiences", ["status"])


def downgrade() -> None:
    op.drop_index("ix_agent_experiences_status", table_name="agent_experiences")
    op.drop_index("ix_agent_experiences_course_id", table_name="agent_experiences")
    op.drop_table("agent_experiences")
