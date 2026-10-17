"""verified original badge on video posts

Revision ID: 0024_verified_original
Revises: 0023_push_subscriptions
Create Date: 2026-10-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0024_verified_original"
down_revision = "0023_push_subscriptions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built the column from the models.
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("video_posts")}
    if "verified_original" not in have:
        op.add_column("video_posts", sa.Column("verified_original", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Same rule as app/scan_service.py refresh_verified: a good fingerprint of the current video and no blocking flag.
    op.execute(
        """
        UPDATE video_posts p SET verified_original = true
        WHERE EXISTS (
            SELECT 1 FROM video_fingerprints f
            WHERE f.video_post_id = p.id AND f.video_url = p.video_url AND f.status = 'ok'
        )
        AND NOT EXISTS (
            SELECT 1 FROM video_match_flags m
            WHERE (m.video_post_id = p.id AND m.status IN ('open', 'confirmed'))
               OR (m.earlier_post_id = p.id AND m.status = 'open')
        )
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE video_posts DROP COLUMN IF EXISTS verified_original")
