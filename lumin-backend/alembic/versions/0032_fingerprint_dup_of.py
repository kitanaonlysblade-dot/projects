"""scan: link whole-video copies to the original post

Revision ID: 0032_fingerprint_dup_of
Revises: 0031_sponsored_reveals
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0032_fingerprint_dup_of"
down_revision = "0031_sponsored_reveals"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("video_fingerprints")}
    if "dup_of_id" not in cols:
        op.add_column(
            "video_fingerprints",
            sa.Column("dup_of_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True),
        )
        op.create_index("ix_video_fingerprints_dup_of_id", "video_fingerprints", ["dup_of_id"])


def downgrade() -> None:
    op.drop_index("ix_video_fingerprints_dup_of_id", table_name="video_fingerprints")
    op.drop_column("video_fingerprints", "dup_of_id")
