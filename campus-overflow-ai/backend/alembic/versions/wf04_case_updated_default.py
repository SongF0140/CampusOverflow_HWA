"""补齐旧治理工单迁移遗漏的时间默认值，保证真实MySQL可创建工单。"""

from alembic import op
import sqlalchemy as sa

revision = "wf04_case_updated_default"
down_revision = "wf03b_system_approvals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE moderation_cases SET updated_at=COALESCE(created_at, CURRENT_TIMESTAMP) "
            "WHERE updated_at IS NULL"
        )
    )
    with op.batch_alter_table("moderation_cases") as batch:
        batch.alter_column(
            "updated_at", existing_type=sa.DateTime(), nullable=False, server_default=sa.func.now()
        )


def downgrade() -> None:
    with op.batch_alter_table("moderation_cases") as batch:
        batch.alter_column(
            "updated_at", existing_type=sa.DateTime(), nullable=True, server_default=None
        )
