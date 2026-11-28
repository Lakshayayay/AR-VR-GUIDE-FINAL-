"""Alembic's environment: used at start-up (app/migrate.py) and by the `alembic` command."""

from alembic import context

from app.db import Base, engine


def run(connection) -> None:
    # Batch mode: SQLite can only change an existing table by rebuilding it.
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


given = context.config.attributes.get("connection")
if given is not None:
    run(given)
else:
    with engine.connect() as connection:
        run(connection)
