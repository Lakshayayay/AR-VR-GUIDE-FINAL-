"""Create accounts from the command line.

uv run python -m app.cli create-user asha "Asha Rao" admin
"""

import argparse

from sqlalchemy import select

from .db import ROLES, SessionLocal, User, init_db


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-user", help="add a person")
    create.add_argument("username")
    create.add_argument("name")
    create.add_argument("role", choices=ROLES)
    args = parser.parse_args()

    init_db()
    username = args.username.strip().lower()
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.username == username)):
            raise SystemExit(f"The username {username} is taken.")
        db.add(User(username=username, name=args.name, role=args.role))
        db.commit()
    print(f"Created {args.role} '{username}'.")


if __name__ == "__main__":
    main()
