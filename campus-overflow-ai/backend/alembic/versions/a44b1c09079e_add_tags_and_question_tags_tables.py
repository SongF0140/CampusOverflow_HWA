"""add tags and question_tags tables

Revision ID: a44b1c09079e
Revises: 7d3e9c4a1b52
Create Date: 2026-10-02 16:34:20.647329

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a44b1c09079e'
down_revision: str | None = '7d3e9c4a1b52'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('tags',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('name', sa.String(length=50), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False, server_default='custom'),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    # 唯一性由 ix_tags_name 唯一索引承担（与模型 unique=True, index=True 对齐，
    # 不另建 UniqueConstraint，避免 MySQL 下产生冗余的同义索引）
    op.create_index(op.f('ix_tags_name'), 'tags', ['name'], unique=True)

    op.create_table('question_tags',
    sa.Column('question_id', sa.Integer(), nullable=False),
    sa.Column('tag_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['question_id'], ['questions.id'], ),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ),
    sa.PrimaryKeyConstraint('question_id', 'tag_id'),
    sa.UniqueConstraint('question_id', 'tag_id', name='uq_question_tags_pair')
    )
    op.create_index(op.f('ix_question_tags_tag_id'), 'question_tags', ['tag_id'], unique=False)


def downgrade() -> None:
    # question_tags 的 tag_id 索引被 FK 依赖（MySQL 1553），随整表删除，不单独 drop
    op.drop_table('question_tags')
    op.drop_index(op.f('ix_tags_name'), table_name='tags')
    op.drop_table('tags')
