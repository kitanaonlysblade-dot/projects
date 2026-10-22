"""sponsored twins: a seller promotes a product on the scan result screen

Revision ID: 0030_sponsored_twins
Revises: 0029_moderation
Create Date: 2026-10-16
"""
from alembic import op
from sqlalchemy.dialects import postgresql
import sqlalchemy as sa

revision = "0030_sponsored_twins"
down_revision = "0029_moderation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    insp = sa.inspect(op.get_bind())
    if insp.has_table("sponsored_twins"):
        return
    op.create_table(
        "sponsored_twins",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("impressions", sa.Integer, nullable=False, server_default="0"),
        sa.Column("clicks", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_sponsored_twins_active", "sponsored_twins", ["active"])


def downgrade() -> None:
    op.drop_table("sponsored_twins")
