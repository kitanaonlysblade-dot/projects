"""scan a video: fingerprints, scan log, duplicate flags

Revision ID: 0018_scan
Revises: 0017_payment_user_set_null
Create Date: 2026-10-11
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0018_scan"
down_revision = "0017_payment_user_set_null"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    have = sa.inspect(op.get_bind())
    uid = postgresql.UUID(as_uuid=True)
    if not have.has_table("video_fingerprints"):
        op.create_table(
            "video_fingerprints",
            sa.Column("id", uid, primary_key=True),
            sa.Column("video_post_id", uid, sa.ForeignKey("video_posts.id", ondelete="CASCADE"), nullable=False, unique=True),
            sa.Column("video_url", sa.String(500), nullable=False),
            sa.Column("version", sa.String(30), nullable=False),
            sa.Column("status", sa.String(12), nullable=False),
            sa.Column("error", sa.String(300), nullable=True),
            sa.Column("duration_s", sa.Float(), nullable=True),
            sa.Column("data", sa.LargeBinary(), nullable=True),
            *_ts(),
        )
    if not have.has_table("video_scans"):
        op.create_table(
            "video_scans",
            sa.Column("id", uid, primary_key=True),
            sa.Column("video_post_id", uid, sa.ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("user_id", uid, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("found", sa.Boolean(), nullable=False),
            sa.Column("stage", sa.String(60), nullable=True),
            sa.Column("clip_s", sa.Float(), nullable=True),
            *_ts(),
        )
        op.create_index("ix_video_scans_video_post_id", "video_scans", ["video_post_id"])
    if not have.has_table("video_match_flags"):
        op.create_table(
            "video_match_flags",
            sa.Column("id", uid, primary_key=True),
            sa.Column("video_post_id", uid, sa.ForeignKey("video_posts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("earlier_post_id", uid, sa.ForeignKey("video_posts.id", ondelete="CASCADE"), nullable=False),
            sa.Column("stage", sa.String(60), nullable=False),
            sa.Column("status", sa.String(12), nullable=False),
            sa.Column("note", sa.String(300), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolved_by", uid, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("video_post_id", "earlier_post_id", name="uq_match_flag_pair"),
        )
        op.create_index("ix_video_match_flags_video_post_id", "video_match_flags", ["video_post_id"])
        op.create_index("ix_video_match_flags_earlier_post_id", "video_match_flags", ["earlier_post_id"])
        op.create_index("ix_video_match_flags_status", "video_match_flags", ["status"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS video_match_flags")
    op.execute("DROP TABLE IF EXISTS video_scans")
    op.execute("DROP TABLE IF EXISTS video_fingerprints")
