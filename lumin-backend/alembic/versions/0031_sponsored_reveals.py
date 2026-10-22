"""sponsored twins: count how often the collapsed row is opened

Revision ID: 0031_sponsored_reveals
Revises: 0030_sponsored_twins
Create Date: 2026-10-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0031_sponsored_reveals"
down_revision = "0030_sponsored_twins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("sponsored_twins")}
    if "reveals" not in cols:
        op.add_column("sponsored_twins", sa.Column("reveals", sa.Integer, nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("sponsored_twins", "reveals")
