"""Passwords, sign-in cookie, and role checks."""

import time
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select

from .config import COOKIE_SECURE, DEV_NO_LOGIN, SECRET_KEY
from .db import SessionLocal, User, user_out

COOKIE = "arguide_session"
WEB_HOURS = 12
_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("not-a-real-password")  # keeps unknown-user logins as slow as real ones


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(hashed: str, password: str) -> bool:
    try:
        return _hasher.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        return False


def make_token(user_id: int, kind: str, ttl: timedelta) -> str:
    return jwt.encode({"sub": str(user_id), "kind": kind, "exp": datetime.now(UTC) + ttl}, SECRET_KEY, algorithm="HS256")


def read_token(token: str | None, kind: str) -> int | None:
    if not token:
        return None
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return int(data["sub"]) if data.get("kind") == kind else None


def get_db():
    with SessionLocal() as db:
        yield db


def current_user(request: Request, db=Depends(get_db)) -> User:
    if DEV_NO_LOGIN:
        # The tab says who it is; pictures (which cannot send that) are fetched as the first expert.
        name = request.headers.get("x-dev-user")
        user = db.scalar(select(User).where(User.username == name)) if name else db.scalar(
            select(User).where(User.role.in_(("expert", "admin")), User.active).order_by(User.id))
        if user and user.active:
            return user
    uid = read_token(request.cookies.get(COOKIE), "web")
    user = db.get(User, uid) if uid else None
    if not user or not user.active:
        raise HTTPException(401, "Sign in to continue.")
    return user


def require_role(*roles: str):
    def check(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Your account does not have access to this.")
        return user

    return check


# ponytail: in-memory attempt counter, one process only. Move to the database if more servers are added.
_failures: dict[str, list[float]] = {}


def _locked(username: str) -> bool:
    recent = [t for t in _failures.get(username, []) if time.time() - t < 60]
    _failures[username] = recent
    return len(recent) >= 5


class LoginIn(BaseModel):
    username: str
    password: str


router = APIRouter(prefix="/api/auth")


@router.post("/login")
def login(body: LoginIn, response: Response, db=Depends(get_db)):
    username = body.username.strip().lower()
    if _locked(username):
        raise HTTPException(429, "Too many attempts. Wait one minute, then try again.")
    user = db.scalar(select(User).where(User.username == username))
    ok = verify_password(user.password_hash if user else _DUMMY_HASH, body.password)
    if not (user and user.active and ok):
        _failures.setdefault(username, []).append(time.time())
        raise HTTPException(401, "Wrong username or password.")
    _failures.pop(username, None)
    response.set_cookie(
        COOKIE, make_token(user.id, "web", timedelta(hours=WEB_HOURS)),
        max_age=WEB_HOURS * 3600, httponly=True, samesite="lax", secure=COOKIE_SECURE,
    )
    return user_out(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.get("/socket-token")
def socket_token(user: User = Depends(current_user)):
    """Short-lived pass for the live connection, which may run on another address."""
    return {"token": make_token(user.id, "socket", timedelta(minutes=2))}
