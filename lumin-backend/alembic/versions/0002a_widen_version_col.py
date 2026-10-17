"""widen alembic_version.version_num

Revision ID: 0002a_widen_version_col
Revises: 0002_comment_reactions
Create Date: 2026-10-04

Alembic creates alembic_version.version_num as VARCHAR(32) by default —
fine for its own auto-generated 12-character hex ids, but this project
uses longer, descriptive revision ids instead, and the first one past 32
characters (0003_video_analytics_and_attribution, 36 chars) fails with
"value too long for type character varying(32)" the moment Alembic
tries to record it — even though that migration's own schema changes
had already run; transactional DDL means the whole step then rolls
back, schema changes included, leaving the DB still stamped at 0002.

Widening the column once here, early in the chain, means every
migration after this one can actually be recorded, however long its id
ends up being.

Inserted as its own step between 0002 and 0003, rather than folded into
either: 0002 may already be applied wherever this runs, and rewriting
an already-applied migration's content is worse than adding one more
small one after it. Revision id kept deliberately short (this file's
own id is 23 characters) — it has to be recorded under the OLD 32-char
limit, since this migration is what raises it.
"""
from alembic import op
import sqlalchemy as sa

revision = "0002a_widen_version_col"
down_revision = "0002_comment_reactions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 255, not just-barely-36 — the point is for this to stop being a
    # recurring problem as future migrations pick their own descriptive
    # names, not to exactly fit the longest id that happens to exist
    # today.
    op.alter_column(
        "alembic_version",
        "version_num",
        type_=sa.String(length=255),
        existing_type=sa.String(length=32),
    )


def downgrade() -> None:
    op.alter_column(
        "alembic_version",
        "version_num",
        type_=sa.String(length=32),
        existing_type=sa.String(length=255),
    )
