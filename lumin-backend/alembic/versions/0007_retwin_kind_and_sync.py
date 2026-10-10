"""retwin_kind (video | product) and sync_offset_ms on video_posts

Revision ID: 0007_retwin_kind_and_sync
Revises: 0006_retwin_twins_link
Create Date: 2026-10-06
"""
from alembic import op

revision = "0007_retwin_kind_and_sync"
down_revision = "0006_retwin_twins_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE video_posts ADD COLUMN IF NOT EXISTS retwin_kind VARCHAR(10)")
    op.execute("ALTER TABLE video_posts ADD COLUMN IF NOT EXISTS sync_offset_ms INTEGER NOT NULL DEFAULT 0")
    # Existing retwins: a retwin that reused the original's media was a
    # tag-only (product) retwin; anything else carries its own video.
    op.execute(
        "UPDATE video_posts r SET retwin_kind = CASE WHEN r.video_url = o.video_url THEN 'product' ELSE 'video' END "
        "FROM video_posts o WHERE r.retwin_of_id = o.id AND r.retwin_kind IS NULL"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE video_posts DROP COLUMN IF EXISTS sync_offset_ms")
    op.execute("ALTER TABLE video_posts DROP COLUMN IF EXISTS retwin_kind")
