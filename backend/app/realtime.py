"""Live connection: call set-up, and relay of video signals, drawings, pointer and freeze.

Replaces the old prototype's server (git tag `pre-refactor`, ArGuide/server/index.js).
Differences: every connection must be signed in, each call has its own private room,
and pointer + freeze are now relayed.
"""

from datetime import timedelta
import math

import socketio
from socketio.exceptions import ConnectionRefusedError
from sqlalchemy import func, select

from .auth import read_token
from .config import ALLOWED_ORIGINS
from .db import (
    CallSession, Checklist, SessionEvent, SessionLocal, StepResult, User,
    event_out, session_out, step_out, utcnow,
)

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=ALLOWED_ORIGINS)

EXPERT_ROLES = ("expert", "admin")
RING_LIMIT = timedelta(seconds=60)  # a call nobody answers in this time counts as missed
ABANDON_AFTER = 120  # seconds a live call may sit with nobody connected (closed browser) before it is ended
MAX_SHAPES = 500
MAX_ANCHOR_CHARS = 40_000  # the small grey picture a drawing is anchored to (data: URL); bigger ones are dropped
MAX_ERASE_POLYGONS = 10_000  # bound the in-memory cutouts and their rendering cost per call

# ponytail: live state is kept in this one process, which is enough for one site.
# To run several server processes, add Redis and socketio.AsyncRedisManager.
clients: dict[str, dict] = {}  # socket id -> {"user": {...}, "joined": {session ids}}
rooms: dict[int, dict] = {}    # session id -> drawings, freeze state, who is connected


def room_name(session_id: int) -> str:
    return f"session:{session_id}"


def live(session_id: int) -> dict:
    return rooms.setdefault(session_id, {"shapes": {}, "ids": set(), "erase_ops": {}, "erase_count": 0, "actions": [], "frozen": False, "hands": True, "members": {}, "left_at": None})


def as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def member(sid: str, data) -> int | None:
    """The session id in `data`, if this connection has joined that session."""
    client = clients.get(sid)
    session_id = as_int(data.get("sessionId")) if isinstance(data, dict) else None
    return session_id if client and session_id in client["joined"] else None


def waiting_queue(db) -> list[dict]:
    cutoff = utcnow() - RING_LIMIT
    queue = []
    for s in db.scalars(select(CallSession).where(CallSession.status == "waiting").order_by(CallSession.created_at)):
        if s.created_at < cutoff:
            s.status = "missed"
        else:
            queue.append(session_out(s))
    db.commit()
    return queue


async def push_queue() -> None:
    with SessionLocal() as db:
        queue = waiting_queue(db)
    await sio.emit("queue:update", queue, room="experts")


async def leave_room(sid: str, session_id: int) -> None:
    client = clients.get(sid)
    if not client or session_id not in client["joined"]:
        return
    client["joined"].discard(session_id)
    state = live(session_id)
    state["members"].pop(sid, None)
    await sio.leave_room(sid, room_name(session_id))
    await sio.emit("peer:left", {"user": client["user"]}, room=room_name(session_id), skip_sid=sid)
    if not state["members"]:
        watch_abandoned(session_id)


def watch_abandoned(session_id: int) -> None:
    """End a live call if nobody comes back to it, so it does not stay 'in progress' forever."""
    left_at = live(session_id)["left_at"] = utcnow()
    sio.start_background_task(_end_if_abandoned, session_id, left_at)


async def _end_if_abandoned(session_id: int, left_at) -> None:
    await sio.sleep(ABANDON_AFTER)
    state = rooms.get(session_id)
    if not state or state["members"] or state.get("left_at") != left_at:
        return  # someone came back, or a later leave is being watched instead
    with SessionLocal() as db:
        s = db.get(CallSession, session_id)
        if s and s.status == "active":
            s.status, s.ended_at = "ended", left_at
            s.annotation_count = len(state["ids"])
            db.commit()
    rooms.pop(session_id, None)


def watch_open_calls() -> None:
    """After a restart nobody is connected yet; give live calls the usual time to come back."""
    with SessionLocal() as db:
        for session_id in db.scalars(select(CallSession.id).where(CallSession.status == "active")):
            watch_abandoned(session_id)


async def close_room(session_id: int) -> None:
    state = rooms.pop(session_id, None) or {"members": {}}
    for sid in state["members"]:
        if sid in clients:
            clients[sid]["joined"].discard(session_id)
        await sio.leave_room(sid, room_name(session_id))


# ---------- connection ----------

@sio.event
async def connect(sid, environ, auth):
    uid = read_token(auth.get("token") if isinstance(auth, dict) else None, "socket")
    with SessionLocal() as db:
        user = db.get(User, uid) if uid else None
        if not user or not user.active:
            raise ConnectionRefusedError("Sign in to continue.")
        clients[sid] = {"user": {"id": user.id, "name": user.name, "role": user.role}, "joined": set()}


@sio.event
async def disconnect(sid, *_reason):
    for session_id in list(clients.get(sid, {}).get("joined", ())):
        await leave_room(sid, session_id)
    clients.pop(sid, None)


@sio.on("expert:available")
async def expert_available(sid, data):
    client = clients.get(sid)
    if not client or client["user"]["role"] not in EXPERT_ROLES:
        return
    if isinstance(data, dict) and data.get("on"):
        await sio.enter_room(sid, "experts")
        with SessionLocal() as db:
            queue = waiting_queue(db)
        await sio.emit("queue:update", queue, to=sid)
    else:
        await sio.leave_room(sid, "experts")


# ---------- call life cycle ----------

@sio.on("call:start")
async def call_start(sid, data):
    client = clients.get(sid)
    if not client or client["user"]["role"] not in ("technician", "admin"):
        return {"ok": False, "error": "Only technicians can start a call."}
    data = data if isinstance(data, dict) else {}
    with SessionLocal() as db:
        s = CallSession(technician_id=client["user"]["id"], aircraft=str(data.get("aircraft") or "").strip().upper()[:32])
        checklist_id = as_int(data.get("checklistId"))
        checklist = db.get(Checklist, checklist_id) if checklist_id else None
        if checklist and checklist.active:
            s.checklist_id, s.checklist_name, s.steps = checklist.id, checklist.name, checklist.steps
        db.add(s)
        db.commit()
        db.refresh(s)
        out = session_out(s)
    await push_queue()
    return {"ok": True, "session": out}


@sio.on("call:accept")
async def call_accept(sid, data):
    client = clients.get(sid)
    session_id = as_int(data.get("sessionId")) if isinstance(data, dict) else None
    if not client or client["user"]["role"] not in EXPERT_ROLES or session_id is None:
        return {"ok": False, "error": "Only experts can answer calls."}
    with SessionLocal() as db:
        s = db.get(CallSession, session_id)
        if not s or s.status != "waiting":
            return {"ok": False, "error": "This call was already answered or has ended."}
        s.expert_id, s.status, s.started_at = client["user"]["id"], "active", utcnow()
        db.commit()
        db.refresh(s)
        out = session_out(s)
    await sio.emit("call:accepted", {"session": out}, room=room_name(session_id))
    await push_queue()
    return {"ok": True, "session": out}


@sio.on("session:join")
async def session_join(sid, data):
    client = clients.get(sid)
    session_id = as_int(data.get("sessionId")) if isinstance(data, dict) else None
    if not client or session_id is None:
        return {"ok": False, "error": "Session not found."}
    with SessionLocal() as db:
        s = db.get(CallSession, session_id)
        if not s or client["user"]["id"] not in (s.technician_id, s.expert_id):
            return {"ok": False, "error": "Session not found."}
        out = session_out(s)
        steps = [step_out(r) for r in db.scalars(select(StepResult).where(StepResult.session_id == session_id))]
        events = [event_out(e) for e in db.scalars(
            select(SessionEvent).where(SessionEvent.session_id == session_id).order_by(SessionEvent.id))]
    reply = {"ok": True, "session": out, "steps": steps, "events": events}
    if out["status"] not in ("waiting", "active"):
        return reply
    state = live(session_id)
    if session_id not in client["joined"]:
        client["joined"].add(session_id)
        state["members"][sid] = client["user"]["id"]
        await sio.enter_room(sid, room_name(session_id))
        await sio.emit("peer:joined", {"user": client["user"]}, room=room_name(session_id), skip_sid=sid)
    peers = [clients[other]["user"] for other in state["members"] if other != sid and other in clients]
    history = [{"kind": a["kind"], "id": a["id"]} for a in state["actions"] if a["author"] == client["user"]["id"]]
    return reply | {"shapes": list(state["shapes"].values()), "history": history, "frozen": state["frozen"], "hands": state["hands"], "peers": peers}


@sio.on("session:leave")
async def session_leave(sid, data):
    if (session_id := member(sid, data)) is not None:
        await leave_room(sid, session_id)


@sio.on("call:end")
async def call_end(sid, data):
    session_id = member(sid, data)
    if session_id is None:
        return
    with SessionLocal() as db:
        s = db.get(CallSession, session_id)
        was_waiting = s.status == "waiting"
        if was_waiting:
            s.status = "missed" if data.get("reason") == "timeout" else "cancelled"
        elif s.status == "active":
            s.status, s.ended_at = "ended", utcnow()
            s.annotation_count = len(live(session_id)["ids"])
        db.commit()
        status = s.status
    await sio.emit("call:ended", {"sessionId": session_id, "status": status, "by": clients[sid]["user"]},
                   room=room_name(session_id))
    await close_room(session_id)
    if was_waiting:
        await push_queue()


# ---------- relayed as-is to the other person in the call ----------

RELAYED = ("signal", "pointer", "ann:put", "ann:remove", "ann:clear", "freeze", "hands",
           "record:request", "record:answer", "record:state")


def _sane_box(box) -> bool:
    """A box of fractions {x, y, w, h}: all finite numbers within +-8, with a positive size."""
    return isinstance(box, dict) and all(
        type(box.get(k)) in (int, float) and math.isfinite(box[k]) and abs(box[k]) <= 8 for k in ("x", "y", "w", "h")
    ) and box["w"] > 0 and box["h"] > 0


def _relay(event: str):
    async def handler(sid, data):
        session_id = member(sid, data)
        if session_id is None:
            return
        state = live(session_id)
        if event == "ann:put":
            shape = data.get("shape")
            shape_id = str(shape.get("id", "")) if isinstance(shape, dict) else ""
            if not shape_id or (shape_id not in state["shapes"] and len(state["shapes"]) >= MAX_SHAPES):
                return
            # IDs remain in the session's history after remove/clear. A delayed worker result
            # must never recreate a drawing the participants already removed.
            if shape_id in state["ids"] and shape_id not in state["shapes"]:
                return
            if shape_id not in state["shapes"]:
                state["actions"].append({"kind": "shape", "id": shape_id, "author": clients[sid]["user"]["id"]})
            # Erasures are changed only through the validated erasing protocol.
            if "erasures" in shape:
                shape = {k: v for k, v in shape.items() if k != "erasures"}
                data = {**data, "shape": shape}
            anchor = shape.get("anchor")
            if anchor is not None and not (isinstance(anchor, dict) and len(str(anchor.get("img", ""))) <= MAX_ANCHOR_CHARS):
                shape = {k: v for k, v in shape.items() if k != "anchor"}  # still shown, just not anchored
                data = {**data, "shape": shape}
            elif isinstance(anchor, dict):
                # Optional boxes (the hand's area to ignore, the drawing's own area) must be numeric and
                # bounded before they reach OpenCV on the other side: a bad one is dropped, the rest stays.
                for key in ("exclude", "focus"):
                    if key in anchor and not _sane_box(anchor[key]):
                        anchor = {k: v for k, v in anchor.items() if k != key}
                        shape = {**shape, "anchor": anchor}
                        data = {**data, "shape": shape}
            # The anchor is sent once; later updates without one keep it.
            state["shapes"][shape_id] = {**state["shapes"].get(shape_id, {}), **shape}
            state["ids"].add(shape_id)
        elif event == "ann:remove":
            removed = str(data.get("id"))
            shape = state["shapes"].pop(removed, None)
            if shape:
                state["erase_count"] -= sum(len(paths) for paths in shape.get("erasures", {}).values())
            state["actions"] = [a for a in state["actions"] if not (a["kind"] == "shape" and a["id"] == removed)]
        elif event == "ann:clear":
            state["shapes"].clear()
            state["erase_count"] = 0
            state["actions"].clear()
            for op in state["erase_ops"].values():
                op["closed"] = True
        elif event == "freeze":
            state["frozen"] = bool(data.get("frozen"))
        elif event == "hands":  # hands-free drawing on the technician's phone, on or off
            state["hands"] = bool(data.get("on"))
        await sio.emit(event, data, room=room_name(session_id), skip_sid=sid)

    return handler


for _event in RELAYED:
    sio.on(_event, _relay(_event))


@sio.on("ann:erase")
async def erase(sid, data):
    session_id = member(sid, data)
    if session_id is None:
        return {"ok": False, "error": "Session not found."}
    state = live(session_id)
    op_id, batch, changes = data.get("opId"), data.get("batch"), data.get("changes")
    if not isinstance(op_id, str) or not 1 <= len(op_id) <= 100 or type(batch) is not int or not 0 <= batch < 1000:
        return {"ok": False, "error": "Invalid erasing action."}
    if not isinstance(changes, list) or not 1 <= len(changes) <= 100:
        return {"ok": False, "error": "Invalid erasing area."}
    for change in changes:
        if not isinstance(change, dict) or not isinstance(change.get("id"), str):
            return {"ok": False, "error": "Invalid erasing area."}
        poly = change.get("polygon")
        if not isinstance(poly, list) or not 3 <= len(poly) <= 32:
            return {"ok": False, "error": "Invalid erasing area."}
        for p in poly:
            if not isinstance(p, list) or len(p) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 4 for v in p):
                return {"ok": False, "error": "Invalid erasing area."}
    uid = clients[sid]["user"]["id"]
    op = state["erase_ops"].get(op_id)
    if op and (op["author"] != uid or op["closed"]):
        return {"ok": False, "error": "Erasing action is closed."}
    if op and batch in op["batches"]:
        return {"ok": True}
    accepted = [change for change in changes if change["id"] in state["shapes"]]
    if not accepted or state["erase_count"] + len(accepted) > MAX_ERASE_POLYGONS:
        return {"ok": False, "error": "That area cannot be erased."}
    if op is None:
        if len(state["erase_ops"]) >= 1000:
            return {"ok": False, "error": "Too many erasing actions."}
        op = state["erase_ops"][op_id] = {"author": uid, "batches": set(), "closed": False, "recorded": False}
    for change in accepted:
        shape = state["shapes"][change["id"]]
        shape.setdefault("erasures", {}).setdefault(op_id, []).append(change["polygon"])
    state["erase_count"] += len(accepted)
    op["batches"].add(batch)
    if accepted:
        if not op["recorded"]:
            state["actions"].append({"kind": "erase", "id": op_id, "author": uid})
            op["recorded"] = True
        await sio.emit("ann:erase", {"opId": op_id, "batch": batch, "changes": accepted, "author": uid}, room=room_name(session_id))
    return {"ok": True}


@sio.on("ann:erase:undo")
async def undo_erase(sid, data):
    session_id = member(sid, data)
    if session_id is None:
        return {"ok": False, "error": "Session not found."}
    state = live(session_id)
    op_id = data.get("opId")
    op = state["erase_ops"].get(op_id) if isinstance(op_id, str) else None
    if not op or op["author"] != clients[sid]["user"]["id"] or op["closed"]:
        return {"ok": False, "error": "Erasing action cannot be undone."}
    op["closed"] = True
    state["actions"] = [a for a in state["actions"] if not (a["kind"] == "erase" and a["id"] == op_id)]
    for shape in state["shapes"].values():
        removed = shape.get("erasures", {}).pop(op_id, [])
        state["erase_count"] -= len(removed)
    await sio.emit("ann:erase:undo", {"opId": op_id}, room=room_name(session_id))
    return {"ok": True}


# ---------- checklist, sign-off, chat and notes (saved) ----------

@sio.on("step:set")
async def step_set(sid, data):
    session_id = member(sid, data)
    step = as_int(data.get("step")) if session_id is not None else None
    status = data.get("status") if session_id is not None else None
    if step is None or status not in ("done", "problem", None):
        return {"ok": False, "error": "Could not save that step."}
    uid = clients[sid]["user"]["id"]
    with SessionLocal() as db:
        s = db.get(CallSession, session_id)
        if not 0 <= step < len(s.steps) or s.signed_off_by:
            return {"ok": False, "error": "This checklist is closed."}
        row = db.scalar(select(StepResult).where(StepResult.session_id == session_id, StepResult.step == step))
        if status is None:
            if row:
                db.delete(row)
            out = {"step": step, "status": None}
        else:
            row = row or StepResult(session_id=session_id, step=step)
            row.status, row.note, row.user_id, row.at = status, str(data.get("note") or "")[:1000], uid, utcnow()
            db.add(row)
        db.commit()
        if status is not None:
            db.refresh(row)
            out = step_out(row)
    await sio.emit("step:update", out, room=room_name(session_id))
    return {"ok": True}


@sio.on("signoff")
async def signoff(sid, data):
    session_id = member(sid, data)
    if session_id is None or clients[sid]["user"]["role"] not in EXPERT_ROLES:
        return {"ok": False, "error": "Only the expert can sign off."}
    with SessionLocal() as db:
        s = db.get(CallSession, session_id)
        results = db.scalar(select(func.count()).select_from(StepResult).where(StepResult.session_id == session_id))
        if not s.steps or results < len(s.steps):
            return {"ok": False, "error": "Every step needs a result before sign-off."}
        if not s.signed_off_by:
            s.signed_off_by, s.signed_off_at = clients[sid]["user"]["id"], utcnow()
            db.commit()
            db.refresh(s)
        out = session_out(s)["signedOff"]
    await sio.emit("signoff:update", out, room=room_name(session_id))
    return {"ok": True}


@sio.on("msg")
async def message(sid, data):
    session_id = member(sid, data)
    text = str(data.get("text") or "").strip()[:2000] if session_id is not None else ""
    if not text or data.get("kind") not in ("chat", "note"):
        return {"ok": False}
    with SessionLocal() as db:
        e = SessionEvent(session_id=session_id, user_id=clients[sid]["user"]["id"], kind=data["kind"], text=text)
        db.add(e)
        db.commit()
        db.refresh(e)
        out = event_out(e)
    await sio.emit("event:new", out, room=room_name(session_id))
    return {"ok": True}
