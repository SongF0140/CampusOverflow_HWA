"""增量审计迁移在隔离库上的结构验证，不删除现有业务表。"""
import runpy
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_audit_incremental_upgrade_preserves_users() -> None:
    migration = runpy.run_path(str(
        Path(__file__).resolve().parents[1]
        / "alembic/versions/9f27b104c6de_add_user_status_audits.py"
    ))
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("INSERT INTO users (id) VALUES (7)")
        with Operations.context(MigrationContext.configure(connection)):
            migration["upgrade"]()
        inspector = sa.inspect(connection)
        columns = {column["name"]: column for column in inspector.get_columns("user_status_audits")}
        assert set(columns) == {
            "id", "actor_id", "target_user_id", "action", "previous_status", "new_status",
            "previous_reason", "new_reason", "created_at",
        }
        assert columns["created_at"]["nullable"] is False
        assert columns["previous_reason"]["nullable"] is True
        indexes = inspector.get_indexes("user_status_audits")
        assert {tuple(index["column_names"]) for index in indexes} == {
            ("actor_id", "created_at", "id"), ("target_user_id", "created_at", "id"),
        }
        foreign_keys = inspector.get_foreign_keys("user_status_audits")
        assert {tuple(fk["constrained_columns"]) for fk in foreign_keys} == {
            ("actor_id",), ("target_user_id",),
        }
        assert connection.exec_driver_sql("SELECT id FROM users").scalar_one() == 7
        count = connection.exec_driver_sql("SELECT COUNT(*) FROM user_status_audits").scalar_one()
        assert count == 0
    engine.dispose()
