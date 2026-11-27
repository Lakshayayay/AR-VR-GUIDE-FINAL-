"""First run: the very first admin is created from the sign-in screen, and only then."""

import asyncio
import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="arguide-test-"))

import httpx  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.auth import get_db  # noqa: E402
from app.db import Base  # noqa: E402
from app.main import api  # noqa: E402


def test_first_admin_only_while_there_are_no_people():
    empty = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(empty)
    Session = sessionmaker(empty, expire_on_commit=False)

    def own_db():
        with Session() as db:
            yield db

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test") as client:
            assert (await client.post("/api/auth/setup", json={"name": "   "})).status_code == 422
            made = await client.post("/api/auth/setup", json={"name": "  Priya O'Neil  "})
            assert made.status_code == 200
            assert made.json() == {"id": 1, "username": "priya.o.neil", "name": "Priya O'Neil", "role": "admin", "active": True}
            assert (await client.post("/api/auth/setup", json={"name": "Someone Else"})).status_code == 409
            assert [p["username"] for p in (await client.get("/api/auth/people")).json()] == ["priya.o.neil"]

    api.dependency_overrides[get_db] = own_db
    try:
        asyncio.run(run())
    finally:
        api.dependency_overrides.clear()


def test_a_name_without_latin_letters_still_gets_a_username():
    from app.auth import username_from

    assert username_from("प्रिया") == "admin"
    assert username_from("A") == "admin"
    assert username_from("x" * 90) == "x" * 64


def test_concurrent_setup_creates_one_admin(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'setup.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(engine, expire_on_commit=False)

    def own_db():
        with Session() as db:
            yield db

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api), base_url="http://test") as client:
            responses = await asyncio.gather(*(
                client.post("/api/auth/setup", json={"name": f"Admin {i}"}) for i in range(8)
            ))
            assert sorted(r.status_code for r in responses) == [200] + [409] * 7

    api.dependency_overrides[get_db] = own_db
    try:
        asyncio.run(run())
    finally:
        api.dependency_overrides.clear()
        engine.dispose()
