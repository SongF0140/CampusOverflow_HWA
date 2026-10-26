"""add course knowledge tree and teaching plan tables

Revision ID: k01_knowledge_tree
Revises: g04_run_events
"""

from alembic import op
import sqlalchemy as sa

revision = "k01_knowledge_tree"
down_revision = "g04_run_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_knowledge_nodes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("sort_key", sa.String(100), nullable=False),
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("course_knowledge_nodes.id"),
            nullable=True,
        ),
        sa.Column("position", sa.String(5), nullable=True),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("course_id", "sort_key", name="uq_course_knowledge_sort_key"),
    )
    op.create_table(
        "teaching_plan_items",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "course_id",
            sa.Integer(),
            sa.ForeignKey("courses.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("detail", sa.String(2000), nullable=True),
        sa.Column("source", sa.String(10), nullable=False),
        # 周报软引用（teacher_weekly_reports.id，K-02 建表），不建外键避免迁移顺序耦合
        sa.Column("report_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("teaching_plan_items")
    op.drop_table("course_knowledge_nodes")
