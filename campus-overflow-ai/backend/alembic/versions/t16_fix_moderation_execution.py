"""fix moderation execution: is_hidden on content + decision_trace on cases

Revision ID: t16_fix_moderation_execution
Revises: t16_add_agent_decision
Create Date: 2026-10-12 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 't16_fix_moderation_execution'  # type: ignore
down_revision: Union[str, None] = 't16_add_agent_decision'  # type: ignore
branch_labels: Union[str, Sequence[str], None] = None  # type: ignore
depends_on: Union[str, Sequence[str], None] = None  # type: ignore


def upgrade() -> None:
    # US-14 治理临时隐藏：与 deleted_at 同不可见但语义为过程性可恢复
    for table_name in ("questions", "answers", "comments"):
        op.add_column(
            table_name,
            sa.Column(
                "is_hidden",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )

    # 追加式决策轨迹：建单首行 + 每次决策追加
    op.add_column(
        "moderation_cases", sa.Column("decision_trace", sa.Text(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("moderation_cases", "decision_trace")
    for table_name in ("comments", "answers", "questions"):
        op.drop_column(table_name, "is_hidden")
