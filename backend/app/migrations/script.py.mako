"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}

Only add things (new tables; new columns that may be empty or have a server_default),
so older code can still run on this database. Name every new foreign key.
"""

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}
revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}
