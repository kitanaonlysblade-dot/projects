import uuid

from sqlalchemy import Boolean, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class SponsoredTwin(Base, TimestampMixin):
    """A seller promoting one of their products as a "twin" on the scan result screen (app/sponsored.py picks which
    one shows). One row per product; `active` is the seller's switch. Counts are for the seller's report."""

    __tablename__ = "sponsored_twins"

    id: Mapped[uuid.UUID] = uuid_pk()
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), unique=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    impressions: Mapped[int] = mapped_column(Integer, default=0)  # the collapsed row was offered
    reveals: Mapped[int] = mapped_column(Integer, default=0)      # the shopper opened it to see the product
    clicks: Mapped[int] = mapped_column(Integer, default=0)       # ...and then opened the product

    product: Mapped["Product"] = relationship()  # noqa: F821
