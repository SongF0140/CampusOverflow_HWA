"""add nullable user ownership snapshot to agent runs

Revision ID: g04_run_owner
Revises: t16_fix_moderation_execution
"""

from alembic import op
import sqlalchemy as sa

revision = "g04_run_owner"
down_revision = "t16_fix_moderation_execution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_index("ix_agent_runs_user_id", "agent_runs", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_agent_runs_user_id", table_name="agent_runs")
    op.drop_column("agent_runs", "user_id")
