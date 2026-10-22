"""shipments: refusal photo, how a refused/lost shipment was settled, and reminder stamps

Revision ID: 0044_shipment_resolution
Revises: 0043_seal_packs
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa

revision = "0044_shipment_resolution"
down_revision = "0043_seal_packs"
branch_labels = None
depends_on = None

COLS = [
    ("refusal_photo_url", sa.String(500)),
    ("resolution", sa.String(30)),
    ("loss_party", sa.String(20)),
    ("resolved_at", sa.DateTime(timezone=True)),
    ("pickup_reminded_at", sa.DateTime(timezone=True)),
    ("transit_reminded_at", sa.DateTime(timezone=True)),
]


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("shipments")}
    for name, typ in COLS:
        if name not in have:
            op.add_column("shipments", sa.Column(name, typ, nullable=True))


def downgrade() -> None:
    for name, _ in COLS:
        op.drop_column("shipments", name)
