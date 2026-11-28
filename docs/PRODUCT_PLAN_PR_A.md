# Database migrations (PR A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. This one is executed inline by the main session.

**Goal:** Tables can change later without losing records.

**Architecture:** Alembic runs at start-up inside `init_db()`. A database made before migrations is checked against the baseline, then stamped. A database newer than the code is left alone, so code can be rolled back.

**Tech Stack:** SQLAlchemy 2, Alembic, SQLite (Postgres allowed through `DATABASE_URL`), pytest.

**Spec:** [`PRODUCT_PLAN.md`](PRODUCT_PLAN.md), "PR A".

## Global Constraints

- One new dependency only: `alembic`.
- Nothing calls outside services while the app runs.
- Every migration only adds things: new tables, columns that may be empty or have a `server_default`.
- Never write to `backend/data` from a test.

## Review Focus

1. A database with records made before migrations: records kept, version recorded.
2. A database from the password version: refused with a clear message, left untouched.
3. Rolled-back code meeting a newer database: starts, changes nothing.
4. A retried upgrade: the first backup is not overwritten.
5. Every later model change without a migration: a test fails.

---

### Task 1: upgrade tool, baseline and tests

**Files:**
- Create: `backend/app/migrate.py`, `backend/app/migrations/env.py`, `backend/app/migrations/script.py.mako`, `backend/app/migrations/versions/0001_baseline.py`, `backend/alembic.ini`
- Modify: `backend/pyproject.toml`, `backend/uv.lock`, `backend/app/db.py` (`init_db`)
- Test: `backend/tests/test_migrations.py`

**Interfaces:**
- Produces: `app.migrate.BASELINE: str = "0001"`, `upgrade_db(engine) -> None`, `backup_sqlite(engine, revision: str) -> Path | None`

- [x] Add the dependency: `cd backend && uv add alembic`
- [x] Add a stub `migrate.py` that keeps today's behaviour (`create_all`; backup returns `None`)
- [x] Write the five tests (one per Review Focus line); run `uv run pytest tests/test_migrations.py`; expect failures
- [x] Write the environment, the hand-written baseline and `migrate.py`; point `init_db()` at `upgrade_db(engine)`
- [x] Run `npm test`; expect every test to pass
- [x] Check the developer command: `alembic revision --autogenerate` on a throwaway database produces an empty migration

### Task 2: docs and status

**Files:** `README.md` (how to add a migration), `docs/DEPLOYMENT.md` (backup file, additive rule), `STATUS.md`

- [x] Update the docs and `STATUS.md`
- [x] Start the API on an empty temporary `DATA_DIR` and on a copy of a pre-migration database; both answer `/api/health`
- [x] Ask the owner before committing
