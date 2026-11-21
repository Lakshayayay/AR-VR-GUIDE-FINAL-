"""Create accounts from the command line.

uv run python -m app.cli create-user asha "Asha Rao" admin
"""

import argparse
import getpass

from sqlalchemy import select

from .auth import hash_password
from .db import ROLES, SessionLocal, User, init_db


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-user", help="add a person who can sign in")
    create.add_argument("username")
    create.add_argument("name")
    create.add_argument("role", choices=ROLES)
    create.add_argument("--password", help="leave out to be asked for it")
    args = parser.parse_args()

    init_db()
    username = args.username.strip().lower()
    password = args.password or getpass.getpass("Password (at least 8 characters): ")
    if len(password) < 8:
        raise SystemExit("The password must be at least 8 characters.")
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.username == username)):
            raise SystemExit(f"The username {username} is taken.")
        db.add(User(username=username, name=args.name, role=args.role, password_hash=hash_password(password)))
        db.commit()
    print(f"Created {args.role} '{username}'.")


if __name__ == "__main__":
    main()
