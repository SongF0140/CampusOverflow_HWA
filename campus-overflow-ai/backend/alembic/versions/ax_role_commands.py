"""教师确认班级变更。"""
import sqlalchemy as sa
from alembic import op

revision = "ax_role_commands"
down_revision = "ax_c_experiences"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("class_change_requests",
        sa.Column("request_id", sa.String(36), primary_key=True),
        sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id"), nullable=False),
        sa.Column("action", sa.String(20), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_class_change_requests_teacher_id", "class_change_requests", ["teacher_id"])
    op.create_index("ix_class_change_requests_course_id", "class_change_requests", ["course_id"])


def downgrade() -> None:
    op.drop_table("class_change_requests")
