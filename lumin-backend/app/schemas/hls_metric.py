import uuid

from pydantic import BaseModel

from app.models import HlsMetricKind


class HlsMetricPoint(BaseModel):
    """One measurement — see HlsMetric's own comment on what each kind means."""

    kind: HlsMetricKind
    video_post_id: uuid.UUID | None = None
    is_hls: bool = True
    lite: bool = False
    value_ms: int | None = None
    level: int | None = None
    connection: str | None = None


class HlsMetricBatch(BaseModel):
    """POST /hls-metrics' body. A batch, not one row per call — lib/hls.ts
    collects measurements locally across however many videos get swiped
    through and flushes them together (on an interval and via
    sendBeacon on page hide), so a session that watches 20 videos is one
    request, not 20."""

    points: list[HlsMetricPoint]
