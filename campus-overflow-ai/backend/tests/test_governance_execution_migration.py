"""GL-01迁移往返：只在临时库测试，不访问业务数据库。"""

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.config import settings


def test_v2_migration_round_trip(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'governance_v2.sqlite').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    engine = create_engine(url)
    with engine.begin() as connection:
        for table in ("users", "moderation_cases", "agent_runs"):
            key = "agent_run_id VARCHAR(64)" if table == "agent_runs" else "id INTEGER"
            connection.execute(text(f"CREATE TABLE {table} ({key} PRIMARY KEY)"))
    config = Config("alembic.ini")
    command.stamp(config, "ax_role_commands")
    command.upgrade(config, "gl01_approval_v2")
    schema = inspect(engine)
    assert "governance_approval_requests" in schema.get_table_names()
    assert "governance_execution_jobs" in schema.get_table_names()
    assert {"request_id"} in [
        set(c["column_names"]) for c in schema.get_unique_constraints("governance_execution_jobs")
    ]
    assert "lease_epoch" in {c["name"] for c in schema.get_columns("governance_execution_jobs")}
    command.downgrade(config, "ax_role_commands")
    assert "governance_execution_jobs" not in inspect(engine).get_table_names()
    assert "governance_approval_requests" not in inspect(engine).get_table_names()
    command.upgrade(config, "gl01_approval_v2")
    assert "governance_execution_jobs" in inspect(engine).get_table_names()
    command.upgrade(config, "gl04_job_resume")
    assert "continuation" in {
        c["name"] for c in inspect(engine).get_columns("governance_execution_jobs")
    }
    command.downgrade(config, "gl01_approval_v2")
    assert "continuation" not in {
        c["name"] for c in inspect(engine).get_columns("governance_execution_jobs")
    }
    command.upgrade(config, "gl04_job_resume")
    engine.dispose()
