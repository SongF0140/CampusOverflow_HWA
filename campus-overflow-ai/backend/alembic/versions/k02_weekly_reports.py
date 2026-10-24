"""add teacher weekly reports table

Revision ID: k02_weekly_reports
Revises: k01_knowledge_tree
"""

from alembic import op
import sqlalchemy as sa

revision = "k02_weekly_reports"
down_revision = "k01_knowledge_tree"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "teacher_weekly_reports",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("week_end", sa.Date(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("uncovered_topics", sa.JSON(), nullable=False),
        sa.Column("heatmap", sa.JSON(), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False),
        sa.Column("agent_run_id", sa.String(64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("course_id", "week_start", name="uq_weekly_report_course_week"),
    )


def downgrade() -> None:
    op.drop_table("teacher_weekly_reports")
