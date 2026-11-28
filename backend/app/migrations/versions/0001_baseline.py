"""The tables as they were before ArGuide used migrations.

Written out by hand: it must keep describing that moment, even after the models in db.py change.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("username", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_table(
        "checklists",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("steps", sa.JSON, nullable=False),
        sa.Column("active", sa.Boolean, nullable=False),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("technician_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expert_id", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("aircraft", sa.String(32), nullable=False),
        sa.Column("checklist_id", sa.Integer, sa.ForeignKey("checklists.id")),
        sa.Column("checklist_name", sa.String(120), nullable=False),
        sa.Column("steps", sa.JSON, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("started_at", sa.DateTime),
        sa.Column("ended_at", sa.DateTime),
        sa.Column("annotation_count", sa.Integer, nullable=False),
        sa.Column("signed_off_by", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("signed_off_at", sa.DateTime),
    )
    op.create_table(
        "session_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("session_id", sa.Integer, sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("file", sa.String(255)),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    op.create_index("ix_session_events_session_id", "session_events", ["session_id"])
    op.create_table(
        "step_results",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("session_id", sa.Integer, sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("step", sa.Integer, nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("note", sa.Text, nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("session_id", "step"),
    )
    op.create_index("ix_step_results_session_id", "step_results", ["session_id"])
