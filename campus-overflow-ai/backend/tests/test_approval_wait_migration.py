"""仅在隔离 SQLite 父表上验证 AP-03 增量迁移往返。"""
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from alembic import command
from app.core.config import settings


def test_approval_wait_migration_round_trip(tmp_path: Path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'approval_wait_migration.sqlite').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE moderation_cases (id INTEGER PRIMARY KEY)"))
        connection.execute(text("INSERT INTO users(id) VALUES(7)"))
        connection.execute(text("INSERT INTO moderation_cases(id) VALUES(9)"))
    config = Config("alembic.ini")
    command.stamp(config, "tw02_assistant_cert")
    command.upgrade(config, "ap03_waits")
    inspector = inspect(engine)
    assert "approval_waits" in inspector.get_table_names()
    assert {"request_id", "case_id", "user_id", "state", "expires_at", "result", "trace_id"} <= {
        item["name"] for item in inspector.get_columns("approval_waits")
    }
    assert "ix_approval_waits_user_id" in {
        item["name"] for item in inspector.get_indexes("approval_waits")
    }
    assert any(item["column_names"] == ["case_id"] for item in inspector.get_unique_constraints(
        "approval_waits",
    ))
    with engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO approval_waits(request_id,case_id,user_id,trace_id)
            VALUES('00000000-0000-4000-8000-000000000001',9,7,'migration-trace')
        """))
        state = connection.execute(text("SELECT state FROM approval_waits")).scalar_one()
        assert state == "waiting"
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO approval_waits(request_id,case_id,user_id,trace_id)
            VALUES('00000000-0000-4000-8000-000000000002',9,7,'duplicate')
        """))
    command.downgrade(config, "tw02_assistant_cert")
    assert "approval_waits" not in inspect(engine).get_table_names()
    command.upgrade(config, "ap03_waits")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM approval_waits")).scalar_one() == 0
        assert connection.execute(text("SELECT id FROM users")).scalar_one() == 7
        assert connection.execute(text("SELECT id FROM moderation_cases")).scalar_one() == 9
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        assert revision == "ap03_waits"
    engine.dispose()
