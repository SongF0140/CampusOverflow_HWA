"""新增夜间离线整理巡检笔记表（N-1/N-2，系统级治理审计）。

只存脱敏摘要与来源引用，不存内容原文、凭证或隐私（C-07）；
与个人记忆表分开；note_key 唯一作为幂等键。
"""

from alembic import op
import sqlalchemy as sa

revision = "n01_patrol_notes"
down_revision = "wf05_patrol_scan"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "patrol_notes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("note_key", sa.String(160), nullable=False),
        sa.Column("note_type", sa.String(30), nullable=False),
        sa.Column("source_case_id", sa.Integer(), nullable=True),
        sa.Column("target_type", sa.String(20), nullable=True),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("rule_version", sa.String(40), nullable=False),
        sa.Column("model_version", sa.String(60), nullable=False),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column("confidence", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("valid_until", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("trace_id", sa.String(64), nullable=False),
        sa.Column("agent_run_id", sa.String(64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.UniqueConstraint("note_key", name="uq_patrol_notes_note_key"),
        sa.ForeignKeyConstraint(
            ["source_case_id"], ["moderation_cases.id"],
            name="fk_patrol_notes_source_case_id",
        ),
    )
    op.create_index("ix_patrol_notes_note_type", "patrol_notes", ["note_type"])
    op.create_index("ix_patrol_notes_source_case_id", "patrol_notes", ["source_case_id"])
    op.create_index("ix_patrol_notes_valid_until", "patrol_notes", ["valid_until"])
    op.create_index("ix_patrol_notes_status", "patrol_notes", ["status"])


def downgrade():
    op.drop_index("ix_patrol_notes_status", table_name="patrol_notes")
    op.drop_index("ix_patrol_notes_valid_until", table_name="patrol_notes")
    op.drop_index("ix_patrol_notes_source_case_id", table_name="patrol_notes")
    op.drop_index("ix_patrol_notes_note_type", table_name="patrol_notes")
    op.drop_table("patrol_notes")
