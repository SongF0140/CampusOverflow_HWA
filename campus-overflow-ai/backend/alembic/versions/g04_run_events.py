"""add append-only plan and step metadata events"""

from alembic import op
import sqlalchemy as sa

revision = "g04_run_events"
down_revision = "g04_run_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_run_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "agent_run_id", sa.String(64), sa.ForeignKey("agent_runs.agent_run_id"), nullable=False
        ),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("plan_revision", sa.Integer(), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=True),
        sa.Column("step_id", sa.String(20), nullable=True),
        sa.Column("tool_name", sa.String(100), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("agent_run_id", "sequence_no", name="uq_run_event_sequence"),
    )
    op.create_index("ix_agent_run_events_agent_run_id", "agent_run_events", ["agent_run_id"])


def downgrade() -> None:
    op.drop_table("agent_run_events")
