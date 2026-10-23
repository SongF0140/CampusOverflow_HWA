"""在隔离 SQLite 前置表上验证本次增量迁移，保留既有审计记录。"""

from pathlib import Path

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.config import settings


def test_run_owner_migration_preserves_legacy_rows(tmp_path: Path, monkeypatch) -> None:
    url = f"sqlite:///{(tmp_path / 'g04_migration.sqlite').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    engine = create_engine(url)
    # 目标表升级前的真实字段；只验证本次增量，不假称 SQLite 支持整个 MySQL 历史链。
    with engine.begin() as connection:
        connection.execute(
            text("""
            CREATE TABLE agent_runs (
                id INTEGER PRIMARY KEY,
                task_type VARCHAR(50) NOT NULL,
                trace_id VARCHAR(64) NOT NULL,
                agent_run_id VARCHAR(64) NOT NULL UNIQUE,
                input_summary TEXT NOT NULL,
                output_summary TEXT,
                error_summary TEXT,
                status VARCHAR(20) NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        )
        connection.execute(
            text("""
            INSERT INTO agent_runs (task_type, trace_id, agent_run_id, input_summary, status)
            VALUES ('chat', 'legacy-trace', 'legacy-run', 'legacy summary', 'succeeded')
        """)
        )
    config = Config("alembic.ini")
    command.stamp(config, "t16_fix_moderation_execution")
    command.upgrade(config, "g04_run_owner")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT user_id FROM agent_runs")).scalar_one() is None
        assert connection.execute(text("SELECT status FROM agent_runs")).scalar_one() == "succeeded"
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == "g04_run_owner"
        )
    assert "ix_agent_runs_user_id" in {
        item["name"] for item in inspect(engine).get_indexes("agent_runs")
    }
    command.downgrade(config, "t16_fix_moderation_execution")
    assert "user_id" not in {item["name"] for item in inspect(engine).get_columns("agent_runs")}
    command.upgrade(config, "g04_run_owner")
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT agent_run_id FROM agent_runs")).scalar_one()
            == "legacy-run"
        )
    engine.dispose()


def test_run_event_migration_preserves_parent_runs(tmp_path: Path, monkeypatch) -> None:
    from app.modules.governance.models import AgentRun

    url = f"sqlite:///{(tmp_path / 'g04_events.sqlite').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    engine = create_engine(url)
    AgentRun.__table__.create(engine)
    with engine.begin() as connection:
        connection.execute(
            text("""
            INSERT INTO agent_runs
                (task_type, trace_id, agent_run_id, input_summary, status, user_id)
            VALUES ('chat', 'trace', 'old-owned', 'metadata', 'succeeded', 7)
        """)
        )
    config = Config("alembic.ini")
    command.stamp(config, "g04_run_owner")
    command.upgrade(config, "g04_run_events")
    assert "agent_run_events" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT user_id FROM agent_runs")).scalar_one() == 7
        assert (
            connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            == "g04_run_events"
        )
    command.downgrade(config, "g04_run_owner")
    assert "agent_run_events" not in inspect(engine).get_table_names()
    command.upgrade(config, "g04_run_events")
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT agent_run_id FROM agent_runs")).scalar_one()
            == "old-owned"
        )
    engine.dispose()
