"""REST API: checklists, people, saved sessions, files and numbers."""

import re
import uuid
from datetime import timedelta
from statistics import mean
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import aliased

from .auth import current_user, get_db, hash_password, require_role
from .config import ICE_SERVERS, TURN_SHARED_SECRET, TURN_TTL_SECONDS, TURN_URLS, UPLOAD_DIR
from .turn import turn_credentials
from .db import (
    CallSession, Checklist, SessionEvent, StepResult, User,
    checklist_out, event_out, session_out, step_out, user_out, utcnow,
)
from .realtime import room_name, sio

router = APIRouter(prefix="/api")

Role = Literal["technician", "expert", "admin"]
experts_only = require_role("expert", "admin")
admin_only = require_role("admin")


@router.get("/config")
def config(user: User = Depends(current_user)):
    return {"iceServers": [*ICE_SERVERS, *turn_credentials(TURN_URLS, TURN_SHARED_SECRET, user.id, TURN_TTL_SECONDS)]}


# ---------- checklists ----------

class StepIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    critical: bool = False


class ChecklistIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field("", max_length=500)
    steps: list[StepIn] = Field(min_length=1, max_length=100)
    active: bool = True


@router.get("/checklists")
def list_checklists(include_hidden: bool = False, user: User = Depends(current_user), db=Depends(get_db)):
    q = select(Checklist).order_by(Checklist.name)
    if not include_hidden:
        q = q.where(Checklist.active)
    return [checklist_out(c) for c in db.scalars(q)]


@router.post("/checklists")
def create_checklist(body: ChecklistIn, user: User = Depends(experts_only), db=Depends(get_db)):
    c = Checklist(**body.model_dump())
    db.add(c)
    db.commit()
    return checklist_out(c)


@router.put("/checklists/{checklist_id}")
def update_checklist(checklist_id: int, body: ChecklistIn, user: User = Depends(experts_only), db=Depends(get_db)):
    c = db.get(Checklist, checklist_id) or _missing("Checklist")
    for key, value in body.model_dump().items():
        setattr(c, key, value)
    db.commit()
    return checklist_out(c)


# ---------- people ----------

class UserIn(BaseModel):
    username: str = Field(pattern=r"^[a-z0-9._-]{2,64}$")
    name: str = Field(min_length=1, max_length=120)
    role: Role
    password: str = Field(min_length=8, max_length=200)


class UserPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    role: Role | None = None
    active: bool | None = None
    password: str | None = Field(None, min_length=8, max_length=200)


@router.get("/users")
def list_users(user: User = Depends(admin_only), db=Depends(get_db)):
    return [user_out(u) for u in db.scalars(select(User).order_by(User.name))]


@router.post("/users")
def create_user(body: UserIn, user: User = Depends(admin_only), db=Depends(get_db)):
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(409, "That username is taken. Choose another.")
    u = User(username=body.username, name=body.name, role=body.role, password_hash=hash_password(body.password))
    db.add(u)
    db.commit()
    return user_out(u)


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserPatch, user: User = Depends(admin_only), db=Depends(get_db)):
    u = db.get(User, user_id) or _missing("Person")
    if u.id == user.id and (body.active is False or (body.role and body.role != "admin")):
        raise HTTPException(400, "You cannot remove your own admin access.")
    for key in ("name", "role", "active"):
        if (value := getattr(body, key)) is not None:
            setattr(u, key, value)
    if body.password:
        u.password_hash = hash_password(body.password)
    db.commit()
    return user_out(u)


# ---------- sessions ----------

def _missing(what: str):
    raise HTTPException(404, f"{what} not found.")


def _visible_session(db, user: User, session_id: int) -> CallSession:
    s = db.get(CallSession, session_id)
    if not s or (user.role == "technician" and s.technician_id != user.id):
        _missing("Session")
    return s


@router.get("/sessions")
def list_sessions(q: str = "", status: str = "", days: int = 0, user: User = Depends(current_user), db=Depends(get_db)):
    tech, expert = aliased(User), aliased(User)
    stmt = (select(CallSession).join(tech, CallSession.technician_id == tech.id)
            .outerjoin(expert, CallSession.expert_id == expert.id)
            .order_by(CallSession.id.desc()).limit(200))
    if user.role == "technician":
        stmt = stmt.where(CallSession.technician_id == user.id)
    if status:
        stmt = stmt.where(CallSession.status == status)
    if days > 0:
        stmt = stmt.where(CallSession.created_at >= utcnow() - timedelta(days=days))
    if q := q.strip():
        like = f"%{q}%"
        match = [CallSession.aircraft.ilike(like), CallSession.checklist_name.ilike(like),
                 tech.name.ilike(like), expert.name.ilike(like)]
        if code := re.fullmatch(r"(?:ses-)?0*(\d+)", q, re.IGNORECASE):
            match.append(CallSession.id == int(code.group(1)))
        stmt = stmt.where(or_(*match))
    return [session_out(s) for s in db.scalars(stmt)]


@router.get("/sessions/{session_id}")
def get_session(session_id: int, user: User = Depends(current_user), db=Depends(get_db)):
    s = _visible_session(db, user, session_id)
    steps = db.scalars(select(StepResult).where(StepResult.session_id == s.id).order_by(StepResult.step))
    events = db.scalars(select(SessionEvent).where(SessionEvent.session_id == s.id).order_by(SessionEvent.id))
    return session_out(s) | {"steps": [step_out(r) for r in steps], "events": [event_out(e) for e in events]}


UPLOAD_RULES = {  # kind -> ({accepted type: file ending}, size limit)
    "photo": ({"image/jpeg": ".jpg", "image/png": ".png"}, 15 * 2**20),
    "recording": ({"video/webm": ".webm", "video/mp4": ".mp4"}, 1024 * 2**20),
}


@router.post("/sessions/{session_id}/files")
async def upload_file(session_id: int, kind: str = Form(...), file: UploadFile = File(...),
                      user: User = Depends(current_user), db=Depends(get_db)):
    s = _visible_session(db, user, session_id)
    if user.id not in (s.technician_id, s.expert_id):
        raise HTTPException(403, "Only people in this call can add files.")
    content_type = (file.content_type or "").split(";")[0]
    if kind not in UPLOAD_RULES or content_type not in UPLOAD_RULES[kind][0]:
        raise HTTPException(400, "This kind of file is not accepted.")
    endings, limit = UPLOAD_RULES[kind]
    ending = endings[content_type]
    folder = UPLOAD_DIR / str(s.id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{uuid.uuid4().hex}{ending}"
    size = 0
    with path.open("wb") as out:
        while chunk := await file.read(2**20):
            size += len(chunk)
            if size > limit:
                out.close()
                path.unlink()
                raise HTTPException(413, "That file is too large.")
            out.write(chunk)
    e = SessionEvent(session_id=s.id, user_id=user.id, kind=kind, file=str(path.relative_to(UPLOAD_DIR)))
    db.add(e)
    db.commit()
    db.refresh(e)
    out = event_out(e)
    await sio.emit("event:new", out, room=room_name(s.id))
    return out


@router.get("/files/{event_id}")
def get_file(event_id: int, user: User = Depends(current_user), db=Depends(get_db)):
    e = db.get(SessionEvent, event_id)
    if not e or not e.file:
        _missing("File")
    _visible_session(db, user, e.session_id)
    return FileResponse(UPLOAD_DIR / e.file)


# ---------- numbers (all measured from saved sessions) ----------

@router.get("/stats")
def stats(days: int = 7, user: User = Depends(experts_only), db=Depends(get_db)):
    since = utcnow() - timedelta(days=max(1, min(days, 365)))
    rows = db.scalars(select(CallSession).where(CallSession.created_at >= since)).all()
    answered = [s for s in rows if s.started_at]
    lengths = [(s.ended_at - s.started_at).total_seconds() for s in answered if s.ended_at]
    waits = [(s.started_at - s.created_at).total_seconds() for s in answered]
    return {
        "days": days,
        "calls": len(rows),
        "answered": len(answered),
        "missed": sum(s.status == "missed" for s in rows),
        "signedOff": sum(bool(s.signed_off_by) for s in rows),
        "averageMinutes": round(mean(lengths) / 60, 1) if lengths else None,
        "averageWaitSeconds": round(mean(waits)) if waits else None,
    }
