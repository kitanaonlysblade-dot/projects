import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, uuid_pk

FLAG_OPEN = "open"
FLAG_DISMISSED = "dismissed"
FLAG_CONFIRMED = "confirmed"
FINGERPRINT_OK = "ok"
FINGERPRINT_FAILED = "failed"


class VideoFingerprint(Base, TimestampMixin):
    """What "scan a video" searches: the sound / picture fingerprints of one uploaded video (app/scan_fp.py).
    `video_url` records which file was fingerprinted - after a post's video is replaced the old row no longer
    counts (and is rebuilt). `created_at` is also the platform's first-seen time for this video."""

    __tablename__ = "video_fingerprints"

    id: Mapped[uuid.UUID] = uuid_pk()
    video_post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), unique=True
    )
    video_url: Mapped[str] = mapped_column(String(500))
    version: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(12), default=FINGERPRINT_OK)
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)


class VideoScan(Base, TimestampMixin):
    """One lookup: someone scanned a recording. Powers "how many people scanned your video"."""

    __tablename__ = "video_scans"

    id: Mapped[uuid.UUID] = uuid_pk()
    video_post_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    found: Mapped[bool] = mapped_column(Boolean, default=False)
    stage: Mapped[str | None] = mapped_column(String(60), nullable=True)
    clip_s: Mapped[float | None] = mapped_column(Float, nullable=True)


class VideoMatchFlag(Base, TimestampMixin):
    """A later upload that looks like an earlier one from a DIFFERENT poster. Created automatically when the
    later video is fingerprinted; an admin dismisses it (not the same video) or confirms it (it is). Nothing
    is removed automatically - this is a review queue, and the shared page shows a neutral notice while open."""

    __tablename__ = "video_match_flags"
    __table_args__ = (UniqueConstraint("video_post_id", "earlier_post_id", name="uq_match_flag_pair"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    video_post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), index=True
    )
    earlier_post_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="CASCADE"), index=True
    )
    stage: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(12), default=FLAG_OPEN, index=True)
    note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
