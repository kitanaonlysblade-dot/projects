"""wanted requests are grouped by moment: twin_searches.request_key

Revision ID: 0013_request_key
Revises: 0012_wanted_offers
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_request_key"
down_revision = "0012_wanted_offers"
branch_labels = None
depends_on = None


def _cols(insp, table):
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    # Idempotent: on a fresh database the baseline already built this from the models.
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "request_key" not in _cols(insp, "twin_searches"):
        op.add_column("twin_searches", sa.Column("request_key", sa.String(120), nullable=False, server_default=""))
        op.create_index("ix_twin_searches_request_key", "twin_searches", ["request_key"])
    # Every existing request keeps the key it already had.
    op.execute("UPDATE twin_searches SET request_key = query_key WHERE request_key = ''")
    if "request_key" not in _cols(insp, "wanted_offers"):
        op.alter_column("wanted_offers", "query_key", new_column_name="request_key")
        op.execute("ALTER INDEX IF EXISTS ix_wanted_offers_query_key RENAME TO ix_wanted_offers_request_key")


def downgrade() -> None:
    op.execute("ALTER INDEX IF EXISTS ix_wanted_offers_request_key RENAME TO ix_wanted_offers_query_key")
    op.alter_column("wanted_offers", "request_key", new_column_name="query_key")
    op.drop_index("ix_twin_searches_request_key", table_name="twin_searches")
    op.drop_column("twin_searches", "request_key")
