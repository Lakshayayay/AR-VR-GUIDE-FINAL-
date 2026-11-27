"""Who is asking, and what their role may do.

There is NO sign-in for now: the app says which person it is acting as, and the server believes it.
Anyone who can reach the app can act as anyone, so keep it off the public internet.
Google sign-in will replace `find_person`; the role checks stay as they are.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from .db import SessionLocal, User, user_out

HEADER = "x-arguide-user"


def get_db():
    with SessionLocal() as db:
        yield db


def find_person(db, username) -> User | None:
    if not isinstance(username, str):
        return None
    return db.scalar(select(User).where(User.username == username, User.active))


def current_user(request: Request, db=Depends(get_db)) -> User:
    # Pictures and videos cannot send a header, so their addresses carry ?user= instead.
    name = request.headers.get(HEADER)
    if not name and request.method == "GET":
        name = request.query_params.get("user")
    user = find_person(db, name)
    if not user:
        raise HTTPException(401, "Choose who you are to continue.")
    return user


def require_role(*roles: str):
    def check(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Your account does not have access to this.")
        return user

    return check


router = APIRouter(prefix="/api/auth")


@router.get("/people")
def people(db=Depends(get_db)):
    """The pick-a-person screen."""
    return [user_out(u) for u in db.scalars(select(User).where(User.active).order_by(User.id))]


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)
