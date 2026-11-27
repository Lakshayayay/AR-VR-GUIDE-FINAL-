"""Runs a real server and walks through a whole call.

uv run pytest
"""

import asyncio
import os
import socket
import tempfile
import threading
import time

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="arguide-test-")

import httpx  # noqa: E402
import pytest  # noqa: E402
import socketio  # noqa: E402
import uvicorn  # noqa: E402

from app.db import SessionLocal, User  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def base_url():
    with SessionLocal() as db:
        for username, role in [("tech", "technician"), ("tech2", "technician"), ("expert", "expert"), ("admin", "admin")]:
            db.add(User(username=username, name=username.title(), role=role))
        db.commit()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(5)


def acting_as(base_url, username) -> httpx.Client:
    return httpx.Client(base_url=base_url, headers={"x-arguide-user": username})


class Person:
    """A live connection that remembers every event it receives."""

    def __init__(self, base_url, username):
        self.username = username
        self.http = acting_as(base_url, username)
        self.base_url = base_url
        self.sio = socketio.AsyncClient()
        self.got: list[tuple[str, object]] = []
        self.sio.on("*", lambda event, data=None: self.got.append((event, data)))

    async def connect(self):
        await self.sio.connect(self.base_url, auth={"user": self.username}, transports=["websocket"])

    async def wait_for(self, event, timeout=3.0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            for name, data in self.got:
                if name == event:
                    self.got.remove((name, data))
                    return data
            await asyncio.sleep(0.02)
        raise AssertionError(f"never received {event}; got {[n for n, _ in self.got]}")

    def received(self, event):
        return any(name == event for name, _ in self.got)


def test_person_and_role_rules(base_url):
    nobody = httpx.Client(base_url=base_url)
    assert nobody.get("/api/auth/me").status_code == 401
    assert acting_as(base_url, "no-such-person").get("/api/auth/me").status_code == 401
    assert nobody.get("/api/auth/me", params={"user": "tech"}).json()["role"] == "technician"
    assert nobody.post("/api/checklists", params={"user": "expert"}, json={}).status_code != 200
    assert nobody.post("/api/users", params={"user": "admin"}, json={"username": "xx", "name": "X", "role": "admin"}).status_code == 401
    assert {p["username"] for p in nobody.get("/api/auth/people").json()} >= {"tech", "expert", "admin"}
    tech = acting_as(base_url, "tech")
    assert tech.get("/api/users").status_code == 403
    assert acting_as(base_url, "admin").get("/api/users").status_code == 200


def test_live_connection_needs_a_known_person(base_url):
    async def run():
        client = socketio.AsyncClient()
        with pytest.raises(socketio.exceptions.ConnectionError):
            await client.connect(base_url, auth={"user": "made-up"}, transports=["websocket"])
    asyncio.run(run())


def test_whole_call(base_url):
    asyncio.run(_whole_call(base_url))


def test_late_drawing_updates_do_not_restore_removed_or_cleared_shapes(base_url):
    async def run():
        tech = Person(base_url, "tech")
        await tech.connect()
        sid = (await tech.sio.call("call:start", {}))["session"]["id"]
        await tech.sio.call("session:join", {"sessionId": sid})
        shape = {"id": "late-1", "tool": "pen", "points": [[0.1, 0.1], [0.2, 0.2]]}
        await tech.sio.call("ann:put", {"sessionId": sid, "shape": shape})
        await tech.sio.call("ann:remove", {"sessionId": sid, "id": shape["id"]})
        await tech.sio.call("ann:put", {"sessionId": sid, "shape": {**shape, "anchor": {"img": "late"}}})
        assert (await tech.sio.call("session:join", {"sessionId": sid}))["shapes"] == []

        shape["id"] = "late-2"
        await tech.sio.call("ann:put", {"sessionId": sid, "shape": shape})
        await tech.sio.call("ann:clear", {"sessionId": sid})
        await tech.sio.call("ann:put", {"sessionId": sid, "shape": shape})
        assert (await tech.sio.call("session:join", {"sessionId": sid}))["shapes"] == []
        await tech.sio.call("call:end", {"sessionId": sid})
        await tech.sio.disconnect()
    asyncio.run(run())


def test_partial_erasing_is_shared_deduplicated_and_undoable(base_url):
    async def run():
        tech, expert, stranger = Person(base_url, "tech"), Person(base_url, "expert"), Person(base_url, "tech2")
        for person in (tech, expert, stranger):
            await person.connect()
        sid = (await tech.sio.call("call:start", {}))["session"]["id"]
        await tech.sio.call("session:join", {"sessionId": sid})
        await expert.sio.call("call:accept", {"sessionId": sid})
        await expert.sio.call("session:join", {"sessionId": sid})
        shape = {"id": "erase-test", "tool": "pen", "points": [[0.1, 0.5], [0.9, 0.5]]}
        await expert.sio.call("ann:put", {"sessionId": sid, "shape": shape})
        polygon = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]]
        message = {"sessionId": sid, "opId": "rub-1", "batch": 0, "changes": [{"id": shape["id"], "polygon": polygon}]}
        assert (await tech.sio.call("ann:erase", message, timeout=1))["ok"]
        assert (await expert.wait_for("ann:erase"))["changes"][0]["polygon"] == polygon
        assert (await tech.sio.call("ann:erase", message))["ok"]
        await expert.sio.call("ann:put", {"sessionId": sid, "shape": shape})
        rejoined = await tech.sio.call("session:join", {"sessionId": sid})
        assert rejoined["history"][-1] == {"kind": "erase", "id": "rub-1"}
        assert not (await expert.sio.call("session:join", {"sessionId": sid}))["history"][-1]["kind"] == "erase"
        saved = rejoined["shapes"][0]
        assert saved["erasures"]["rub-1"] == [polygon]
        assert not (await stranger.sio.call("ann:erase", message))["ok"]
        assert not (await expert.sio.call("ann:erase:undo", {"sessionId": sid, "opId": "rub-1"}))["ok"]
        assert (await tech.sio.call("ann:erase:undo", {"sessionId": sid, "opId": "rub-1"}))["ok"]
        assert (await expert.wait_for("ann:erase:undo"))["opId"] == "rub-1"
        assert not (await tech.sio.call("ann:erase", {**message, "batch": 1}))["ok"]
        saved = (await tech.sio.call("session:join", {"sessionId": sid}))["shapes"][0]
        assert not saved.get("erasures")
        await tech.sio.call("call:end", {"sessionId": sid})
        for person in (tech, expert, stranger):
            await person.sio.disconnect()
    asyncio.run(run())


def test_erasing_limits_do_not_partially_modify_drawings(base_url, monkeypatch):
    from app import realtime
    monkeypatch.setattr(realtime, "MAX_ERASE_POLYGONS", 1)

    async def run():
        tech = Person(base_url, "tech")
        await tech.connect()
        sid = (await tech.sio.call("call:start", {}))["session"]["id"]
        await tech.sio.call("session:join", {"sessionId": sid})
        shape = {"id": "limit-test", "tool": "pen", "points": [[0.1, 0.5], [0.9, 0.5]]}
        await tech.sio.call("ann:put", {"sessionId": sid, "shape": shape})
        p = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6]]
        change = {"id": shape["id"], "polygon": p}
        rejected = await tech.sio.call("ann:erase", {"sessionId": sid, "opId": "too-big", "batch": 0, "changes": [change, change]})
        assert not rejected["ok"]
        assert not (await tech.sio.call("session:join", {"sessionId": sid}))["shapes"][0].get("erasures")
        assert (await tech.sio.call("ann:erase", {"sessionId": sid, "opId": "one", "batch": 0, "changes": [change]}))["ok"]
        assert (await tech.sio.call("ann:erase:undo", {"sessionId": sid, "opId": "one"}))["ok"]
        assert (await tech.sio.call("ann:erase", {"sessionId": sid, "opId": "two", "batch": 0, "changes": [change]}))["ok"]
        await tech.sio.call("call:end", {"sessionId": sid})
        await tech.sio.disconnect()
    asyncio.run(run())


async def _whole_call(base_url):
    tech, expert, stranger = Person(base_url, "tech"), Person(base_url, "expert"), Person(base_url, "tech2")
    for p in (tech, expert, stranger):
        await p.connect()

    await expert.sio.emit("expert:available", {"on": True})
    assert await expert.wait_for("queue:update") == []

    checklist_id = tech.http.get("/api/checklists").json()[0]["id"]
    started = await tech.sio.call("call:start", {"aircraft": "vt-abc", "checklistId": checklist_id})
    assert started["ok"]
    session = started["session"]
    sid = session["id"]
    assert session["aircraft"] == "VT-ABC" and session["checklist"]["steps"]
    assert (await tech.sio.call("session:join", {"sessionId": sid}))["ok"]
    queue = await expert.wait_for("queue:update")
    assert [s["id"] for s in queue] == [sid]

    # Someone else's call stays private.
    assert not (await stranger.sio.call("session:join", {"sessionId": sid}))["ok"]
    assert stranger.http.get(f"/api/sessions/{sid}").status_code == 404

    accepted = await expert.sio.call("call:accept", {"sessionId": sid})
    assert accepted["ok"] and accepted["session"]["expert"]["name"] == "Expert"
    assert (await tech.wait_for("call:accepted"))["session"]["status"] == "active"
    assert not (await expert.sio.call("call:accept", {"sessionId": sid}))["ok"], "a call can only be answered once"

    joined = await expert.sio.call("session:join", {"sessionId": sid})
    assert [p["name"] for p in joined["peers"]] == ["Tech"]
    assert (await tech.wait_for("peer:joined"))["user"]["role"] == "expert"

    # Video signals, drawings, pointer and freeze reach the other side only.
    await tech.sio.emit("signal", {"sessionId": sid, "data": {"type": "offer", "sdp": "x"}})
    assert (await expert.wait_for("signal"))["data"]["type"] == "offer"
    shape = {"id": "a1", "tool": "arrow", "color": "#FF6A13", "points": [[0.1, 0.1], [0.5, 0.5]]}
    await expert.sio.emit("ann:put", {"sessionId": sid, "shape": shape})
    assert (await tech.wait_for("ann:put"))["shape"]["id"] == "a1"
    await expert.sio.emit("pointer", {"sessionId": sid, "x": 0.3, "y": 0.4})
    assert (await tech.wait_for("pointer"))["x"] == 0.3
    await expert.sio.emit("freeze", {"sessionId": sid, "frozen": True})
    assert (await tech.wait_for("freeze"))["frozen"] is True
    assert not stranger.received("signal") and not stranger.received("ann:put")

    # Someone who reconnects gets the drawings and freeze state back.
    rejoin = await tech.sio.call("session:join", {"sessionId": sid})
    assert [s["id"] for s in rejoin["shapes"]] == ["a1"] and rejoin["frozen"] is True

    # A drawing's anchor (the picture under it, so it can follow the camera) is sent once;
    # later updates without it keep it, and it comes back on rejoin.
    anchor = {"img": "data:image/jpeg;base64," + "A" * 1000, "box": {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.4}}
    await expert.sio.emit("ann:put", {"sessionId": sid, "shape": {**shape, "anchor": anchor}})
    await expert.sio.emit("ann:put", {"sessionId": sid, "shape": {**shape, "points": [[0.1, 0.1], [0.6, 0.6]]}})
    assert (await tech.wait_for("ann:put"))["shape"]["anchor"] == anchor
    await tech.wait_for("ann:put")
    kept = (await tech.sio.call("session:join", {"sessionId": sid}))["shapes"][0]
    assert kept["anchor"] == anchor and kept["points"][1] == [0.6, 0.6]
    # An oversized anchor is not passed on or kept; the drawing still shows.
    await expert.sio.emit("ann:put", {"sessionId": sid, "shape": {**shape, "anchor": {"img": "x" * 60000, "box": anchor["box"]}}})
    assert (await tech.wait_for("ann:put"))["shape"].get("anchor") is None
    assert (await tech.sio.call("session:join", {"sessionId": sid}))["shapes"][0]["anchor"] == anchor

    # Hand exclusion metadata must be numeric and bounded before it reaches OpenCV.
    bad_anchor = {**anchor, "exclude": {"x": "bad", "y": 0, "w": 1, "h": 1}}
    await expert.sio.call("ann:put", {"sessionId": sid, "shape": {**shape, "anchor": bad_anchor}})
    sanitized = (await tech.wait_for("ann:put"))["shape"]["anchor"]
    assert "exclude" not in sanitized and sanitized["img"] == anchor["img"]

    # The drawing's own area (focus) is checked the same way: a good one passes through, a bad one is dropped.
    good_focus = {"x": 0.2, "y": 0.2, "w": 0.2, "h": 0.2}
    await expert.sio.call("ann:put", {"sessionId": sid, "shape": {**shape, "anchor": {**anchor, "focus": good_focus}}})
    assert (await tech.wait_for("ann:put"))["shape"]["anchor"]["focus"] == good_focus
    for bad in ({"x": "bad", "y": 0, "w": 1, "h": 1}, {"x": 0, "y": 0, "w": 0, "h": 1}, {"x": 0, "y": 0, "w": 1e9, "h": 1}, "oops"):
        await expert.sio.call("ann:put", {"sessionId": sid, "shape": {**shape, "anchor": {**anchor, "focus": bad}}})
        got = (await tech.wait_for("ann:put"))["shape"]["anchor"]
        assert "focus" not in got and got["img"] == anchor["img"], bad

    # Hand drawing starts on; the expert can switch it off, and a rejoin remembers that.
    assert (await tech.sio.call("session:join", {"sessionId": sid}))["hands"] is True
    await expert.sio.emit("hands", {"sessionId": sid, "on": False})
    assert (await tech.wait_for("hands"))["on"] is False
    assert (await tech.sio.call("session:join", {"sessionId": sid}))["hands"] is False

    # Checklist, chat and sign-off are saved.
    steps = session["checklist"]["steps"]
    assert not (await expert.sio.call("signoff", {"sessionId": sid}))["ok"], "sign-off needs every step"
    for i in range(len(steps)):
        status = "problem" if i == 2 else "done"
        assert (await tech.sio.call("step:set", {"sessionId": sid, "step": i, "status": status, "note": "chafing" if i == 2 else ""}))["ok"]
    assert (await expert.wait_for("step:update"))["step"] == 0
    assert (await tech.sio.call("msg", {"sessionId": sid, "kind": "chat", "text": "Torque is 25 Nm"}))["ok"]
    assert (await expert.wait_for("event:new"))["text"] == "Torque is 25 Nm"
    assert not (await tech.sio.call("signoff", {"sessionId": sid}))["ok"], "technicians cannot sign off"
    assert (await expert.sio.call("signoff", {"sessionId": sid}))["ok"]
    assert (await tech.wait_for("signoff:update"))["by"] == "Expert"

    # A photo can be added and read back.
    photo = expert.http.post(f"/api/sessions/{sid}/files", data={"kind": "photo"},
                             files={"file": ("frame.jpg", b"\xff\xd8\xff fake jpeg", "image/jpeg")})
    assert photo.status_code == 200
    assert tech.http.get(f"/api/files/{photo.json()['id']}").content.startswith(b"\xff\xd8")
    in_address = httpx.get(f"{base_url}/api/files/{photo.json()['id']}", params={"user": "tech"})  # how <img> asks
    assert in_address.content.startswith(b"\xff\xd8")
    assert expert.http.post(f"/api/sessions/{sid}/files", data={"kind": "photo"},
                            files={"file": ("x.exe", b"MZ", "application/octet-stream")}).status_code == 400

    await expert.sio.emit("call:end", {"sessionId": sid})
    assert (await tech.wait_for("call:ended"))["status"] == "ended"

    saved = tech.http.get(f"/api/sessions/{sid}").json()
    assert saved["status"] == "ended" and saved["annotationCount"] == 1
    assert saved["signedOff"]["by"] == "Expert"
    assert [s["status"] for s in saved["steps"]].count("problem") == 1
    assert {e["kind"] for e in saved["events"]} == {"chat", "photo"}
    assert [s["id"] for s in tech.http.get("/api/sessions", params={"q": "vt-abc"}).json()] == [sid]
    assert [s["id"] for s in expert.http.get("/api/sessions", params={"q": f"SES-{sid:06d}"}).json()] == [sid]
    assert expert.http.get("/api/stats").json()["answered"] == 1

    for p in (tech, expert, stranger):
        await p.sio.disconnect()


def test_call_left_open_is_ended(base_url, monkeypatch):
    """Both people close their browsers mid-call: the call must not stay 'in progress' forever."""
    from app import realtime
    monkeypatch.setattr(realtime, "ABANDON_AFTER", 0.3)

    async def run():
        tech, expert = Person(base_url, "tech"), Person(base_url, "expert")
        await tech.connect()
        await expert.connect()
        sid = (await tech.sio.call("call:start", {}))["session"]["id"]
        await tech.sio.call("session:join", {"sessionId": sid})
        await expert.sio.call("call:accept", {"sessionId": sid})
        await expert.sio.call("session:join", {"sessionId": sid})
        await tech.sio.disconnect()
        await expert.sio.disconnect()
        await asyncio.sleep(0.8)
        saved = expert.http.get(f"/api/sessions/{sid}").json()
        assert saved["status"] == "ended" and saved["endedAt"]
    asyncio.run(run())


def test_unanswered_call_is_recorded_as_missed(base_url):
    async def run():
        tech = Person(base_url, "tech")
        await tech.connect()
        sid = (await tech.sio.call("call:start", {"aircraft": "VT-XYZ"}))["session"]["id"]
        await tech.sio.call("session:join", {"sessionId": sid})
        await tech.sio.emit("call:end", {"sessionId": sid, "reason": "timeout"})
        assert (await tech.wait_for("call:ended"))["status"] == "missed"
        await tech.sio.disconnect()
    asyncio.run(run())
