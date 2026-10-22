"""product_profiles: what each product is, as read by an AI model (kind, style, audience, colours)

Revision ID: 0040_product_profiles
Revises: 0039_sponsored_sale_fee
Create Date: 2026-10-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0040_product_profiles"
down_revision = "0039_sponsored_sale_fee"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    if sa.inspect(op.get_bind()).has_table("product_profiles"):
        return
    op.create_table(
        "product_profiles",
        sa.Column("product_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.String(30), nullable=True),
        sa.Column("style", sa.String(20), nullable=True),
        sa.Column("audience", sa.String(20), nullable=True),
        sa.Column("colors", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("source", sa.String(10), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("product_profiles")
