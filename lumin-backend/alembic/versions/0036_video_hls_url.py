"""video posts: hls_url (adaptive streaming version)

Revision ID: 0036_video_hls_url
Revises: 0035_scan_copy_checked
Create Date: 2026-10-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0036_video_hls_url"
down_revision = "0035_scan_copy_checked"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("video_posts")}
    if "hls_url" not in cols:
        op.add_column("video_posts", sa.Column("hls_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("video_posts", "hls_url")
