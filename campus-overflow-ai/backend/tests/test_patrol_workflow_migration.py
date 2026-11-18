"""仅验证当前基线上的WF-03A增量迁移，不替代历史MySQL迁移链。"""
import os
import subprocess
import sys

from sqlalchemy import create_engine, inspect

from app.db.base import Base


def test_incremental_migration_roundtrip(tmp_path):
    path = tmp_path / "wf03a.db"
    url = f"sqlite:///{path.as_posix()}"
    engine = create_engine(url)
    Base.metadata.create_all(engine, tables=[
        table for table in Base.metadata.sorted_tables
        if table.name not in {
            "patrol_workflow_tasks", "patrol_workflow_scans", "patrol_notes",
            "patrol_scan_jobs",
        }
    ])
    engine.dispose()
    env = {**os.environ, "BACKEND_DATABASE_URL": url}
    for command, revision in [
        ("stamp", "gl04_job_resume"), ("upgrade", "head"),
        ("downgrade", "gl04_job_resume"), ("upgrade", "head"),
    ]:
        result = subprocess.run(
            [sys.executable, "-m", "alembic", command, revision], env=env,
            capture_output=True, text=True, check=False,
        )
        assert result.returncode == 0, result.stderr
        engine = create_engine(url)
        inspector = inspect(engine)
        if command == "upgrade":
            assert inspector.has_table("patrol_workflow_tasks")
            unique = inspector.get_unique_constraints("patrol_workflow_tasks")
            assert any(item["column_names"] == ["source_key"] for item in unique)
        else:
            assert not inspector.has_table("patrol_workflow_tasks")
        assert inspector.has_table("agent_runs")
        engine.dispose()
