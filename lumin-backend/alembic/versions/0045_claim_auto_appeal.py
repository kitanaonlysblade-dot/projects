"""return_claims: auto_resolved flag and the losing side's one appeal

Revision ID: 0045_claim_auto_appeal
Revises: 0044_shipment_resolution
Create Date: 2026-10-21
"""
from alembic import op
import sqlalchemy as sa

revision = "0045_claim_auto_appeal"
down_revision = "0044_shipment_resolution"
branch_labels = None
depends_on = None

COLS = [
    ("auto_resolved", sa.Boolean(), False),
    ("appeal_by", sa.String(10), True),
    ("appeal_note", sa.String(1000), True),
    ("appealed_at", sa.DateTime(timezone=True), True),
    ("appeal_outcome", sa.String(30), True),
]


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built these from the models.
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("return_claims")}
    for name, typ, nullable in COLS:
        if name in have:
            continue
        if nullable:
            op.add_column("return_claims", sa.Column(name, typ, nullable=True))
        else:
            op.add_column("return_claims", sa.Column(name, typ, nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    for name, _, _ in COLS:
        op.drop_column("return_claims", name)
