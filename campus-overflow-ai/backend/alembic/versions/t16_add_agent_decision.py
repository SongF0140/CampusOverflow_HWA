"""add agent decision fields to moderation_cases

Revision ID: t16_add_agent_decision
Revises: 0a3d5b7e8c9c3
Create Date: 2026-10-11 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 't16_add_agent_decision'  # type: ignore
down_revision: Union[str, None] = '9f27b104c6de'  # type: ignore
branch_labels: Union[str, Sequence[str], None] = None  # type: ignore
depends_on: Union[str, Sequence[str], None] = None  # type: ignore


def upgrade() -> None:
    # 新增 manager_feedback
    op.add_column('moderation_cases', sa.Column('manager_feedback', sa.Text(), nullable=True))

    # 新增 agent_decision
    op.add_column('moderation_cases', sa.Column('agent_decision', sa.Text(), nullable=True))

    # 新增 decision_source
    op.add_column('moderation_cases', sa.Column('decision_source', sa.String(20), nullable=True))

    # 新增 updated_at
    op.add_column('moderation_cases', sa.Column('updated_at', sa.DateTime(), nullable=True))

    # 创建 decision_source 索引
    op.create_index('ix_moderation_cases_decision_source', 'moderation_cases', ['decision_source'])

    # 创建 updated_at 索引
    op.create_index('ix_moderation_cases_updated_at', 'moderation_cases', ['updated_at'])


def downgrade() -> None:
    # 移除索引
    op.drop_index('ix_moderation_cases_updated_at', table_name='moderation_cases')
    op.drop_index('ix_moderation_cases_decision_source', table_name='moderation_cases')

    # 移除字段
    op.drop_column('moderation_cases', 'updated_at')
    op.drop_column('moderation_cases', 'decision_source')
    op.drop_column('moderation_cases', 'agent_decision')
    op.drop_column('moderation_cases', 'manager_feedback')
