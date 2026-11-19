from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.config import settings


def test_class_change_migration_round_trip(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'class_change.sqlite').as_posix()}"
    monkeypatch.setattr(settings, "database_url", url)
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users(id INTEGER PRIMARY KEY)"))
        connection.execute(text("CREATE TABLE courses(id INTEGER PRIMARY KEY)"))
    config = Config("alembic.ini")
    command.stamp(config, "ax_c_experiences")
    command.upgrade(config, "ax_role_commands")
    assert "class_change_requests" in inspect(engine).get_table_names()
    command.downgrade(config, "ax_c_experiences")
    assert "class_change_requests" not in inspect(engine).get_table_names()
    command.upgrade(config, "ax_role_commands")
    assert "class_change_requests" in inspect(engine).get_table_names()
    engine.dispose()
