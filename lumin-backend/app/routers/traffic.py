from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.auth import get_optional_user
from app.database import get_db
from app.models import TrafficSource, User
from app.rate_limit import limiter
from app.schemas.traffic import TrafficSourceCreate

router = APIRouter(prefix="/traffic", tags=["traffic"])


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def record_traffic_source(
    request: Request,
    payload: TrafficSourceCreate,
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """Called once per app load from the frontend — see TrafficSource's
    own comment on why this is deliberately session-start acquisition
    tracking, not pageview/event tracking. No auth required: most of
    what this receives fires before anyone's logged in, which is the
    whole point (get_optional_user attaches user_id when a session
    happens to already be authenticated, but never requires it — an
    anonymous visitor's referrer is exactly the data this exists to
    capture). Rate-limited generously (60/minute, well above what one
    real app load needs) since an unauthenticated route is otherwise
    easy to hit repeatedly from a single caller.
    """
    db.add(
        TrafficSource(
            user_id=current_user.id if current_user else None,
            referrer=payload.referrer,
            utm_source=payload.utm_source,
            utm_medium=payload.utm_medium,
            utm_campaign=payload.utm_campaign,
        )
    )
    db.commit()
