"""moderation: review queue, word filter, video hold

Revision ID: 0029_moderation
Revises: 0028_apple_sub
Create Date: 2026-10-13
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0029_moderation"
down_revision = "0028_apple_sub"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built all of this from the models.
    insp = sa.inspect(op.get_bind())
    uid = postgresql.UUID(as_uuid=True)
    if not insp.has_table("moderation_items"):
        op.create_table(
            "moderation_items",
            sa.Column("id", uid, primary_key=True),
            sa.Column("target_type", sa.String(20), nullable=False),
            sa.Column("target_id", uid, nullable=False),
            sa.Column("owner_id", uid, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("source", sa.String(10), nullable=False),
            sa.Column("category", sa.String(40), nullable=False),
            sa.Column("score", sa.Float, nullable=True),
            sa.Column("detail", sa.String(500), nullable=True),
            sa.Column("content_key", sa.String(300), nullable=False, server_default=""),
            sa.Column("severity", sa.String(10), nullable=False, server_default="review"),
            sa.Column("status", sa.String(10), nullable=False, server_default="pending"),
            sa.Column("resolved_by_id", uid, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("resolution_note", sa.String(500), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("ix_moderation_items_target", "moderation_items", ["target_type", "target_id"])
        op.create_index("ix_moderation_items_owner_id", "moderation_items", ["owner_id"])
        op.create_index("ix_moderation_items_status", "moderation_items", ["status"])
    if not insp.has_table("moderation_terms"):
        op.create_table(
            "moderation_terms",
            sa.Column("id", uid, primary_key=True),
            sa.Column("term", sa.String(100), nullable=False, unique=True),
            sa.Column("action", sa.String(5), nullable=False, server_default="block"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
    cols = {c["name"] for c in insp.get_columns("video_posts")}
    if "moderation_hold" not in cols:
        op.add_column("video_posts", sa.Column("moderation_hold", sa.Boolean, nullable=False, server_default=sa.text("false")))
        op.create_index("ix_video_posts_moderation_hold", "video_posts", ["moderation_hold"])


def downgrade() -> None:
    op.drop_index("ix_video_posts_moderation_hold", table_name="video_posts")
    op.drop_column("video_posts", "moderation_hold")
    op.drop_table("moderation_terms")
    op.drop_table("moderation_items")
