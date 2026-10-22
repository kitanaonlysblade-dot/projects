"""scan: re-check old fingerprints for whole-video copies, and retire the automatic review flags

Revision ID: 0035_scan_copy_checked
Revises: 0034_twin_flagged_notification
Create Date: 2026-10-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0035_scan_copy_checked"
down_revision = "0034_twin_flagged_notification"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in sa.inspect(bind).get_columns("video_fingerprints")}
    if "copy_checked" not in cols:
        # Existing rows start unchecked: the worker links their copies one by one when idle (scan_service.relink_one).
        op.add_column("video_fingerprints", sa.Column("copy_checked", sa.Boolean, nullable=False, server_default=sa.false()))
    # Reviews are opened by reports now. Ones the old automatic check opened are closed, so the videos they held get
    # their verified badge back (the worker refreshes every badge as it re-checks each video).
    op.execute(
        "UPDATE video_match_flags SET status = 'dismissed', note = 'Automatic match (no longer used)', resolved_at = now() "
        "WHERE status = 'open' AND stage <> 'reported'"
    )


def downgrade() -> None:
    op.drop_column("video_fingerprints", "copy_checked")
