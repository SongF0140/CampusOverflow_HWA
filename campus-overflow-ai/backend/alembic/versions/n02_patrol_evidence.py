"""巡检笔记增加证据计数（N-3 规则提升门槛）。

只有 evidence_count ≥ 2 的笔记才允许注入；旧数据默认 1，保持不可注入。
"""

from alembic import op
import sqlalchemy as sa

revision = "n02_patrol_evidence"
down_revision = "n01_patrol_notes"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "patrol_notes",
        sa.Column(
            "evidence_count", sa.Integer(), nullable=False, server_default="1",
        ),
    )


def downgrade():
    op.drop_column("patrol_notes", "evidence_count")
