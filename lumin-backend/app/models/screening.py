import uuid

from sqlalchemy import Float, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, uuid_pk

# What a flagged item is about, how it got flagged, how serious, and where it stands.
TARGET_TYPES = ("video_post", "comment", "user", "product")
SOURCES = ("text", "media", "reports")
SEVERITY_REVIEW = "review"  # stays visible, an admin should look
SEVERITY_HELD = "held"  # hidden from everyone but the owner until an admin decides
STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"  # an admin looked and it's fine: the same content is not flagged again
STATUS_REMOVED = "removed"


class ModerationItem(Base, TimestampMixin):
    """One thing the automatic checks (or enough reports) flagged, waiting for or already given an admin decision.
    `target_id` has no foreign key (it points at a post, comment, user or product depending on `target_type`), so
    it can outlive its target, which just means the preview is empty. `content_key` identifies the exact content
    that was checked (a URL, or a hash of the text), so approving it once stops that same content being flagged
    again, while a new upload is checked afresh."""

    __tablename__ = "moderation_items"
    __table_args__ = (Index("ix_moderation_items_target", "target_type", "target_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    target_type: Mapped[str] = mapped_column(String(20))
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(10))
    category: Mapped[str] = mapped_column(String(40))
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    detail: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_key: Mapped[str] = mapped_column(String(300), default="")
    severity: Mapped[str] = mapped_column(String(10), default=SEVERITY_REVIEW)
    status: Mapped[str] = mapped_column(String(10), default=STATUS_PENDING, index=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(String(500), nullable=True)


class ModerationTerm(Base, TimestampMixin):
    """A word or phrase the text filter acts on. action 'block' refuses the text; 'flag' lets it through and queues
    it for review. Stored already normalised (see app/screening.py normalize)."""

    __tablename__ = "moderation_terms"

    id: Mapped[uuid.UUID] = uuid_pk()
    term: Mapped[str] = mapped_column(String(100), unique=True)
    action: Mapped[str] = mapped_column(String(5), default="block")
