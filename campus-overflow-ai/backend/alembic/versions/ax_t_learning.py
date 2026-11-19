"""可信课程标签来源与匿名学习事件。

Revision ID: ax_t_learning
Revises: ap03_waits
"""

import sqlalchemy as sa
from alembic import op

revision = "ax_t_learning"
down_revision = "ap03_waits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_tag_sources",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("tag_id", sa.Integer(), sa.ForeignKey("tags.id"), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("source_ref", sa.String(500)),
        sa.Column("maintained_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("course_id", "tag_id", name="uq_course_tag_source"),
    )
    op.create_index("ix_course_tag_sources_course_id", "course_tag_sources", ["course_id"])
    op.create_table(
        "anonymous_learning_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("event_id", sa.String(36), nullable=False, unique=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("tag_ids", sa.JSON(), nullable=False),
        sa.Column("knowledge_node_ids", sa.JSON(), nullable=False),
        sa.Column("question_id", sa.Integer()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_anonymous_learning_events_course_id", "anonymous_learning_events", ["course_id"])
    op.create_index("ix_anonymous_learning_events_created_at", "anonymous_learning_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("anonymous_learning_events")
    op.drop_table("course_tag_sources")
