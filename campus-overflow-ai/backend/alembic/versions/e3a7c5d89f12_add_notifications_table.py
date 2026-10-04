"""add notifications table

Revision ID: e3a7c5d89f12
Revises: ac5af405a45e
Create Date: 2026-10-03 02:10:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e3a7c5d89f12'
down_revision: str | None = 'ac5af405a45e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 通知表（T-10）：recipient 列表/未读数为主查询路径，两个复合索引与模型一致
    op.create_table('notifications',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('recipient_id', sa.Integer(), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('link', sa.String(length=255), nullable=False),
    sa.Column('is_read', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['recipient_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_notifications_recipient_created', 'notifications',
                    ['recipient_id', 'created_at', 'id'], unique=False)
    op.create_index('ix_notifications_recipient_unread', 'notifications',
                    ['recipient_id', 'is_read', 'created_at', 'id'], unique=False)


def downgrade() -> None:
    op.drop_table('notifications')
