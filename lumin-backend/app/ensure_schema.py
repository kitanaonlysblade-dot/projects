"""Idempotent, additive schema upgrades for the comment-system rewrite
(reactions, pinned comments, reply-to-reply mentions, real "edited" flag).

Why this exists next to Alembic: the project's entrypoint only
auto-generates a migration when alembic/versions is empty, so a database
that was already set up won't get new columns/tables on its own. Every
statement here is safe to run any number of times (IF NOT EXISTS /
checkfirst), runs at API start-up, and never drops or rewrites data.
"""

import logging

from sqlalchemy import inspect, text

from app.database import engine
from app.models import comment_reactions

log = logging.getLogger(__name__)


def ensure_comment_schema() -> None:
    try:
        insp = inspect(engine)
        # Nothing to upgrade on a database Alembic hasn't created yet —
        # the migration it generates already includes all of this.
        if not insp.has_table("comments"):
            return

        comment_reactions.create(bind=engine, checkfirst=True)

        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE"))
            conn.execute(text("ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ"))
            conn.execute(text("ALTER TABLE comments ADD COLUMN IF NOT EXISTS reply_to_user_id UUID"))
            conn.execute(text("ALTER TABLE comments ADD COLUMN IF NOT EXISTS reply_to_name VARCHAR(120)"))
            # Old single-heart likes become "like" reactions (no-op once
            # copied; the primary key makes re-runs harmless).
            if insp.has_table("comment_likes"):
                conn.execute(
                    text(
                        "INSERT INTO comment_reactions (user_id, comment_id, reaction) "
                        "SELECT user_id, comment_id, 'like' FROM comment_likes "
                        "ON CONFLICT DO NOTHING"
                    )
                )

        # ALTER TYPE ... ADD VALUE can't run inside a multi-statement
        # transaction block, so this gets its own autocommit connection
        # rather than sharing the engine.begin() one above.
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            for value in ("post_like", "post_comment", "comment_reply", "comment_reaction"):
                conn.execute(text(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'"))
    except Exception:  # never stop the API from booting over this
        log.exception("ensure_comment_schema failed — run the migration by hand")
