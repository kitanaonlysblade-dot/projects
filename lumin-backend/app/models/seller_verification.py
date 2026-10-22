import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, uuid_pk

VERIFY_PENDING = "pending"
VERIFY_APPROVED = "approved"
VERIFY_REJECTED = "rejected"
DOC_TYPES = ("national_id", "passport", "drivers_license", "business_registration")


class SellerVerification(Base):
    """A seller's request to be verified: who they say they are plus a photo of an ID (or business document) and a
    selfie, reviewed by an admin. The images live in the private bucket (app/storage.py) and are DELETED when the
    request is decided: only the decision stays, so the keys are null after review."""

    __tablename__ = "seller_verifications"

    id: Mapped[uuid.UUID] = uuid_pk()
    merchant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("merchant_accounts.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(10), default=VERIFY_PENDING, index=True)
    legal_name: Mapped[str] = mapped_column(String(150))
    doc_type: Mapped[str] = mapped_column(String(25))
    document_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    selfie_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # Why it was rejected (shown to the seller).
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
