"""Database connection, tables, and the JSON shapes the API sends out."""

from datetime import UTC, datetime

from sqlalchemy import JSON, ForeignKey, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

from .config import DATABASE_URL

ROLES = ("technician", "expert", "admin")


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(16))
    password_hash: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Checklist(Base):
    __tablename__ = "checklists"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    steps: Mapped[list] = mapped_column(JSON)  # [{"text": str, "critical": bool}]
    active: Mapped[bool] = mapped_column(default=True)


class CallSession(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expert_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    aircraft: Mapped[str] = mapped_column(String(32), default="")
    # The checklist is copied in when the call starts, so later edits never change old reports.
    checklist_id: Mapped[int | None] = mapped_column(ForeignKey("checklists.id"))
    checklist_name: Mapped[str] = mapped_column(String(120), default="")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="waiting")  # waiting|active|ended|missed|cancelled
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]
    annotation_count: Mapped[int] = mapped_column(default=0)
    signed_off_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    signed_off_at: Mapped[datetime | None]

    technician: Mapped[User] = relationship(foreign_keys=[technician_id], lazy="joined")
    expert: Mapped[User | None] = relationship(foreign_keys=[expert_id], lazy="joined")
    signer: Mapped[User | None] = relationship(foreign_keys=[signed_off_by], lazy="joined")


class SessionEvent(Base):
    """Things added during a call: chat messages, notes, photos, recordings."""

    __tablename__ = "session_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String(16))  # chat|note|photo|recording
    text: Mapped[str] = mapped_column(Text, default="")
    file: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    user: Mapped[User | None] = relationship(lazy="joined")


class StepResult(Base):
    __tablename__ = "step_results"
    __table_args__ = (UniqueConstraint("session_id", "step"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    step: Mapped[int]
    status: Mapped[str] = mapped_column(String(16))  # done|problem
    note: Mapped[str] = mapped_column(Text, default="")
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    at: Mapped[datetime] = mapped_column(default=utcnow)
    user: Mapped[User] = relationship(lazy="joined")


# ---------- JSON shapes ----------

def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def person(u: User | None) -> dict | None:
    return {"id": u.id, "name": u.name} if u else None


def user_out(u: User) -> dict:
    return {"id": u.id, "username": u.username, "name": u.name, "role": u.role, "active": u.active}


def checklist_out(c: Checklist) -> dict:
    return {"id": c.id, "name": c.name, "description": c.description, "steps": c.steps, "active": c.active}


def session_out(s: CallSession) -> dict:
    return {
        "id": s.id,
        "code": f"SES-{s.id:06d}",
        "aircraft": s.aircraft,
        "status": s.status,
        "technician": person(s.technician),
        "expert": person(s.expert),
        "checklist": {"id": s.checklist_id, "name": s.checklist_name, "steps": s.steps} if s.checklist_name else None,
        "createdAt": iso(s.created_at),
        "startedAt": iso(s.started_at),
        "endedAt": iso(s.ended_at),
        "annotationCount": s.annotation_count,
        "signedOff": {"by": s.signer.name, "at": iso(s.signed_off_at)} if s.signer else None,
    }


def event_out(e: SessionEvent) -> dict:
    return {"id": e.id, "kind": e.kind, "text": e.text, "hasFile": bool(e.file), "user": person(e.user), "at": iso(e.created_at)}


def step_out(r: StepResult) -> dict:
    return {"step": r.step, "status": r.status, "note": r.note, "user": person(r.user), "at": iso(r.at)}


# ---------- setup ----------

# The three checklists from the old prototype (git tag `pre-refactor`, ArGuide/ai-copilot/database.js).
SEED_CHECKLISTS = [
    ("Hydraulic valve replacement", "Replacing a hydraulic control valve", [
        ("Depressurise the hydraulic system", True),
        ("Isolate the valve using the shut-off valves", True),
        ("Drain residual fluid", False),
        ("Remove mounting bolts and note the torque spec", False),
        ("Inspect O-ring seating surfaces", True),
        ("Install the new valve with new O-rings", True),
        ("Torque bolts to spec (check the manual)", True),
        ("Pressure test after installation", True),
        ("Check for leaks at all joints", True),
        ("Document and sign off", False),
    ]),
    ("Engine assembly check", "Pre-flight engine component check", [
        ("Visual inspection of all external components", True),
        ("Check all fastener torques", True),
        ("Verify fuel line connections", True),
        ("Inspect for oil leaks", True),
        ("Check sensor connections", False),
        ("Run start-up diagnostics", True),
        ("Document findings", False),
    ]),
    ("Avionics systems check", "Pre-flight avionics check", [
        ("Power on all avionics systems", True),
        ("Verify communication systems", True),
        ("Check navigation instruments", True),
        ("Test autopilot disconnect", True),
        ("Verify warning systems", True),
        ("Check display integrity", False),
        ("Log and sign off", False),
    ]),
]


def init_db() -> None:
    # ponytail: create_all instead of migrations. Add Alembic before the first
    # table change on a database that holds real records.
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(Checklist.id).limit(1)) is None:
            for name, desc, steps in SEED_CHECKLISTS:
                db.add(Checklist(name=name, description=desc, steps=[{"text": t, "critical": c} for t, c in steps]))
            db.commit()
