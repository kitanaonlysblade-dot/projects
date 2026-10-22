"""Tamper-proof bags: the QR codes printed on them, what state each one is in, and the live test a seller films before sealing.

A bag's QR code is dormant (status "unused") until a seller films the live test of a product, seals it and scans the code
inside that same recording. That scan is the moment the code gets a meaning: it is tied to one order and one video, and its
status moves one way only (see app/seals.py): unused -> preview_used -> in_transit -> delivered. "void" is the exit for a bag
that is lost or damaged. Only a hash of each code is stored, so a copy of the database cannot be used to forge a label.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, uuid_pk

BAG_UNUSED = "unused"
BAG_PREVIEW_USED = "preview_used"
BAG_IN_TRANSIT = "in_transit"
BAG_DELIVERED = "delivered"
BAG_VOID = "void"

TEST_RECORDING = "recording"
TEST_SEALED = "sealed"
TEST_ABANDONED = "abandoned"


class SealBatch(Base, TimestampMixin):
    __tablename__ = "seal_batches"

    id: Mapped[uuid.UUID] = uuid_pk()
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    count: Mapped[int] = mapped_column(Integer)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class SealBag(Base, TimestampMixin):
    __tablename__ = "seal_bags"

    id: Mapped[uuid.UUID] = uuid_pk()
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seal_batches.id", ondelete="CASCADE"), index=True
    )
    # Printed beside the QR, for support and admins. Not a secret: it cannot be used to seal anything.
    serial: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    # sha256 of the secret code (the QR). The code itself is never stored.
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default=BAG_UNUSED, server_default=BAG_UNUSED, index=True)
    # The seller this bag was sold to; only that seller can seal with it.
    seller_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    test_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # The shop order (of a bag pack) that bought this bag for its owner; null for bags assigned by hand.
    pack_order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)


class SealEvent(Base):
    """Every status change of a bag, kept for ever (who, when, from what to what)."""

    __tablename__ = "seal_events"

    id: Mapped[uuid.UUID] = uuid_pk()
    bag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seal_bags.id", ondelete="CASCADE"), index=True
    )
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))


class LiveTest(Base, TimestampMixin):
    """One seller's uncut live test of one order's product, ended by scanning the bag's QR."""

    __tablename__ = "live_tests"
    __table_args__ = (
        # An order can have many abandoned attempts but only one sealed test.
        Index("uq_live_tests_one_sealed_per_order", "order_id", unique=True, postgresql_where=text("status = 'sealed'")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    seller_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    bag_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seal_bags.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(12), default=TEST_RECORDING, server_default=TEST_RECORDING)
    # Shown on screen when recording starts; the seller must show it to the camera, so a video made earlier cannot be reused.
    order_code: Mapped[str] = mapped_column(String(8))
    # Server clock, not the phone's: when the test was opened and when it was sealed.
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("now()"))
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    video_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    video_private: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # Computed by the server from the stored file, not trusted from the phone.
    video_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    video_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # What the seller says they showed working (screen, speaker, ...): a dispute about one of these is the seller's to lose.
    checklist: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, server_default="{}")
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)


SHIP_AWAITING = "awaiting_pickup"
SHIP_IN_TRANSIT = "in_transit"
SHIP_DELIVERED = "delivered"
SHIP_REFUSED = "refused"
SHIP_LOST = "lost"
SHIP_CLOSED = "closed"  # refused or cancelled, then settled by an admin / the order was cancelled before pickup


class Shipment(Base, TimestampMixin):
    """One sealed order's journey: waiting for a driver, in transit, then delivered (or refused at the door).
    The courier behind it is swappable (app/courier.py); until a real one is connected an admin presses the buttons."""

    __tablename__ = "shipments"

    id: Mapped[uuid.UUID] = uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), unique=True
    )
    bag_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("seal_bags.id", ondelete="CASCADE"), index=True)
    courier: Mapped[str] = mapped_column(String(30), default="manual", server_default="manual")
    courier_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default=SHIP_AWAITING, server_default=SHIP_AWAITING, index=True)
    driver_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    picked_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The buyer's check at the door: did the bag arrive still sealed and untouched?
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seal_intact: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    refusal_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # The delivery code the buyer reads to the driver: only a hash is kept, it expires, and wrong tries are limited.
    otp_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    otp_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    otp_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    otp_issued: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # A photo of the opened bag, from the buyer at the door (optional).
    refusal_photo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # How a refused or lost shipment was settled by an admin, who bears the cost, and when.
    resolution: Mapped[str | None] = mapped_column(String(30), nullable=True)
    loss_party: Mapped[str | None] = mapped_column(String(20), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Reminders already sent (each at most once).
    pickup_reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    transit_reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
