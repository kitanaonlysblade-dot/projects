"""seal_batches, seal_bags, seal_events, live_tests: QR-coded tamper-proof bags and the live test before sealing

Revision ID: 0041_seal_bags
Revises: 0040_product_profiles
Create Date: 2026-10-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0041_seal_bags"
down_revision = "0040_product_profiles"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    insp = sa.inspect(op.get_bind())
    if insp.has_table("seal_bags"):
        return
    op.create_table(
        "seal_batches",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("count", sa.Integer, nullable=False),
        sa.Column("created_by_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        *_ts(),
    )
    op.create_table(
        "seal_bags",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("batch_id", UUID, sa.ForeignKey("seal_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("serial", sa.String(20), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="unused"),
        sa.Column("seller_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("test_id", UUID, nullable=True),
        sa.Column("sealed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("void_reason", sa.String(300), nullable=True),
        *_ts(),
    )
    op.create_index("ix_seal_bags_batch_id", "seal_bags", ["batch_id"])
    op.create_index("ix_seal_bags_serial", "seal_bags", ["serial"], unique=True)
    op.create_index("ix_seal_bags_code_hash", "seal_bags", ["code_hash"], unique=True)
    op.create_index("ix_seal_bags_status", "seal_bags", ["status"])
    op.create_index("ix_seal_bags_seller_id", "seal_bags", ["seller_id"])
    op.create_index("ix_seal_bags_order_id", "seal_bags", ["order_id"])
    op.create_table(
        "seal_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("bag_id", UUID, sa.ForeignKey("seal_bags.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(20), nullable=True),
        sa.Column("to_status", sa.String(20), nullable=False),
        sa.Column("actor_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_seal_events_bag_id", "seal_events", ["bag_id"])
    op.create_table(
        "live_tests",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("order_id", UUID, sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seller_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bag_id", UUID, sa.ForeignKey("seal_bags.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(12), nullable=False, server_default="recording"),
        sa.Column("order_code", sa.String(8), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("sealed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_duration_s", sa.Float, nullable=True),
        sa.Column("video_key", sa.String(300), nullable=True),
        sa.Column("video_private", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("video_sha256", sa.String(64), nullable=True),
        sa.Column("video_bytes", sa.Integer, nullable=True),
        sa.Column("checklist", postgresql.ARRAY(sa.String), nullable=False, server_default="{}"),
        sa.Column("note", sa.String(300), nullable=True),
        *_ts(),
    )
    op.create_index("ix_live_tests_order_id", "live_tests", ["order_id"])
    op.create_index("ix_live_tests_seller_id", "live_tests", ["seller_id"])
    op.create_index("ix_live_tests_bag_id", "live_tests", ["bag_id"])
    op.create_index(
        "uq_live_tests_one_sealed_per_order", "live_tests", ["order_id"], unique=True, postgresql_where=sa.text("status = 'sealed'")
    )


def downgrade() -> None:
    for t in ("live_tests", "seal_events", "seal_bags", "seal_batches"):
        op.drop_table(t)
