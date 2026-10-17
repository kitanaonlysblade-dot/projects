"""comment reactions, pinned comments, reply mentions, new notification types

Revision ID: 0002_comment_reactions
Revises: 0001_baseline
Create Date: 2026-10-04

Replaces the comment half of the old app/ensure_schema.py. Every statement
is idempotent so it is safe on databases that already had it applied.
"""
from alembic import op
from sqlalchemy import inspect, text

revision = "0002_comment_reactions"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

NEW_NOTIFICATION_TYPES = ("post_like", "post_comment", "comment_reply", "comment_reaction")


def upgrade() -> None:
    from app.models import comment_reactions

    bind = op.get_bind()
    insp = inspect(bind)
    if insp.has_table("comments"):
        comment_reactions.create(bind=bind, checkfirst=True)
        for ddl in (
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ",
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS reply_to_user_id UUID",
            "ALTER TABLE comments ADD COLUMN IF NOT EXISTS reply_to_name VARCHAR(120)",
        ):
            op.execute(ddl)
        if insp.has_table("comment_likes"):
            op.execute(
                "INSERT INTO comment_reactions (user_id, comment_id, reaction) "
                "SELECT user_id, comment_id, 'like' FROM comment_likes ON CONFLICT DO NOTHING"
            )
    # ALTER TYPE ... ADD VALUE cannot run inside the migration transaction.
    with op.get_context().autocommit_block():
        for value in NEW_NOTIFICATION_TYPES:
            op.execute(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # Dropping user data (reactions) on a downgrade is never what you want
    # by accident, so this is intentionally a no-op.
    pass
