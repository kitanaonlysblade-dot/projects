import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class ReturnClaimStatus(str, enum.Enum):
    # Every claim starts here now — filing one no longer refunds in the
    # same request (see routers/orders.py's report_defect and its own
    # comment on what changed). Sits here until an admin resolves it via
    # routers/admin.py; refund_for_defect (app/escrow.py) only ever runs
    # from that resolution now, never from the filing route itself.
    pending_review = "pending_review"
    # Admin approved the claim — refund_for_defect has already run by
    # the time a row reaches this status, not the other way around.
    refunded = "refunded"
    # Admin denied the claim — no refund; order's payout_status is left
    # exactly as it was (see sweep_auto_releases in app/escrow.py, which
    # picks it back up for auto-release once denied clears the way).
    denied = "denied"


class ReturnClaim(Base, TimestampMixin):
    """A buyer's filed "this arrived defective" report — its own table
    rather than columns on Order, since a claim is an evidentiary event
    with its own record (who filed it, when, what proof), not a
    property of the order itself. One per order (unique on order_id) —
    report_defect's own check on an existing claim already blocks
    filing a second one for the same order regardless of this row's
    status, so a denied claim can't just be re-filed to try again.

    video_url is required and — per how this is actually collected on
    the frontend (an in-browser camera recorder, MediaRecorder against
    getUserMedia, with no file-picker fallback) — is always freshly
    recorded, never an existing file from a gallery. That's a frontend
    UI guarantee, not something this column or any backend check can
    itself verify: a video file, once uploaded, carries no reliable
    signal of whether it was just recorded or picked from a gallery.
    Worth being honest about rather than implying the backend enforces
    something only the UI actually does.

    seller_response is the seller's one-shot rebuttal, not a back-and-
    forth thread — deliberately simple for v1; a real messaging thread
    between buyer/seller/admin can replace this later if a single
    rebuttal turns out not to be enough. resolution_note is the admin's
    own reasoning, shown back to the buyer regardless of which way the
    claim was resolved, so a denial doesn't land as an unexplained no.
    """

    __tablename__ = "return_claims"

    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), unique=True
    )
    buyer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    video_url: Mapped[str] = mapped_column(String(500))
    reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    status: Mapped[ReturnClaimStatus] = mapped_column(
        Enum(ReturnClaimStatus, name="return_claim_status"), default=ReturnClaimStatus.pending_review
    )
    seller_response: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    order: Mapped["Order"] = relationship()
    buyer: Mapped["User | None"] = relationship(foreign_keys=[buyer_id])
    resolved_by: Mapped["User | None"] = relationship(foreign_keys=[resolved_by_id])
