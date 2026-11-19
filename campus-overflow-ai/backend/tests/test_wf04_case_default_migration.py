from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from alembic import command
from app.core.config import settings


def test_case_updated_default_migration(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'wf04.db'}"
    engine = create_engine(url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE moderation_cases (id INTEGER PRIMARY KEY, "
                "created_at DATETIME NOT NULL, updated_at DATETIME NULL)"
            )
        )
        connection.execute(text("INSERT INTO moderation_cases VALUES (1, CURRENT_TIMESTAMP, NULL)"))
    monkeypatch.setattr(settings, "database_url", url)
    config = Config("alembic.ini")
    command.stamp(config, "wf03b_system_approvals")
    command.upgrade(config, "head")
    column = next(
        c for c in inspect(engine).get_columns("moderation_cases") if c["name"] == "updated_at"
    )
    assert column["default"] is not None and not column["nullable"]
    with engine.connect() as connection:
        assert (
            connection.execute(text("SELECT updated_at FROM moderation_cases")).scalar() is not None
        )
    command.downgrade(config, "wf03b_system_approvals")
    column = next(
        c for c in inspect(engine).get_columns("moderation_cases") if c["name"] == "updated_at"
    )
    assert column["default"] is None and column["nullable"]
    engine.dispose()
