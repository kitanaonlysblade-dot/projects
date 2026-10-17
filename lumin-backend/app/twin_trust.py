"""Trusted sellers skip the twin review queue.

A seller whose twins have been approved a handful of times and who has never
had one flagged gets new twins approved straight away, so admin review stays
focused on people we know nothing about. Still reversible: an admin can flag a
twin at any time, and one flag ends the trust.
"""
import uuid

from sqlalchemy.orm import Session

from app.models import TwinReviewStatus, VideoPost, VideoPostTwin

from app.twin_config import TRUST_AFTER_APPROVED  # noqa: E402


def is_trusted(db: Session, user_id: uuid.UUID) -> bool:
    rows = (
        db.query(VideoPostTwin.review_status)
        .join(VideoPost, VideoPost.id == VideoPostTwin.video_post_id)
        .filter(VideoPost.poster_id == user_id, VideoPostTwin.review_status != TwinReviewStatus.pending)
        .all()
    )
    statuses = [r[0] for r in rows]
    return TwinReviewStatus.flagged not in statuses and statuses.count(TwinReviewStatus.approved) >= TRUST_AFTER_APPROVED
