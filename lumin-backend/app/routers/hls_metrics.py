from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.auth import get_optional_user
from app.database import get_db
from app.models import HlsMetric, User
from app.rate_limit import limiter
from app.schemas.hls_metric import HlsMetricBatch

router = APIRouter(prefix="/hls-metrics", tags=["hls-metrics"])

# One request can carry a whole session's worth of swipes — still capped, so a
# malformed/abusive client can't turn one call into an unbounded insert.
MAX_POINTS_PER_BATCH = 200


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def record_hls_metrics(
    request: Request,
    payload: HlsMetricBatch,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Batched playback measurements from lib/hls.ts — see HlsMetric's own
    comment on why this exists: without it there's no way to tell whether
    streaming actually starts faster than the plain mp4, how often it
    stalls, what quality playback settles at, or how often it gives up
    and falls back, as opposed to assuming. No auth required, same
    reasoning as POST /traffic: most feed viewing happens pre-login, and
    losing that half of the picture would defeat the point."""
    points = payload.points[:MAX_POINTS_PER_BATCH]
    if not points:
        return
    db.bulk_save_objects(
        [
            HlsMetric(
                user_id=current_user.id if current_user else None,
                video_post_id=p.video_post_id,
                kind=p.kind,
                is_hls=p.is_hls,
                lite=p.lite,
                value_ms=p.value_ms,
                level=p.level,
                connection=p.connection,
            )
            for p in points
        ]
    )
    db.commit()
