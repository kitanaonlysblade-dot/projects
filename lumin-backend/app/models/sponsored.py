import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, UUID
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
    # What the seller says it is, so the kit matches in style (app/sponsored.py has the allowed words). All optional.
    style: Mapped[str | None] = mapped_column(String(20), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    audience: Mapped[str | None] = mapped_column(String(20), nullable=True)
    impressions: Mapped[int] = mapped_column(Integer, default=0)  # the collapsed row was offered
    reveals: Mapped[int] = mapped_column(Integer, default=0)      # the shopper opened it to see the product
    clicks: Mapped[int] = mapped_column(Integer, default=0)       # ...and then opened the product

    product: Mapped["Product"] = relationship()  # noqa: F821


class SponsoredPair(Base, TimestampMixin):
    """How one sponsored product does next to one product of a video (the learning data: which pairs people act on).
    shown = offered next to it; clicks = tapped; carts = added to cart; buys = bought now. Read by app/sponsored.py."""

    __tablename__ = "sponsored_pairs"
    __table_args__ = (UniqueConstraint("sponsored_id", "anchor_product_id", name="uq_sponsored_pair"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    sponsored_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sponsored_twins.id", ondelete="CASCADE"), index=True)
    anchor_product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True)
    shown: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    carts: Mapped[int] = mapped_column(Integer, default=0)
    buys: Mapped[int] = mapped_column(Integer, default=0)


class ProductProfile(Base, TimestampMixin):
    """What a product IS, as read by an AI model (app/product_ai.py): kind, style, audience, colours, in the matcher's own
    words. One row per product. source: 'ai' (usable) or 'pending' (queued, nothing to use yet)."""

    __tablename__ = "product_profiles"

    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str | None] = mapped_column(String(30), nullable=True)
    style: Mapped[str | None] = mapped_column(String(20), nullable=True)
    audience: Mapped[str | None] = mapped_column(String(20), nullable=True)
    colors: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    source: Mapped[str] = mapped_column(String(10), default="pending")
