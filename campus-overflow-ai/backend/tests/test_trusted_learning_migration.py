"""隔离临时 SQLite 验证可信词表与匿名事件增量迁移。"""

from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.config import settings


def test_learning_migration_upgrade_downgrade_reupgrade(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'learning.sqlite').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    engine = create_engine(url)
    with engine.begin() as connection:
        for table in ("courses", "tags", "users"):
            connection.execute(text(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY)"))
    config = Config("alembic.ini")
    command.stamp(config, "ap03_waits")
    command.upgrade(config, "ax_t_learning")
    tables = set(inspect(engine).get_table_names())
    assert {"course_tag_sources", "anonymous_learning_events"}.issubset(tables)
    event_columns = {c["name"] for c in inspect(engine).get_columns("anonymous_learning_events")}
    assert not event_columns & {"user_id", "session_id", "history", "message", "memory"}
    command.downgrade(config, "ap03_waits")
    assert "anonymous_learning_events" not in inspect(engine).get_table_names()
    command.upgrade(config, "ax_t_learning")
    assert "anonymous_learning_events" in inspect(engine).get_table_names()
    engine.dispose()
