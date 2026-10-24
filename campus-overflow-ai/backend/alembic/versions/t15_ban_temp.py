"""add banned_until column for temporary bans

Revision ID: t15_ban_temp
Revises: k02_weekly_reports
"""

from alembic import op
import sqlalchemy as sa

revision = "t15_ban_temp"
down_revision = "k02_weekly_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("banned_until", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "banned_until")
