"""新增独立助教优质回答认证标记。

Revision ID: tw02_assistant_cert
Revises: t15_ban_temp
"""

import sqlalchemy as sa
from alembic import op

revision = "tw02_assistant_cert"
down_revision = "t15_ban_temp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "answers", sa.Column("certified_by_assistant", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("answers", "certified_by_assistant")
