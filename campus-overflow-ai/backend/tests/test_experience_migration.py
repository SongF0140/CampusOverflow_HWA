"""隔离 SQLite 验证经验增量迁移，不连接真实业务库。"""

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.config import settings


def test_experience_migration_upgrade_downgrade_upgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'experience.sqlite').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE courses (id INTEGER PRIMARY KEY)"))
    config = Config("alembic.ini")
    command.stamp(config, "ax_t_learning")
    command.upgrade(config, "ax_c_experiences")
    assert "agent_experiences" in inspect(engine).get_table_names()
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO users (id) VALUES (1)"))
        connection.execute(text("INSERT INTO courses (id) VALUES (1)"))
        connection.execute(text("""
            INSERT INTO agent_experiences
            (proposal_id, course_id, proposed_by, title, summary, steps,
             status, trace_id, agent_run_id)
            VALUES ('migration-id', 1, 1, 'title', 'summary', '[]', 'pending', 'trace', 'run')
        """))
    command.downgrade(config, "ax_t_learning")
    assert "agent_experiences" not in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM users")).scalar_one() == 1
    command.upgrade(config, "ax_c_experiences")
    assert "agent_experiences" in inspect(engine).get_table_names()
    engine.dispose()
