import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, uuid_pk


class TwinSearchStatus(str, enum.Enum):
    matched = "matched"  # the catalog had at least one twin when they searched
    not_found = "not_found"  # nothing yet - the shopper is waiting to be told
    available = "available"  # was not_found; a matching product has since been listed
    fulfilled = "fulfilled"  # the shopper picked a result (cart / buy)


class TwinSearch(Base, TimestampMixin):
    """One shopper asking "what is this?" - optionally about a clipped moment of
    a video, optionally just typed into the discovery search.

    Doubles as demand data: ``query_key`` is the order-insensitive keyword
    (app/twin_match.normalize_query) merchants see in the keyword insights, and
    a not_found row is a shopper waiting for a product to be listed."""

    __tablename__ = "twin_searches"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # The root original post the clip came from (a repost resolves to its original).
    video_post_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    start_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "Circle it": which part of the frame the shopper means, as fractions (0..1) of the
    # frame: left, top, width, height. Only these four numbers are kept; nothing is
    # uploaded and the crop is drawn in the browser. Null = the whole frame.
    box_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    box_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    box_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    box_h: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Which frame of the clip the circle was drawn on (ms into the video).
    box_at_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Legacy: stills are no longer captured or stored (nothing leaves for image matching).
    frame_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    query: Mapped[str] = mapped_column(String(300))
    query_key: Mapped[str] = mapped_column(String(120), index=True)
    # Which Wanted request this ask belongs to. Usually the same as query_key, but two
    # shoppers who describe the same moment of a video in different words share one
    # (app/twin_search_service.assign_request_key). query_key stays the keyword.
    request_key: Mapped[str] = mapped_column(String(120), index=True, default="", server_default="")
    status: Mapped[TwinSearchStatus] = mapped_column(
        Enum(TwinSearchStatus, name="twin_search_status"), default=TwinSearchStatus.not_found, index=True
    )
    # Tell this shopper when a twin turns up. On by default (they asked, after all);
    # the Wanted board's bell turns it off without withdrawing the request.
    notify: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    result_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    best_score: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    # not_found -> available: which product, and when we told the shopper.
    matched_product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # What this search actually showed, stored so a later pick is checked against what
    # the shopper saw rather than by re-running matching (which may cost and may differ).
    result_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list, server_default="{}")
    closest_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), default=list, server_default="{}")
    # The result the shopper went on to add to cart / buy. Set once; it is what
    # feeds the video-moment index (see VideoMomentProduct).
    picked_product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )

    user: Mapped["User"] = relationship()
    matched_product: Mapped["Product | None"] = relationship(foreign_keys=[matched_product_id])


class VideoMomentProduct(Base, TimestampMixin):
    """A candidate "this product is on screen at this moment of this video".

    It is only a candidate: whether it is trusted is worked out from its
    MomentEvidence (app/moment_index.py) every time, never stored as a flag, so a
    return or a cancelled order takes effect straight away. ``review`` is the
    video's own poster overruling the crowd: "confirmed" trusts it now, "rejected"
    hides it for good and stops new evidence landing on it. ``confirmations`` is
    only a cached count of distinct shoppers, for display."""

    __tablename__ = "video_moment_products"

    id: Mapped[uuid.UUID] = uuid_pk()
    video_post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    # The moment, as the median of the clips shoppers drew (not just the first one).
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    confirmations: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review: Mapped[str | None] = mapped_column(String(10), nullable=True)  # confirmed | rejected

    product: Mapped["Product"] = relationship()
    evidence: Mapped[list["MomentEvidence"]] = relationship(cascade="all, delete-orphan", back_populates="link")


class MomentEvidence(Base, TimestampMixin):
    """One shopper's vote for one link: they clipped this moment, described it in
    words that fit this product (``text_score``), and picked it. One row per shopper
    per link. Whether it was kept is looked up from their order, not stored."""

    __tablename__ = "moment_evidence"
    __table_args__ = (UniqueConstraint("link_id", "user_id", name="uq_moment_evidence_link_user"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    link_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_moment_products.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    video_post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"))
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)
    text_score: Mapped[float] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String(4))  # cart | buy

    link: Mapped["VideoMomentProduct"] = relationship(back_populates="evidence")


class WantedOffer(Base, TimestampMixin):
    """A seller's "Twin it": this product of mine fits that wanted moment. One row per
    seller product per request (``request_key`` is the request, see app/wanted_service.py).

    It is a claim by the seller, never proof: it makes the product show up in the
    request's compare list as "Offered" and nothing more. When the request came from a
    video moment, ``link_id`` points at the VideoMomentProduct the offer created, so the
    video's poster can approve or hide it and shoppers' kept purchases can confirm it
    (app/moment_index.py). An offer by the video's own poster is the "official" twin."""

    __tablename__ = "wanted_offers"
    __table_args__ = (UniqueConstraint("request_key", "product_id", name="uq_wanted_offer_key_product"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    request_key: Mapped[str] = mapped_column(String(120), index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    seller_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    link_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_moment_products.id", ondelete="SET NULL"), nullable=True, index=True
    )

    product: Mapped["Product"] = relationship()
    link: Mapped["VideoMomentProduct | None"] = relationship()
