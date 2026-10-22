import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, uuid_pk
import enum


class HlsMetricKind(str, enum.Enum):
    """What lib/hls.ts is reporting — enough to answer "does streaming
    actually help" without logging every quality switch verbatim.

    ttff: time from the player being asked to play this video to its
    first visible frame, in value_ms — reported for both the streaming
    path and the plain-mp4 path (is_hls tells them apart) so the two
    are directly comparable, which is the whole point of collecting
    this at all (see lib/hls.ts's own comment on why that comparison,
    not a bare streaming-only number, is what answers whether this
    feature is worth it).
    stall: playback had to pause to rebuffer after already starting;
    value_ms is how long the stall lasted.
    level_reached: the highest quality rung actually reached for this
    playback (0 = smallest); recorded once, when playback ends or the
    video is swiped away, not on every intermediate switch.
    fallback: streaming failed outright and the plain mp4 took over
    (lib/hls.ts's onFail path) — a pure count, value_ms/level unused.
    """

    ttff = "ttff"
    stall = "stall"
    level_reached = "level_reached"
    fallback = "fallback"


class HlsMetric(Base, TimestampMixin):
    """One playback measurement from the feed, batched client-side and
    flushed via sendBeacon (lib/hls.ts) so a tab closing mid-swipe still
    delivers whatever was collected so far. No admin screen reads this
    yet — it exists so the questions in the HLS README section ("is
    start-up actually faster than the mp4", "how often does it fall
    back") have real numbers to query instead of guesses. Anonymous
    callers allowed, same reasoning as TrafficSource: most feed viewing
    happens before/without login."""

    __tablename__ = "hls_metrics"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    video_post_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_posts.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[HlsMetricKind] = mapped_column(Enum(HlsMetricKind, name="hls_metric_kind"))
    # True when this measurement is from the HLS path, False from the plain-mp4 path — what makes
    # ttff rows comparable across the two instead of only ever seeing the streaming side.
    is_hls: Mapped[bool] = mapped_column(Boolean, default=True)
    lite: Mapped[bool] = mapped_column(Boolean, default=False)
    value_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    level: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # navigator.connection.effectiveType verbatim ('4g', '3g', '2g', 'slow-2g') when the
    # browser exposes it, null otherwise (Safari doesn't) — good enough to bucket readings
    # by rough connection quality without pretending to more precision than it has.
    connection: Mapped[str | None] = mapped_column(String(20), nullable=True)
