"""sponsored twins: pay per sale (the sale percent and fee on the order; which twin a cart line / payment came from)

Revision ID: 0039_sponsored_sale_fee
Revises: 0038_sponsored_style_pairs
Create Date: 2026-10-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0039_sponsored_sale_fee"
down_revision = "0038_sponsored_style_pairs"
branch_labels = None
depends_on = None


def _twin_col() -> sa.Column:
    return sa.Column("sponsored_twin_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sponsored_twins.id", ondelete="SET NULL"), nullable=True)


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    insp = sa.inspect(op.get_bind())
    for table in ("cart_items", "payments", "orders"):
        if "sponsored_twin_id" not in {c["name"] for c in insp.get_columns(table)}:
            op.add_column(table, _twin_col())
    order_cols = {c["name"] for c in insp.get_columns("orders")}
    if "sponsored_fee_percent" not in order_cols:
        op.add_column("orders", sa.Column("sponsored_fee_percent", sa.Numeric(5, 2), nullable=True))
    if "sponsored_fee" not in order_cols:
        op.add_column("orders", sa.Column("sponsored_fee", sa.Numeric(10, 2), nullable=True))
    if "ix_orders_sponsored_twin_id" not in {i["name"] for i in insp.get_indexes("orders")}:
        op.create_index("ix_orders_sponsored_twin_id", "orders", ["sponsored_twin_id"])


def downgrade() -> None:
    op.drop_index("ix_orders_sponsored_twin_id", table_name="orders")
    op.drop_column("orders", "sponsored_fee")
    op.drop_column("orders", "sponsored_fee_percent")
    for table in ("orders", "payments", "cart_items"):
        op.drop_column(table, "sponsored_twin_id")
